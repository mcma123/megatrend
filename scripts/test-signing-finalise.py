"""Offline finalisation checks: synthetic PKI, dummy RFC 3161 TSA and fake retained storage.
No network, real certificates, real contracts or credentials. Run with the signing PDF venv."""
import base64
import copy
import hashlib
import importlib.util
import io
import json
import sys
import types
import unittest
import zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.dont_write_bytecode = True
for name in ("boto3", "wmill", "botocore", "botocore.config"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["botocore.config"].Config = lambda **kwargs: kwargs
ROOT = Path(__file__).resolve().parents[1]
for package in ("f", "f.signing"):
    module = types.ModuleType(package)
    module.__path__ = []
    sys.modules[package] = module


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load("f.signing.prepare_bundle", ROOT / "f/signing/prepare_bundle.py")
worker = load("f.signing.finalise_agreement", ROOT / "f/signing/finalise_agreement.py")

import rfc8785
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from cryptography.x509.oid import ExtendedKeyUsageOID, NameOID
from asn1crypto import crl as acrl, keys as akeys, x509 as ax509
from pyhanko.sign.timestamps.dummy_client import DummyTimeStamper
from pyhanko_certvalidator.registry import SimpleCertificateStore
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen.canvas import Canvas

NOW = datetime.now(timezone.utc)
FONTS = ["C:/Windows/Fonts/arial.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/System/Library/Fonts/Supplemental/Arial Unicode.ttf"]


def _name(cn):
    return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])


def _cert(cn, issuer_key=None, issuer=None, ca=False, eku=None, key=None):
    key = key or ec.generate_private_key(ec.SECP256R1())
    builder = (x509.CertificateBuilder().subject_name(_name(cn)).issuer_name(issuer or _name(cn))
        .public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(NOW - timedelta(days=1)).not_valid_after(NOW + timedelta(days=365))
        .add_extension(x509.BasicConstraints(ca=ca, path_length=None), critical=True)
        .add_extension(x509.KeyUsage(digital_signature=not ca, content_commitment=not ca, key_encipherment=False,
            data_encipherment=False, key_agreement=False, key_cert_sign=ca, crl_sign=ca, encipher_only=False,
            decipher_only=False), critical=True))
    if eku:
        builder = builder.add_extension(x509.ExtendedKeyUsage(eku), critical=True)
    return key, builder.sign(issuer_key or key, hashes.SHA256())


def _pem(cert):
    return cert.public_bytes(serialization.Encoding.PEM).decode()


def _asn(cert):
    return ax509.Certificate.load(cert.public_bytes(serialization.Encoding.DER))


def _crl(key, cert):
    built = (x509.CertificateRevocationListBuilder().issuer_name(cert.subject).last_update(NOW - timedelta(hours=1))
        .next_update(NOW + timedelta(days=7)).sign(key, hashes.SHA256()))
    return acrl.CertificateList.load(built.public_bytes(serialization.Encoding.DER))


class PKI:
    """Synthetic seal CA/leaf and TSA CA/leaf. The dummy timestamper requires RSA."""
    def __init__(self):
        self.root_key, self.root = _cert("Synthetic Seal Root", ca=True)
        self.seal_key, self.seal = _cert("Synthetic Platform Seal", self.root_key, self.root.subject)
        self.tsa_root_key, self.tsa_root = _cert("Synthetic TSA Root", ca=True)
        self.tsa_key, self.tsa = _cert("Synthetic TSA", self.tsa_root_key, self.tsa_root.subject,
            eku=[ExtendedKeyUsageOID.TIME_STAMPING], key=rsa.generate_private_key(65537, 2048))
        self.crls = [_crl(self.root_key, self.root), _crl(self.tsa_root_key, self.tsa_root)]

    def settings(self, roots=None):
        return {"key_pem": self.seal_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                serialization.NoEncryption()).decode(), "certificate_pem": _pem(self.seal),
            "trust_roots_pem": roots or _pem(self.root), "tsa_trust_roots_pem": _pem(self.tsa_root), "tsa_url": "https://tsa.example.test"}

    def timestamper(self):
        key = akeys.PrivateKeyInfo.load(self.tsa_key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        return DummyTimeStamper(tsa_cert=_asn(self.tsa), tsa_key=key, certs_to_embed=SimpleCertificateStore.from_certs([_asn(self.tsa_root)]))

    def tools(self, **kwargs):
        return worker.seal_tools(self.settings(**kwargs), timestamper=self.timestamper(), crls=self.crls, allow_fetching=False)


class Missing(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


class Exists(Exception):
    response = {"Error": {"Code": "PreconditionFailed"}}


class Storage:
    def __init__(self):
        self.items, self.writes, self.fail_put = {}, 0, False

    def get_object(self, Bucket, Key, VersionId=None):
        if (Bucket, Key) not in self.items:
            raise Missing()
        obj = self.items[Bucket, Key]
        if VersionId and VersionId != obj["VersionId"]:
            raise Missing()
        return {**obj, "ContentLength": len(obj["Body"]), "Body": io.BytesIO(obj["Body"])}

    def get_object_retention(self, Bucket, Key, VersionId):
        obj = self.items[Bucket, Key]
        return {"Retention": {"Mode": obj.get("ObjectLockMode"), "RetainUntilDate": obj.get("ObjectLockRetainUntilDate")}}

    def put_object(self, Bucket, Key, **args):
        if self.fail_put:
            raise RuntimeError("synthetic storage outage with private details")
        assert args["IfNoneMatch"] == "*" and args["ObjectLockMode"] == "COMPLIANCE"
        if (Bucket, Key) in self.items:
            raise Exists()
        self.writes += 1
        self.items[Bucket, Key] = {**args, "VersionId": f"v-{self.writes}", "ServerSideEncryption": "AES256"}


def bundle_pdf():
    writer = PdfWriter()
    for index, rotate in enumerate((0, 90)):
        stream = io.BytesIO()
        canvas = Canvas(stream, pagesize=(595, 842), invariant=True)
        canvas.drawString(60, 780, f"Synthetic lease page {index + 1}")
        canvas.showPage()
        canvas.save()
        page = PdfReader(io.BytesIO(stream.getvalue())).pages[0]
        if rotate:
            page.rotate(rotate)
        writer.add_page(page)
    out = io.BytesIO()
    writer.write(out)
    return out.getvalue()


def png(seed=7, width=40, height=16):
    raw = b"".join(b"\0" + bytes(v for x in range(width) for v in ((x * seed + y) % 200, 30, 90, 255 if (x + y) % 3 else 0))
        for y in range(height))
    def chunk(kind, data):
        return len(data).to_bytes(4, "big") + kind + data + zlib.crc32(kind + data).to_bytes(4, "big")
    ihdr = width.to_bytes(4, "big") + height.to_bytes(4, "big") + bytes([8, 6, 0, 0, 0])
    return base64.b64encode(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")).decode()


def mark(kind, seed):
    data = png(seed)
    return {"hash": hashlib.sha256(f"{kind}:{data}".encode()).hexdigest(), "kind": kind, "png": data}


PAGE = lambda i, r: {"pageIndex": i, "sourceFileId": "file", "sourcePageIndex": i, "mediaBox": [0, 0, 595, 842],
    "cropBox": [0, 0, 595, 842], "rotation": r, "userUnit": 1, "widthPt": 595, "heightPt": 842}


def evidence_for(pdf, sig, ini, name="Thandi Tenant", note="Unit 4B"):
    field = lambda key, kind, page, y, **extra: {"key": key, "type": kind, "label": key, "participantKey": "tenant", "pageIndex": page,
        "x": 0.1, "y": y, "width": 0.3, "height": 0.05, "required": True, "readOnly": False, **extra}
    values = [
        {"key": "sig", "type": "signature", "pageIndex": 0, "value": "applied", "source": "participant", "markHash": sig["hash"]},
        {"key": "ini", "type": "initials", "pageIndex": 1, "value": "applied", "source": "participant", "markHash": ini["hash"]},
        {"key": "note", "type": "text", "pageIndex": 1, "value": note, "source": "participant"},
        {"key": "ack", "type": "checkbox", "pageIndex": 0, "value": "true", "source": "participant"},
        {"key": "date", "type": "signing_date", "pageIndex": 0, "value": "2026-10-26", "source": "server"},
        {"key": "name", "type": "full_name", "pageIndex": 0, "value": name, "source": "approved"},
    ]
    submission_evidence = {"contractVersion": 1, "intent": "sign", "acceptedAt": 1793000000000, "values": values,
        "authentication": {"method": "email_otp", "verifiedAt": 1792999000000, "sessionId": "session"},
        "consent": {"platformVersion": "cyphersoft-signer-consent-v1", "policyVersion": "consent-1", "consentHash": "c" * 64, "acceptedAt": 1792999100000}}
    return {
        "contractVersion": 1, "kind": "cyphersoft-signing-evidence", "tenantId": "tenant1", "agreementId": "agreement1",
        "attemptId": "attempt1", "transactionId": "tx1", "reference": "ref-1", "title": "Synthetic lease", "companyName": "Synthetic Company",
        "completedAt": 1793000000000, "preparationHash": "p" * 64,
        "bundle": {"attemptId": "prep1", "artifactKey": "prepared/tenant1/agreement1/prep1/bundle.pdf", "storageVersion": "bundle-v1",
            "pdfHash": hashlib.sha256(pdf).hexdigest(), "manifestHash": "m" * 64},
        "pages": [PAGE(0, 0), PAGE(1, 90)],
        "fields": [field("sig", "signature", 0, 0.6), field("ini", "initials", 1, 0.8, width=0.1), field("note", "text", 1, 0.3),
            field("ack", "checkbox", 0, 0.5, width=0.04, height=0.03), field("date", "signing_date", 0, 0.7, readOnly=True),
            field("name", "full_name", 0, 0.75, readOnly=True)],
        "participants": [{"key": "tenant", "name": name, "email": "tenant@example.test", "role": "Tenant", "responsibility": "signer", "stage": 1},
            {"key": "agent", "name": "Agent", "email": "agent@example.test", "role": "Agent", "responsibility": "viewer", "stage": 1}],
        "submissions": [{"submissionId": "s1", "participantKey": "tenant", "intent": "sign", "stage": 1, "acceptedAt": 1793000000000,
            "submissionHash": "e" * 64, "evidence": submission_evidence}],
        "marks": [{"hash": sig["hash"], "kind": "signature"}, {"hash": ini["hash"], "kind": "initials"}],
        "audit": {"eventSequence": 42, "headHash": "h" * 64, "checkpoint": None},
    }


class FinaliseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pki = PKI()

    def setUp(self):
        self.storage = Storage()
        self.pdf = bundle_pdf()
        self.storage.items["frozen", "prepared/tenant1/agreement1/prep1/bundle.pdf"] = {"Body": self.pdf, "VersionId": "bundle-v1",
            "ServerSideEncryption": "AES256", "ObjectLockMode": "COMPLIANCE", "ObjectLockRetainUntilDate": NOW + timedelta(days=30)}
        self.settings = {"frozen_bucket": "frozen", "retention_days": 3650}
        self.sig, self.ini = mark("signature", 7), mark("initials", 11)
        self.evidence = evidence_for(self.pdf, self.sig, self.ini)

    def run_finalise(self, evidence=None, tools=None, marks=None, fonts=FONTS):
        evidence = evidence or self.evidence
        digest = hashlib.sha256(rfc8785.dumps(evidence)).hexdigest()
        return worker.finalise(self.storage, self.settings, tools or self.pki.tools(), "tenant1", "agreement1", "attempt1",
            digest, evidence, marks if marks is not None else [self.sig, self.ini], fonts)

    def sealed(self, result):
        return self.storage.items["frozen", result["pdfKey"]]["Body"]

    def test_completed_pdf_is_sealed_timestamped_lt_and_bound_to_evidence(self):
        result = self.run_finalise()
        self.assertEqual(result["status"], "completed")
        validation = result["validation"]
        self.assertEqual(validation["level"], "PAdES-B-LT")
        self.assertTrue(validation["trusted"] and validation["intact"])
        self.assertGreaterEqual(validation["dssCrls"], 1)
        self.assertIn("Synthetic TSA", validation["tsaSubject"])
        self.assertEqual(result["evidenceHash"], hashlib.sha256(rfc8785.dumps(self.evidence)).hexdigest())
        self.assertEqual(self.storage.items["frozen", result["evidenceKey"]]["Body"], rfc8785.dumps(self.evidence))
        sealed = self.sealed(result)
        self.assertEqual(hashlib.sha256(sealed).hexdigest(), result["pdfHash"])
        reader = PdfReader(io.BytesIO(sealed))
        self.assertEqual(len(reader.pages), 2 + result["certificatePageCount"])
        self.assertEqual(reader.metadata["/CyphersoftEvidenceSHA256"], result["evidenceHash"])
        self.assertIn("Thandi Tenant", reader.pages[0].extract_text())
        self.assertIn("2026-10-26", reader.pages[0].extract_text())
        self.assertIn("Unit 4B", reader.pages[1].extract_text())
        self.assertEqual(reader.pages[1].get("/Rotate"), 90)
        certificate = "".join(p.extract_text() for p in reader.pages[2:])
        for expected in ("Completion certificate", result["evidenceHash"], "not a participant", "e" * 64):
            self.assertIn(expected.replace(" ", ""), certificate.replace(" ", "").replace("\n", ""))
        self.assertEqual(len([k for k in reader.pages[0]["/Resources"].get("/XObject", {})]), 1)
        record = json.loads(self.storage.items["frozen", result["recordKey"]]["Body"])
        self.assertEqual(record["pdfVersion"], result["pdfVersion"])

    def test_certificate_names_the_witnessed_signer(self):
        evidence = dict(self.evidence)
        evidence["participants"] = [*evidence["participants"], {"key": "witness", "name": "Wanda Witness",
            "email": "witness@example.test", "role": "Witness", "responsibility": "signer", "stage": 1, "witnessFor": "tenant"}]
        result = self.run_finalise(evidence)
        reader = PdfReader(io.BytesIO(self.sealed(result)))
        certificate = "".join(page.extract_text() for page in reader.pages[2:]).replace(" ", "").replace(chr(10), "")
        self.assertIn("WitnessforThandiTenant", certificate)

    def test_retry_returns_the_retained_record_without_new_artifacts(self):
        first = self.run_finalise()
        writes = self.storage.writes
        again = self.run_finalise()
        self.assertEqual(writes, self.storage.writes)
        self.assertEqual((again["pdfHash"], again["recordVersion"]), (first["pdfHash"], first["recordVersion"]))

    def test_tampering_with_pdf_evidence_or_record_fails_verification(self):
        result = self.run_finalise()
        payload = {k: result[k] for k in ("pdfVersion", "pdfHash", "evidenceVersion", "evidenceHash", "recordVersion", "recordHash")}
        payload["attemptId"] = "attempt1"
        tools = self.pki.tools()
        self.assertEqual(worker.verify(self.storage, self.settings, tools, "tenant1", "agreement1", payload)["status"], "verified")
        original = copy.deepcopy(self.storage.items)
        sealed = bytearray(self.sealed(result))
        position = sealed.find(b"/Producer")
        sealed[position + 12] ^= 1
        self.storage.items["frozen", result["pdfKey"]]["Body"] = bytes(sealed)
        report = worker.verify(self.storage, self.settings, tools, "tenant1", "agreement1", payload)
        self.assertEqual(report["status"], "failed")
        self.assertFalse(report["checks"]["pdfHash"])
        self.assertFalse(report["checks"]["seal"])
        self.storage.items = copy.deepcopy(original)
        self.storage.items["frozen", result["evidenceKey"]]["Body"] = rfc8785.dumps({**self.evidence, "title": "Changed"})
        self.assertFalse(worker.verify(self.storage, self.settings, tools, "tenant1", "agreement1", payload)["checks"]["evidenceHash"])
        self.storage.items = copy.deepcopy(original)
        self.storage.items["frozen", result["recordKey"]]["Body"] += b" "
        self.assertFalse(worker.verify(self.storage, self.settings, tools, "tenant1", "agreement1", payload)["checks"]["recordHash"])

    def test_content_change_after_sealing_is_rejected(self):
        result = self.run_finalise()
        writer = PdfWriter(io.BytesIO(self.sealed(result)), incremental=True)
        writer.pages[0].merge_page(PdfReader(io.BytesIO(bundle_pdf())).pages[0])
        out = io.BytesIO()
        writer.write(out)
        with self.assertRaisesRegex(worker.Blocked, "validation_failed"):
            worker.validate_sealed(out.getvalue(), self.pki.tools(), result["evidenceHash"], 2 + result["certificatePageCount"])

    def test_wrong_evidence_binding_or_page_count_is_rejected(self):
        result = self.run_finalise()
        for evidence_hash, pages in ((("0" * 64), 2 + result["certificatePageCount"]), (result["evidenceHash"], 99)):
            with self.subTest(pages=pages), self.assertRaisesRegex(worker.Blocked, "validation_failed"):
                worker.validate_sealed(self.sealed(result), self.pki.tools(), evidence_hash, pages)

    def test_timestamp_failure_publishes_nothing(self):
        tools = self.pki.tools()
        from pyhanko.sign.timestamps import TimestampRequestError
        class Down(DummyTimeStamper):
            def request_tsa_response(self, req):
                raise TimestampRequestError("synthetic TSA outage")
        tools.timestamper = Down(tsa_cert=_asn(self.pki.tsa), tsa_key=self.pki.timestamper().tsa_key)
        with self.assertRaisesRegex(worker.Blocked, "timestamp_unavailable"):
            self.run_finalise(tools=tools)
        self.assertFalse(any(key.startswith("completed/") for _, key in self.storage.items))

    def test_untrusted_seal_certificate_fails_closed(self):
        _, other_root = _cert("Unrelated Root", ca=True)
        tools = worker.seal_tools(self.pki.settings(roots=_pem(other_root)), timestamper=self.pki.timestamper(),
            crls=self.pki.crls, allow_fetching=False)
        with self.assertRaises(worker.Blocked) as caught:
            self.run_finalise(tools=tools)
        self.assertEqual(str(caught.exception), "validation_failed")
        self.assertFalse(any(key.startswith("completed/") for _, key in self.storage.items))

    def test_mismatched_key_or_expired_certificate_is_unavailable(self):
        settings = self.pki.settings()
        settings["key_pem"] = ec.generate_private_key(ec.SECP256R1()).private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
        with self.assertRaisesRegex(worker.Blocked, "certificate_unavailable"):
            worker.seal_tools(settings, timestamper=self.pki.timestamper(), allow_fetching=False)
        with self.assertRaisesRegex(worker.Blocked, "not_configured"):
            worker.seal_tools({**self.pki.settings(), "tsa_url": "http://tsa.example.test"}, allow_fetching=False)

    def test_evidence_mark_and_source_integrity_checks(self):
        with self.assertRaisesRegex(worker.Blocked, "result_invalid"):
            worker.finalise(self.storage, self.settings, self.pki.tools(), "tenant1", "agreement1", "attempt1", "0" * 64, self.evidence, [self.sig, self.ini], FONTS)
        forged = {**self.sig, "png": png(99)}
        with self.assertRaisesRegex(worker.Blocked, "result_invalid"):
            self.run_finalise(marks=[forged, self.ini])
        with self.assertRaisesRegex(worker.Blocked, "result_invalid"):
            self.run_finalise(marks=[self.sig])
        self.storage.items["frozen", "prepared/tenant1/agreement1/prep1/bundle.pdf"]["Body"] = bundle_pdf() + b"%changed"
        with self.assertRaisesRegex(worker.Blocked, "source_changed"):
            self.run_finalise()

    def test_storage_outage_never_returns_success(self):
        self.storage.fail_put = True
        with self.assertRaisesRegex(worker.Blocked, "storage_failed"):
            self.run_finalise()

    def test_convex_canonical_json_matches_rfc8785(self):
        # Produced by convex/lib/signing.ts canonicalJson/signingHash; the evidence binding depends on it.
        value = {"b": [0.1, 1e-7, 123456789.125, 0, 2.5e21, 0.30000000000000004],
            "a": "Zoë Ndlovu — “quoted”   \U0001F600",
            "nested": {"z": None, "y": True, "é": 1, "A": 2, "ä": []}, "x": 595, "y": 0.08, "w": 0.2352941176470588}
        self.assertEqual(hashlib.sha256(rfc8785.dumps(value)).hexdigest(),
            "68488f4468fe599b4530e838caeb5bd468ac5ffbea541d903cfc02a057cd8571")

    def test_unicode_requires_a_real_font_never_substitution(self):
        unicode_evidence = evidence_for(self.pdf, self.sig, self.ini, name="Zoë Ndlovu", note="Ünit ō")
        with self.assertRaisesRegex(worker.Blocked, "unsupported_text"):
            self.run_finalise(evidence=unicode_evidence, fonts=["/nonexistent.ttf"])
        if any(Path(p).is_file() for p in FONTS):
            result = self.run_finalise(evidence=unicode_evidence)
            self.assertIn("Zoë Ndlovu", PdfReader(io.BytesIO(self.sealed(result))).pages[0].extract_text())


if __name__ == "__main__":
    unittest.main(verbosity=2)
