# requirements:
# boto3
# wmill
# pypdf==6.21.2
# rfc8785==0.1.4
# reportlab==5.1.0
# pillow==13.0.0
# pyhanko==0.38.0
# pyhanko-certvalidator==0.33.0
"""Completed-agreement finalisation: compose accepted values, append a completion certificate,
apply a platform seal with an RFC 3161 timestamp and PAdES B-LT validation material, validate,
then publish to retained storage. A platform seal protects the artifact; it is not a
participant certificate or an advanced electronic signature."""
import base64
import hashlib
import io
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

import boto3
import rfc8785
import wmill
from botocore.config import Config

from f.signing.prepare_bundle import Blocked, digest, identity, private_bucket, put_frozen, read_object, require, version

MIB = 1024 * 1024
BUNDLE_LIMIT, OUTPUT_LIMIT, EVIDENCE_LIMIT, MARK_LIMIT = 50 * MIB, 60 * MIB, 2 * MIB, 80_000
ERRORS = {"not_configured", "storage_failed", "source_changed", "result_invalid", "certificate_unavailable",
    "timestamp_unavailable", "revocation_unavailable", "validation_failed", "render_failed", "unsupported_text",
    "limit_exceeded", "finalisation_failed"}
SEAL_FIELD = "CyphersoftPlatformSeal"
RENDERER = "cyphersoft-final-v1"
SAST = timezone(timedelta(hours=2))
UNICODE_FONTS = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf"]


# ---- Seal tooling -------------------------------------------------------------------------------

@dataclass
class SealTools:
    """Everything that touches key material or trust. Tests inject synthetic PKI and a dummy TSA."""
    signer: Any
    timestamper: Any
    signing_context: Any
    trust_roots: list
    tsa_roots: list
    certificate_sha256: str


def _pem_certs(text):
    from asn1crypto import pem, x509 as ax509
    certs = []
    if not (text or "").strip():
        return certs
    for _, _, der in pem.unarmor(text.encode("ascii"), multiple=True):
        certs.append(ax509.Certificate.load(der))
    return certs


def seal_tools(settings, timestamper=None, crls=None, allow_fetching=True):
    """Builds pyHanko signer/TSA/trust from the fixed `f/signing/platform_seal` resource."""
    from asn1crypto import keys as akeys
    from cryptography.hazmat.primitives import serialization
    from pyhanko.sign import signers
    from pyhanko.sign.timestamps import HTTPTimeStamper
    from pyhanko_certvalidator import ValidationContext
    from pyhanko_certvalidator.registry import SimpleCertificateStore
    try:
        certs = _pem_certs(settings.get("certificate_pem"))
        chain = _pem_certs(settings.get("chain_pem"))
        roots = _pem_certs(settings.get("trust_roots_pem"))
        tsa_roots = _pem_certs(settings.get("tsa_trust_roots_pem"))
        require(len(certs) == 1 and roots and tsa_roots, "certificate_unavailable")
        passphrase = settings.get("key_passphrase")
        key = serialization.load_pem_private_key(settings["key_pem"].encode("ascii"), passphrase.encode() if passphrase else None)
        der_key = key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        cert = certs[0]
        public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        require(cert.public_key.dump() == public, "certificate_unavailable")
        now = datetime.now(timezone.utc)
        require(cert.not_valid_before <= now < cert.not_valid_after, "certificate_unavailable")
        usage = cert.key_usage_value.native if cert.key_usage_value else set()
        require("digital_signature" in usage or "non_repudiation" in usage, "certificate_unavailable")
        signer = signers.SimpleSigner(signing_cert=cert, signing_key=akeys.PrivateKeyInfo.load(der_key),
            cert_registry=SimpleCertificateStore.from_certs(chain + roots))
    except Blocked:
        raise
    except Exception:
        raise Blocked("certificate_unavailable") from None
    if timestamper is None:
        url = urlparse(settings.get("tsa_url", ""))
        require(url.scheme == "https" and url.hostname and not url.username and not url.password and not url.fragment, "not_configured")
        auth = (settings["tsa_username"], settings["tsa_password"]) if settings.get("tsa_username") else None
        timestamper = HTTPTimeStamper(settings["tsa_url"], https=True, timeout=20, auth=auth)
    context = ValidationContext(trust_roots=roots + tsa_roots, other_certs=chain, crls=list(crls or []),
        allow_fetching=allow_fetching, revocation_mode="hard-fail")
    return SealTools(signer, timestamper, context, roots, tsa_roots, hashlib.sha256(cert.dump()).hexdigest())


def apply_seal(pdf, tools, title):
    from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
    from pyhanko.sign import fields, signers
    from pyhanko.sign.timestamps import TimestampRequestError
    meta = signers.PdfSignatureMetadata(field_name=SEAL_FIELD, reason="Cyphersoft platform integrity seal",
        name="Cyphersoft platform seal", subfilter=fields.SigSeedSubFilter.PADES, embed_validation_info=True,
        validation_context=tools.signing_context, certify=True, docmdp_permissions=fields.MDPPerm.NO_CHANGES)
    try:
        writer = IncrementalPdfFileWriter(io.BytesIO(pdf), strict=True)
        writer.document_meta.title = title[:200]
        return signers.sign_pdf(writer, meta, signer=tools.signer, timestamper=tools.timestamper).getvalue()
    except Exception as error:
        # pyHanko wraps TSA and path-validation failures in SigningError; classify by the cause chain.
        names, current = set(), error
        while current is not None and len(names) < 20:
            if isinstance(current, TimestampRequestError):
                raise Blocked("timestamp_unavailable") from None
            names.update(cls.__name__ for cls in type(current).__mro__)
            current = current.__cause__ or current.__context__
        if any("Timestamp" in name for name in names):
            raise Blocked("timestamp_unavailable") from None
        if names & {"PathBuildingError", "PathValidationError", "RevokedError", "InsufficientRevinfoError", "ValidationError"}:
            raise Blocked("validation_failed") from None
        if any("Revocation" in name or "Revinfo" in name for name in names):
            raise Blocked("revocation_unavailable") from None
        raise Blocked("certificate_unavailable") from None


def validate_sealed(sealed, tools, evidence_hash, expected_pages):
    """Validates only from material inside the PDF (DSS), with fetching disabled: proves B-LT."""
    from pyhanko.pdf_utils.reader import PdfFileReader
    from pyhanko.sign.diff_analysis import ModificationLevel
    from pyhanko.sign.validation import validate_pdf_signature
    from pyhanko.sign.validation.dss import DocumentSecurityStore
    from pyhanko.sign.validation.status import SignatureCoverageLevel
    try:
        reader = PdfFileReader(io.BytesIO(sealed), strict=True)
        signatures = reader.embedded_signatures
        require(len(signatures) == 1 and signatures[0].field_name == SEAL_FIELD, "validation_failed")
        dss = DocumentSecurityStore.read_dss(reader)
        require(dss is not None and (dss.crls or dss.ocsps), "validation_failed")
        options = {"allow_fetching": False, "revocation_mode": "hard-fail"}
        signer_vc = dss.as_validation_context({**options, "trust_roots": tools.trust_roots})
        tsa_vc = dss.as_validation_context({**options, "trust_roots": tools.tsa_roots})
        status = validate_pdf_signature(signatures[0], signer_validation_context=signer_vc, ts_validation_context=tsa_vc)
        ts = status.timestamp_validity
        require(status.bottom_line and status.intact and status.valid and status.trusted and not status.revoked, "validation_failed")
        require(status.docmdp_ok is not False, "validation_failed")
        require(status.coverage == SignatureCoverageLevel.ENTIRE_FILE or (status.coverage == SignatureCoverageLevel.ENTIRE_REVISION
            and status.modification_level is not None and status.modification_level <= ModificationLevel.LTA_UPDATES), "validation_failed")
        require(ts is not None and ts.intact and ts.valid and ts.trusted, "validation_failed")
        signed = reader.get_historical_resolver(signatures[0].signed_revision)
        info = signed.trailer_view["/Info"]
        require(str(info.get("/CyphersoftEvidenceSHA256")) == evidence_hash, "validation_failed")
        require(len(reader.root["/Pages"]["/Kids"]) > 0 and int(reader.root["/Pages"]["/Count"]) == expected_pages, "validation_failed")
        cert = signatures[0].signer_cert
        require(hashlib.sha256(cert.dump()).hexdigest() == tools.certificate_sha256, "validation_failed")
        return {
            "intact": True, "valid": True, "trusted": True, "revoked": False,
            "coverage": status.coverage.name, "modificationLevel": status.modification_level.name if status.modification_level else "NONE",
            "certified": True, "docmdp": "NO_CHANGES",
            "signerSubject": cert.subject.human_friendly[:300], "signerCertificateSha256": tools.certificate_sha256,
            "signerNotAfter": int(cert.not_valid_after.timestamp() * 1000),
            "timestamp": int(ts.timestamp.timestamp() * 1000), "tsaSubject": ts.signing_cert.subject.human_friendly[:300],
            "dssCertificates": len(list(dss.load_certs())), "dssCrls": len(dss.crls), "dssOcsps": len(dss.ocsps),
            "level": "PAdES-B-LT",
        }
    except Blocked:
        raise
    except Exception:
        raise Blocked("validation_failed") from None


# ---- Composition --------------------------------------------------------------------------------

def _font(texts, fonts):
    """Helvetica for Latin-1; a configured Unicode TTF otherwise. Never substitute characters."""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    if all(_latin1(t) for t in texts):
        return "Helvetica"
    for path in fonts:
        if Path(path).is_file():
            if "CyphersoftUnicode" not in pdfmetrics.getRegisteredFontNames():
                pdfmetrics.registerFont(TTFont("CyphersoftUnicode", path))
            return "CyphersoftUnicode"
    raise Blocked("unsupported_text")


def _latin1(text):
    try:
        text.encode("latin-1")
        return True
    except UnicodeEncodeError:
        return False


def mark_images(marks):
    from PIL import Image
    images = {}
    for mark in marks:
        require(isinstance(mark, dict) and mark.get("kind") in ("signature", "initials") and isinstance(mark.get("png"), str), "result_invalid")
        require(len(mark["png"]) <= 110_000, "limit_exceeded")
        require(hashlib.sha256(f"{mark['kind']}:{mark['png']}".encode()).hexdigest() == mark.get("hash"), "result_invalid")
        raw = base64.b64decode(mark["png"], validate=True)
        require(0 < len(raw) <= MARK_LIMIT and raw.startswith(b"\x89PNG\r\n\x1a\n"), "result_invalid")
        try:
            with Image.open(io.BytesIO(raw)) as image:
                require(image.format == "PNG" and image.width <= 1200 and image.height <= 600, "result_invalid")
                image.load()
                images[mark["hash"]] = (mark["kind"], image.convert("RGBA"))
        except Blocked:
            raise
        except Exception:
            raise Blocked("result_invalid") from None
    return images


def _draw_field(canvas, field, value, page, images, font):
    """Draws in unrotated user space, rotated with the page so content reads upright when displayed."""
    from reportlab.lib.utils import ImageReader
    left, bottom, right, top = page["cropBox"]
    w, h = right - left, top - bottom
    x0, x1 = left + field["x"] * w, left + (field["x"] + field["width"]) * w
    y0, y1 = top - (field["y"] + field["height"]) * h, top - field["y"] * h
    rotation = page["rotation"]
    bw, bh = (y1 - y0, x1 - x0) if rotation in (90, 270) else (x1 - x0, y1 - y0)
    canvas.saveState()
    canvas.translate((x0 + x1) / 2, (y0 + y1) / 2)
    canvas.rotate(rotation)
    if value.get("markHash"):
        kind, image = images[value["markHash"]]
        require(kind == field["type"], "result_invalid")
        scale = min(bw / image.width, bh / image.height)
        iw, ih = image.width * scale, image.height * scale
        canvas.drawImage(ImageReader(image), -iw / 2, -ih / 2, iw, ih, mask="auto")
    elif field["type"] == "checkbox":
        if value["value"] == "true":
            size = min(bw, bh) * 0.8
            canvas.setLineWidth(max(0.8, size / 8))
            path = canvas.beginPath()
            path.moveTo(-size / 2, 0)
            path.lineTo(-size / 8, -size / 2.5)
            path.lineTo(size / 2, size / 2.5)
            canvas.drawPath(path, stroke=1, fill=0)
    else:
        text = value["value"]
        size = min(bh * 0.7, 14)
        while size > 4 and canvas.stringWidth(text, font, size) > bw - 2:
            size -= 0.5
        require(canvas.stringWidth(text, font, size) <= bw + 0.5, "render_failed")
        canvas.setFont(font, size)
        canvas.drawString(-bw / 2 + 1, -size / 3, text)
    canvas.restoreState()


def _wrap(canvas, text, font, size, width):
    lines, line = [], ""
    for word in text.split():
        candidate = f"{line} {word}".strip()
        if canvas.stringWidth(candidate, font, size) <= width:
            line = candidate
        else:
            if line:
                lines.append(line)
            while canvas.stringWidth(word, font, size) > width:
                cut = len(word)
                while cut > 1 and canvas.stringWidth(word[:cut], font, size) > width:
                    cut -= 1
                lines.append(word[:cut])
                word = word[cut:]
            line = word
    if line:
        lines.append(line)
    return lines or [""]


IDENTITY_DOCUMENTS = {"sa_id": "South African ID", "passport": "passport", "drivers_licence": "driving licence", "asylum_permit": "asylum seeker permit"}


def _when(ms):
    moment = datetime.fromtimestamp(ms / 1000, timezone.utc)
    return f"{moment.strftime('%Y-%m-%d %H:%M:%S')} UTC ({moment.astimezone(SAST).strftime('%Y-%m-%d %H:%M')} SAST)"


def certificate_pdf(evidence, evidence_hash, font):
    """Human-readable completion certificate. The structured evidence manifest is authoritative."""
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen.canvas import Canvas
    stream = io.BytesIO()
    canvas = Canvas(stream, pagesize=A4, invariant=True, pageCompression=1)
    width, height = A4
    margin, y = 50, A4[1] - 60
    bold = "Helvetica-Bold" if font == "Helvetica" else font

    def line(text, size=9, gap=3, face=None):
        nonlocal y
        for part in _wrap(canvas, text, face or font, size, width - 2 * margin):
            if y < 60:
                canvas.showPage()
                y = height - 60
            canvas.setFont(face or font, size)
            canvas.drawString(margin, y, part)
            y -= size + gap

    line("Completion certificate", 18, 10, bold)
    line(f"{evidence['title']} · {evidence['companyName']}", 11, 6, bold)
    line(f"Reference {evidence['reference']} · Agreement {evidence['agreementId']}")
    line(f"Signing completed {_when(evidence['completedAt'])}")
    y -= 6
    line("Integrity", 11, 4, bold)
    line(f"Evidence manifest SHA-256: {evidence_hash}")
    line(f"Approved document (prepared bundle) SHA-256: {evidence['bundle']['pdfHash']}")
    line(f"Bundle manifest SHA-256: {evidence['bundle']['manifestHash']}")
    line(f"Frozen preparation hash: {evidence['preparationHash']}")
    audit = evidence["audit"]
    line(f"Audit chain head: event {audit['eventSequence']} · {audit['headHash']}")
    if audit.get("checkpoint"):
        cp = audit["checkpoint"]
        line(f"Latest independent checkpoint: event {cp['sequence']} · {cp['headHash']} · {cp['status']}")
    y -= 6
    line("Participants", 11, 4, bold)
    by_key = {s["participantKey"]: s for s in evidence["submissions"]}
    for party in evidence["participants"]:
        line(f"{party['name']} · {party['role']} · {party['responsibility']} · stage {party['stage']}", 10, 3, bold)
        line(f"Email {party['email']}")
        if party.get("witnessFor"):
            witnessed = next((p for p in evidence["participants"] if p["key"] == party["witnessFor"]), None)
            line(f"Witness for {witnessed['name'] if witnessed else party['witnessFor']}")
        submission = by_key.get(party["key"])
        if submission:
            proof = submission["evidence"]
            auth = proof["authentication"]
            consent = proof.get("consent") or {}
            line(f"{'Signed' if submission['intent'] == 'sign' else 'Approved'} {_when(submission['acceptedAt'])} after email one-time code verification at {_when(auth['verifiedAt'])}")
            if auth.get("inPerson"):
                check = auth["inPerson"]
                kind = IDENTITY_DOCUMENTS.get(check["documentType"], "identity document")
                line(f"In-person session: staff checked {kind} ending {check['documentEnding']} at {_when(check['checkedAt'])}; code sent to the participant's own mailbox")
            line(f"Electronic consent {consent.get('platformVersion', '')} / company version {consent.get('policyVersion', '')} accepted {_when(consent['acceptedAt']) if consent.get('acceptedAt') else ''}")
            line(f"Submission record SHA-256: {submission['submissionHash']}")
        else:
            line("No action required (viewer or copy recipient)")
        y -= 4
    y -= 6
    line("Statement", 11, 4, bold)
    line("This document is protected by the Cyphersoft platform seal with a trusted timestamp and embedded validation data. "
         "The platform seal protects the integrity of this file; it is not a participant's certificate or an accredited advanced electronic signature. "
         "Email verification demonstrates access to the invited mailbox, not government-verified identity.")
    canvas.showPage()
    canvas.save()
    return stream.getvalue()


def compose(bundle_pdf, evidence, evidence_hash, images, fonts=UNICODE_FONTS):
    import pypdf
    from reportlab.pdfgen.canvas import Canvas
    pypdf.overwrite_configuration(zlib_maximum_output_length=50 * MIB, maximum_declared_stream_length=50 * MIB,
        image_maximum_buffer_size=50 * MIB, stream_decoding_work_maximum_length=100 * MIB,
        page_tree_maximum_entries=1000, page_tree_maximum_depth=80, disable_legacy_handling=True)
    pages = evidence["pages"]
    fields = {f["key"]: f for f in evidence["fields"]}
    values = []
    for submission in evidence["submissions"]:
        for value in submission["evidence"].get("values", []):
            field = fields.get(value["key"])
            require(field is not None and field["participantKey"] == submission["participantKey"] and field["type"] == value["type"], "result_invalid")
            if value["value"] in ("", "false") and not value.get("markHash"):
                continue
            values.append((field, value))
    font = _font([v["value"] for _, v in values if not v.get("markHash")] + [p["name"] for p in evidence["participants"]] + [evidence["title"], evidence["companyName"]], fonts)
    try:
        reader = pypdf.PdfReader(io.BytesIO(bundle_pdf), strict=True)
        require(len(reader.pages) == len(pages), "source_changed")
        writer = pypdf.PdfWriter(clone_from=reader)
        for index, page in enumerate(writer.pages):
            geometry = pages[index]
            require([float(x) for x in page.cropbox] == geometry["cropBox"] and int(page.get("/Rotate", 0)) % 360 == geometry["rotation"], "source_changed")
            on_page = [(f, v) for f, v in values if f["pageIndex"] == index]
            if not on_page:
                continue
            media = [float(x) for x in page.mediabox]
            stream = io.BytesIO()
            canvas = Canvas(stream, pagesize=(media[2], media[3]), invariant=True)
            canvas.setFillColorRGB(0.07, 0.1, 0.35)
            canvas.setStrokeColorRGB(0.07, 0.1, 0.35)
            for field, value in on_page:
                _draw_field(canvas, field, value, geometry, images, font)
            canvas.showPage()
            canvas.save()
            page.merge_page(pypdf.PdfReader(io.BytesIO(stream.getvalue())).pages[0])
        certificate = pypdf.PdfReader(io.BytesIO(certificate_pdf(evidence, evidence_hash, font)))
        for page in certificate.pages:
            writer.add_page(page)
        writer.add_metadata({"/Title": evidence["title"][:200], "/Producer": f"Cyphersoft finalisation {RENDERER}",
            "/CyphersoftEvidenceSHA256": evidence_hash, "/CyphersoftAgreement": evidence["agreementId"],
            "/CyphersoftFinalisation": evidence["attemptId"]})
        out = io.BytesIO()
        writer.write(out)
        data = out.getvalue()
    except Blocked:
        raise
    except Exception:
        raise Blocked("render_failed") from None
    require(0 < len(data) <= OUTPUT_LIMIT, "limit_exceeded")
    return data, len(certificate.pages)


# ---- Orchestration ------------------------------------------------------------------------------

def _missing(error):
    return getattr(error, "response", {}).get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound")


def _existing(client, bucket, prefix, attempt, input_digest):
    try:
        record_body, record_version, _ = read_object(client, bucket, prefix + "/record.json", MIB, protected=True)
    except Exception as error:
        if _missing(error):
            return None
        raise
    record = json.loads(record_body)
    require(record.get("attemptId") == attempt and record.get("evidenceHash") == input_digest, "result_invalid")
    pdf, pdf_version, pdf_until = read_object(client, bucket, prefix + "/signed.pdf", OUTPUT_LIMIT, record["pdfVersion"], protected=True)
    evidence, evidence_version, evidence_until = read_object(client, bucket, prefix + "/evidence.json", EVIDENCE_LIMIT, record["evidenceVersion"], protected=True)
    require(digest(pdf) == record["pdfHash"] and digest(evidence) == input_digest, "storage_failed")
    return _result(prefix, record, record_body, record_version, min(pdf_until, evidence_until))


def _result(prefix, record, record_body, record_version, until):
    return {"status": "completed", **record, "pdfKey": prefix + "/signed.pdf", "evidenceKey": prefix + "/evidence.json",
        "recordKey": prefix + "/record.json", "recordVersion": record_version, "recordHash": digest(record_body),
        "retainUntil": int(until.timestamp() * 1000)}


def finalise(client, settings, tools, tenant, agreement, attempt, input_digest, evidence, marks, fonts=UNICODE_FONTS):
    require(re.fullmatch(r"[a-f0-9]{64}", input_digest or "") is not None, "result_invalid")
    encoded = rfc8785.dumps(evidence)
    require(len(encoded) <= EVIDENCE_LIMIT, "limit_exceeded")
    require(digest(encoded) == input_digest, "result_invalid")
    require(evidence.get("contractVersion") == 1 and evidence.get("tenantId") == tenant and evidence.get("agreementId") == agreement
        and evidence.get("attemptId") == attempt, "result_invalid")
    bucket = settings["frozen_bucket"]
    prefix = f"completed/{tenant}/{agreement}/{identity(attempt)}"
    # The record is written last; an existing retained record is the idempotency receipt.
    existing = _existing(client, bucket, prefix, attempt, input_digest)
    if existing:
        return existing
    started = time.monotonic()
    bundle = evidence["bundle"]
    key = f"prepared/{tenant}/{agreement}/{identity(bundle['attemptId'])}/bundle.pdf"
    require(bundle.get("artifactKey") == key, "result_invalid")
    source, _, _ = read_object(client, bucket, key, BUNDLE_LIMIT, version(bundle["storageVersion"]), protected=True)
    require(digest(source) == bundle["pdfHash"], "source_changed")
    referenced = {v["markHash"] for s in evidence["submissions"] for v in s["evidence"].get("values", []) if v.get("markHash")}
    images = mark_images(marks)
    require(referenced == set(images), "result_invalid")
    composed, certificate_pages = compose(source, evidence, input_digest, images, fonts)
    sealed = apply_seal(composed, tools, evidence["title"])
    require(len(sealed) <= OUTPUT_LIMIT and time.monotonic() - started < 240, "limit_exceeded")
    expected_pages = len(evidence["pages"]) + certificate_pages
    validation = validate_sealed(sealed, tools, input_digest, expected_pages)
    days = settings["retention_days"]
    pdf_version, pdf_until = put_frozen(client, bucket, prefix + "/signed.pdf", sealed, "application/pdf", days)
    evidence_version, evidence_until = put_frozen(client, bucket, prefix + "/evidence.json", encoded, "application/json", days)
    record = {"contractVersion": 1, "tenantId": tenant, "agreementId": agreement, "attemptId": attempt,
        "renderer": RENDERER, "evidenceHash": input_digest, "evidenceVersion": evidence_version,
        "pdfHash": digest(sealed), "pdfVersion": pdf_version, "sizeBytes": len(sealed), "pageCount": expected_pages,
        "certificatePageCount": certificate_pages, "sourcePdfHash": bundle["pdfHash"], "validation": validation,
        "sealedAt": validation["timestamp"]}
    record_body = rfc8785.dumps(record)
    record_version, record_until = put_frozen(client, bucket, prefix + "/record.json", record_body, "application/json", days)
    return _result(prefix, record, record_body, record_version, min(pdf_until, evidence_until, record_until))


def verify(client, settings, tools, tenant, agreement, payload):
    """Independent re-check of published artifacts: versions, hashes, binding and seal validity."""
    bucket = settings["frozen_bucket"]
    prefix = f"completed/{tenant}/{agreement}/{identity(payload['attemptId'])}"
    checks = {"recordHash": False, "pdfHash": False, "evidenceHash": False, "binding": False, "seal": False}
    report = {"status": "verified", "checks": checks}
    record_body, _, _ = read_object(client, bucket, prefix + "/record.json", MIB, version(payload["recordVersion"]), protected=True)
    checks["recordHash"] = digest(record_body) == payload["recordHash"]
    record = json.loads(record_body)
    pdf, _, _ = read_object(client, bucket, prefix + "/signed.pdf", OUTPUT_LIMIT, version(payload["pdfVersion"]), protected=True)
    evidence, _, _ = read_object(client, bucket, prefix + "/evidence.json", EVIDENCE_LIMIT, version(payload["evidenceVersion"]), protected=True)
    checks["pdfHash"] = digest(pdf) == payload["pdfHash"] == record.get("pdfHash")
    checks["evidenceHash"] = digest(evidence) == payload["evidenceHash"] == record.get("evidenceHash")
    checks["binding"] = rfc8785.dumps(json.loads(evidence)) == evidence
    try:
        report["validation"] = validate_sealed(pdf, tools, payload["evidenceHash"], record.get("pageCount"))
        checks["seal"] = True
    except Blocked:
        report["validation"] = None
    report["verifiedAt"] = int(time.time() * 1000)
    if not all(checks.values()):
        report["status"] = "failed"
    return report


def _client(settings):
    endpoint = urlparse(settings.get("endpoint", ""))
    require(endpoint.scheme == "https" and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment, "not_configured")
    require(type(settings.get("retention_days")) is int and 1 <= settings["retention_days"] <= 36500 and settings.get("frozen_bucket"), "not_configured")
    return boto3.client("s3", endpoint_url=settings["endpoint"], region_name=settings.get("region", "us-east-1"),
        aws_access_key_id=settings["access_key"], aws_secret_access_key=settings["secret_key"],
        config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=30, retries={"max_attempts": 1}, s3={"addressing_style": "path"}))


def main(operation: str, tenant_id: str, agreement_id: str, payload: dict):
    try:
        tenant, agreement = identity(tenant_id), identity(agreement_id)
        require(operation in ("finalise", "download", "verify") and isinstance(payload, dict), "result_invalid")
        settings = wmill.get_resource("f/signing/document_storage")
        client = _client(settings)
        private_bucket(client, settings["frozen_bucket"], frozen=True)
        if operation == "download":
            prefix = f"completed/{tenant}/{agreement}/{identity(payload['attemptId'])}"
            pdf, pv, _ = read_object(client, settings["frozen_bucket"], prefix + "/signed.pdf", OUTPUT_LIMIT, version(payload["pdfVersion"]), protected=True)
            require(digest(pdf) == payload["pdfHash"], "storage_failed")
            url = client.generate_presigned_url("get_object", Params={"Bucket": settings["frozen_bucket"], "Key": prefix + "/signed.pdf",
                "VersionId": pv, "ResponseContentType": "application/pdf", "ResponseContentDisposition": 'attachment; filename="signed-agreement.pdf"'}, ExpiresIn=60)
            require(urlparse(url).scheme == "https", "storage_failed")
            return {"status": "download", "url": url, "expiresAt": int(time.time() * 1000) + 60_000}
        tools = seal_tools(wmill.get_resource("f/signing/platform_seal"))
        if operation == "verify":
            return verify(client, settings, tools, tenant, agreement, payload)
        return finalise(client, settings, tools, tenant, agreement, identity(payload["attemptId"]), payload["inputDigest"], payload["evidence"], payload.get("marks", []))
    except Blocked as error:
        return {"status": "blocked", "error": str(error) if str(error) in ERRORS else "finalisation_failed"}
    except Exception:
        # Provider, key and PDF exceptions can contain secrets, URLs or private contents.
        return {"status": "blocked", "error": "finalisation_failed"}
