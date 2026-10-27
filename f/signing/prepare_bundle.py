# requirements:
# boto3
# wmill
# pypdf==6.21.2
# rfc8785==0.1.4
"""Private PDF preparation. No OCR, public source links, or client-selected resources."""
import hashlib
import json
import math
import os
import re
import socket
import ssl
import struct
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

import boto3
import rfc8785
import wmill
from botocore.config import Config

MIB = 1024 * 1024
FILE_LIMIT, INPUT_LIMIT, OUTPUT_LIMIT, PAGE_LIMIT = 25*MIB, 75*MIB, 50*MIB, 200
ATTACHMENT_LIMIT = 10*MIB
# Supporting documents: the declared type must match the leading bytes before scanning.
ATTACHMENT_MAGIC = {"application/pdf": b"%PDF-", "image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
ERRORS = {"not_configured", "transfer_failed", "malware_detected", "scanner_unavailable", "invalid_pdf", "encrypted_pdf", "signed_pdf", "unsupported_pdf", "unsupported_file", "limit_exceeded", "source_changed", "storage_failed", "preparation_failed", "result_invalid"}


class Blocked(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Blocked(code)


def identity(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value), "result_invalid")
    return value


def digest(data):
    return hashlib.sha256(data).hexdigest()


def version(value):
    require(isinstance(value, str) and 0 < len(value) <= 1024 and value != "null" and not re.search(r"[\r\n]", value), "source_changed")
    return value


def private_bucket(client, bucket, frozen=False):
    grants = client.get_bucket_acl(Bucket=bucket).get("Grants", [])
    require(not any(g.get("Grantee", {}).get("URI", "").endswith(("/AllUsers", "/AuthenticatedUsers")) for g in grants), "storage_failed")
    require(client.get_bucket_versioning(Bucket=bucket).get("Status") == "Enabled", "storage_failed")
    rules = client.get_bucket_encryption(Bucket=bucket).get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
    require(any(r.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm") in ("AES256", "aws:kms") for r in rules), "storage_failed")
    try:
        policy = json.loads(client.get_bucket_policy(Bucket=bucket)["Policy"])
    except Exception as error:
        require(getattr(error, "response", {}).get("Error", {}).get("Code") in ("NoSuchBucketPolicy", "NoSuchBucketPolicyException"), "storage_failed")
        policy = {}
    for statement in policy.get("Statement", []):
        principal = statement.get("Principal")
        require(not (statement.get("Effect") == "Allow" and (principal == "*" or isinstance(principal, dict) and "*" in principal.get("AWS", []))), "storage_failed")
    if frozen:
        require(client.get_object_lock_configuration(Bucket=bucket).get("ObjectLockConfiguration", {}).get("ObjectLockEnabled") == "Enabled", "storage_failed")


def read_object(client, bucket, key, limit, object_version=None, protected=False):
    args = {"Bucket": bucket, "Key": key}
    if object_version:
        args["VersionId"] = version(object_version)
    obj = client.get_object(**args)
    actual_version = version(obj.get("VersionId"))
    require(not object_version or object_version == actual_version, "source_changed")
    require(obj.get("ServerSideEncryption") in ("AES256", "aws:kms"), "storage_failed")
    require(0 < obj.get("ContentLength", 0) <= limit, "limit_exceeded")
    try:
        body = obj["Body"].read(limit + 1)
    finally:
        obj["Body"].close()
    require(len(body) == obj["ContentLength"] and len(body) <= limit, "source_changed")
    until = None
    if protected:
        retention = client.get_object_retention(Bucket=bucket, Key=key, VersionId=actual_version).get("Retention", {})
        until = retention.get("RetainUntilDate")
        require(retention.get("Mode") == "COMPLIANCE" and isinstance(until, datetime) and until > datetime.now(timezone.utc), "storage_failed")
    return body, actual_version, until


def put_frozen(client, bucket, key, body, content_type, days):
    try:
        client.put_object(Bucket=bucket, Key=key, Body=body, ContentType=content_type,
            IfNoneMatch="*", ChecksumAlgorithm="SHA256", ObjectLockMode="COMPLIANCE",
            ObjectLockRetainUntilDate=datetime.now(timezone.utc) + timedelta(days=days))
    except Exception as error:
        require(getattr(error, "response", {}).get("Error", {}).get("Code") in ("PreconditionFailed", "412"), "storage_failed")
    saved, saved_version, until = read_object(client, bucket, key, max(len(body), 1), protected=True)
    require(saved == body, "storage_failed")
    return saved_version, until


def scan_bytes(data, settings):
    """clamd INSTREAM over verified TLS or a local Unix socket. No file paths sent."""
    deadline = time.monotonic() + 40
    def remaining():
        seconds = deadline - time.monotonic()
        require(seconds > 0, "scanner_unavailable")
        return min(20, seconds)
    def connect():
        if settings.get("transport") == "unix":
            address = settings.get("socket_path", "")
            require(address.startswith("/") and len(address) < 108, "scanner_unavailable")
            connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            connection.settimeout(remaining())
            connection.connect(address)
            return connection
        require(settings.get("transport") == "tls", "scanner_unavailable")
        context = ssl.create_default_context(cadata=settings.get("ca_pem") or None)
        connection = socket.create_connection((settings["host"], int(settings.get("port", 3310))), timeout=remaining())
        return context.wrap_socket(connection, server_hostname=settings.get("server_name") or settings["host"])

    def answer(connection):
        result = bytearray()
        while len(result) <= 1024:
            connection.settimeout(remaining())
            chunk = connection.recv(256)
            if not chunk:
                break
            result.extend(chunk)
            if b"\0" in chunk:
                break
        require(0 < len(result) <= 1024, "scanner_unavailable")
        return bytes(result).rstrip(b"\0\r\n").decode("ascii", "strict")

    try:
        with connect() as connection:
            connection.sendall(b"zVERSION\0")
            engine = answer(connection)
        match = re.fullmatch(r"ClamAV ([^/]{1,50})/(\d{1,15})/(.{1,60})", engine)
        require(match is not None, "scanner_unavailable")
        updated = datetime.strptime(match[3].strip(), "%a %b %d %H:%M:%S %Y").replace(tzinfo=timezone.utc)
        age = (datetime.now(timezone.utc) - updated).total_seconds()
        require(-3600 <= age <= 48*3600, "scanner_unavailable")
        with connect() as connection:
            connection.sendall(b"zINSTREAM\0")
            for start in range(0, len(data), 65536):
                connection.settimeout(remaining())
                chunk = data[start:start+65536]
                connection.sendall(struct.pack("!I", len(chunk)) + chunk)
            connection.sendall(b"\0\0\0\0")
            result = answer(connection)
        if result.endswith(" FOUND"):
            raise Blocked("malware_detected")
        require(result == "stream: OK", "scanner_unavailable")
        return {"engine": "ClamAV", "version": engine, "scannedAt": int(time.time()*1000)}
    except Blocked:
        raise
    except Exception:
        raise Blocked("scanner_unavailable") from None


def sanitize_local(paths, files, output):
    """Called only in a bounded subprocess in production; directly on synthetic test fixtures."""
    import pypdf
    from pypdf.generic import DictionaryObject, ArrayObject, IndirectObject
    pypdf.overwrite_configuration(zlib_maximum_output_length=50*MIB, maximum_declared_stream_length=50*MIB,
        image_maximum_buffer_size=50*MIB, stream_decoding_work_maximum_length=100*MIB,
        page_tree_maximum_entries=1000, page_tree_maximum_depth=80, disable_legacy_handling=True)
    writer, pages, counts = pypdf.PdfWriter(), [], []
    forbidden = {"/JavaScript", "/JS", "/OpenAction", "/AA", "/XFA", "/EmbeddedFiles", "/Filespec", "/RichMedia", "/Launch", "/OCProperties", "/Collection", "/AcroForm", "/Encrypt", "/SubmitForm", "/ImportData", "/GoToR", "/GoToE"}
    for path, source in zip(paths, files, strict=True):
        data = Path(path).read_bytes()
        require(data.startswith(b"%PDF-"), "invalid_pdf")
        require(b"/ByteRange" not in data, "signed_pdf")
        try:
            reader = pypdf.PdfReader(path, strict=True)
            require(not reader.is_encrypted, "encrypted_pdf")
            root = reader.trailer["/Root"]
            require(not root.get("/Perms"), "signed_pdf")
            visited, budget = set(), [100_000]

            def walk(obj, depth=0):
                require(depth <= 80 and budget[0] > 0, "limit_exceeded")
                budget[0] -= 1
                if isinstance(obj, IndirectObject):
                    marker = (obj.idnum, obj.generation)
                    if marker in visited:
                        return
                    visited.add(marker)
                    obj = obj.get_object()
                if isinstance(obj, DictionaryObject):
                    require(obj.get("/FT") != "/Sig" and obj.get("/Type") != "/Sig", "signed_pdf")
                    require(not forbidden.intersection(obj.keys()) and obj.get("/S") not in forbidden, "unsupported_pdf")
                    require(obj.get("/Type") != "/EmbeddedFile", "unsupported_pdf")
                    for key, value in obj.items():
                        if key not in ("/Parent", "/P"):
                            walk(value, depth+1)
                elif isinstance(obj, ArrayObject):
                    for value in obj:
                        walk(value, depth+1)
            walk(root)
            count = len(reader.pages)
            require(0 < count and len(pages) + count <= PAGE_LIMIT, "limit_exceeded")
            counts.append(count)
            for index, page in enumerate(reader.pages):
                for annotation in page.get("/Annots", []):
                    require(annotation.get_object().get("/Subtype") == "/Link", "unsupported_pdf")
                media, crop = [float(x) for x in page.mediabox], [float(x) for x in page.cropbox]
                unit, rotation = float(page.get("/UserUnit", 1)), int(page.get("/Rotate", 0)) % 360
                require(all(math.isfinite(x) for x in media+crop+[unit]) and 0 < unit <= 10 and rotation in (0, 90, 180, 270), "unsupported_pdf")
                require(media[0] <= crop[0] < crop[2] <= media[2] and media[1] <= crop[1] < crop[3] <= media[3], "unsupported_pdf")
                width, height = (crop[2]-crop[0])*unit, (crop[3]-crop[1])*unit
                require(0 < width <= 14400 and 0 < height <= 14400, "limit_exceeded")
                require((media[2]-media[0])*unit <= 14400 and (media[3]-media[1])*unit <= 14400, "limit_exceeded")
                pages.append({"pageIndex": len(pages), "sourceFileId": source["fileId"], "sourcePageIndex": index,
                    "mediaBox": media, "cropBox": crop, "rotation": rotation, "userUnit": unit, "widthPt": width, "heightPt": height})
                writer.add_page(page, excluded_keys=["/Annots", "/AA", "/Metadata", "/PieceInfo"])
        except Blocked:
            raise
        except Exception:
            raise Blocked("invalid_pdf") from None
    writer.add_metadata({"/Producer": "Cyphersoft static PDF preparation"})
    writer.write(output)
    require(0 < Path(output).stat().st_size <= OUTPUT_LIMIT, "limit_exceeded")
    # Parse the newly written flat document, not just the uploaded sources.
    result = pypdf.PdfReader(output, strict=True)
    require(not result.is_encrypted and len(result.pages) == len(pages), "invalid_pdf")
    return {"pages": pages, "counts": counts, "rendererVersion": "pypdf-flat-v1:" + pypdf.__version__}


def _sanitize_child(directory):
    import resource
    resource.setrlimit(resource.RLIMIT_AS, (1024*MIB, 1024*MIB))
    resource.setrlimit(resource.RLIMIT_CPU, (60, 60))
    resource.setrlimit(resource.RLIMIT_FSIZE, (OUTPUT_LIMIT + MIB, OUTPUT_LIMIT + MIB))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    root = Path(directory)
    try:
        info = json.loads((root / "input.json").read_text())
        result = sanitize_local([str(root / f"source-{i}.pdf") for i in range(len(info))], info, str(root / "bundle.pdf"))
    except Blocked as error:
        result = {"error": str(error)}
    except Exception:
        result = {"error": "invalid_pdf"}
    (root / "result.json").write_text(json.dumps(result))


def isolated_render(directory):
    require(sys.platform == "linux", "not_configured")
    # The child receives neither Windmill/S3 credentials nor contract text in its arguments/logs.
    clean_env = {k: v for k, v in os.environ.items() if k in ("PATH", "LANG", "LC_ALL", "VIRTUAL_ENV")}
    # Windmill can inject cached dependency paths through its wrapper rather than env.
    clean_env["PYTHONPATH"] = os.pathsep.join(str(Path(p).resolve()) for p in sys.path if isinstance(p, str))
    code = "import runpy,sys; runpy.run_path(sys.argv[1])['_sanitize_child'](sys.argv[2])"
    try:
        result = subprocess.run([sys.executable, "-c", code, str(Path(__file__).resolve()), str(directory)],
            env=clean_env, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90, check=False)
        require(result.returncode == 0, "limit_exceeded")
        info = json.loads((directory / "result.json").read_text())
        require("error" not in info, info.get("error", "invalid_pdf"))
        return info
    except subprocess.TimeoutExpired:
        raise Blocked("limit_exceeded") from None


def prepare(client, settings, scanner, tenant, agreement, attempt, input_digest, files, render=isolated_render, scan=scan_bytes):
    require(isinstance(files, list) and 1 <= len(files) <= 10, "limit_exceeded")
    require(re.fullmatch(r"[a-f0-9]{64}", input_digest or ""), "result_invalid")
    require(files[0].get("role") == "primary" and sum(f.get("role") == "primary" for f in files) == 1, "result_invalid")
    require(len({identity(f["fileId"]) for f in files}) == len(files), "result_invalid")
    require(all(f.get("role") in ("primary", "annexure") and type(f.get("sizeBytes")) is int and 0 < f["sizeBytes"] <= FILE_LIMIT for f in files), "limit_exceeded")
    require(sum(f["sizeBytes"] for f in files) <= INPUT_LIMIT, "limit_exceeded")
    prefix = f"prepared/{tenant}/{agreement}/{identity(attempt)}"
    bucket = settings["frozen_bucket"]
    # A complete retained manifest is the idempotency receipt. Never overwrite it with a new scan timestamp.
    try:
        existing, mv, until = read_object(client, bucket, prefix+"/manifest.json", 2*MIB, protected=True)
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") not in ("NoSuchKey", "404", "NotFound"):
            raise
    else:
        manifest = json.loads(existing)
        require(manifest.get("tenantId") == tenant and manifest.get("agreementId") == agreement and manifest.get("attemptId") == attempt and manifest.get("inputDigest") == input_digest, "result_invalid")
        require([{k: f[k] for k in ("fileId", "uploadId", "sourceVersion", "sizeBytes", "role")} for f in manifest["sources"]] == files, "source_changed")
        body, pv, pdf_until = read_object(client, bucket, prefix+"/bundle.pdf", OUTPUT_LIMIT, protected=True)
        require(digest(body) == manifest["pdfHash"] and len(body) == manifest["sizeBytes"], "storage_failed")
        return {"status": "ready", "manifest": manifest, "manifestHash": digest(existing), "artifactKey": prefix+"/bundle.pdf", "storageVersion": pv, "manifestKey": prefix+"/manifest.json", "manifestVersion": mv, "retainUntil": int(min(until, pdf_until).timestamp()*1000)}
    started, sources = time.monotonic(), []
    with tempfile.TemporaryDirectory(prefix="signing-") as directory:
        root = Path(directory)
        for f in files:
            require(time.monotonic() - started < 120, "limit_exceeded")
            key = f"quarantine/{tenant}/{agreement}/{identity(f['uploadId'])}.pdf"
            body, _, _ = read_object(client, settings["quarantine_bucket"], key, FILE_LIMIT, version(f["sourceVersion"]))
            require(len(body) == f["sizeBytes"], "source_changed")
            scanned = scan(body, scanner)  # Always before parsing untrusted PDF content.
            (root / f"source-{len(sources)}.pdf").write_bytes(body)
            sources.append({**f, "sha256": digest(body), "scanEngine": scanned["engine"], "scanVersion": scanned["version"], "scannedAt": scanned["scannedAt"]})
        (root / "input.json").write_text(json.dumps(files))
        info = render(root)
        require(time.monotonic() - started < 220, "limit_exceeded")
        pdf = (root / "bundle.pdf").read_bytes()
        require(0 < len(pdf) <= OUTPUT_LIMIT, "limit_exceeded")
        output_scan = scan(pdf, scanner)
        offset = 0
        for source, count in zip(sources, info["counts"], strict=True):
            source.update(pageStartIndex=offset, pageCount=count)
            offset += count
        manifest = {"contractVersion": 1, "tenantId": tenant, "agreementId": agreement, "attemptId": attempt,
            "inputDigest": input_digest, "rendererVersion": info["rendererVersion"], "pdfHash": digest(pdf), "sizeBytes": len(pdf),
            "sources": sources, "pages": info["pages"], "outputScan": output_scan}
        encoded = rfc8785.dumps(manifest)
        require(len(encoded) <= 2*MIB, "limit_exceeded")
        pv, pdf_until = put_frozen(client, bucket, prefix+"/bundle.pdf", pdf, "application/pdf", settings["retention_days"])
        mv, until = put_frozen(client, bucket, prefix+"/manifest.json", encoded, "application/json", settings["retention_days"])
        return {"status": "ready", "manifest": manifest, "manifestHash": digest(encoded), "artifactKey": prefix+"/bundle.pdf", "storageVersion": pv,
            "manifestKey": prefix+"/manifest.json", "manifestVersion": mv, "retainUntil": int(min(until, pdf_until).timestamp()*1000)}


def attachment_key(prefix, tenant, agreement, payload):
    require(payload.get("contentType") in ATTACHMENT_MAGIC, "unsupported_file")
    return f"{prefix}/{tenant}/{agreement}/{identity(payload['attachmentId'])}"


def attachment(client, settings, scanner, operation, tenant, agreement, payload, scan=scan_bytes):
    """Participant uploads: quarantine -> type check -> malware scan -> retained copy. Never parsed or OCR'd."""
    content_type = payload.get("contentType")
    if operation == "attachment_download":
        key = attachment_key("attachments", tenant, agreement, payload)
        body, saved_version, _ = read_object(client, settings["frozen_bucket"], key, ATTACHMENT_LIMIT, payload.get("storageVersion"), protected=True)
        require(digest(body) == payload.get("sha256"), "storage_failed")
        url = client.generate_presigned_url("get_object", Params={"Bucket": settings["frozen_bucket"], "Key": key, "VersionId": saved_version,
            "ResponseContentType": content_type, "ResponseContentDisposition": "attachment"}, ExpiresIn=60)
        require(urlparse(url).scheme == "https", "storage_failed")
        return {"status": "download", "url": url, "expiresAt": int(time.time()*1000)+60_000}
    size = payload.get("sizeBytes")
    require(type(size) is int and 0 < size <= ATTACHMENT_LIMIT, "limit_exceeded")
    key = attachment_key("attachments-quarantine", tenant, agreement, payload)
    if operation == "attachment_upload":
        form = client.generate_presigned_post(Bucket=settings["quarantine_bucket"], Key=key, Fields={"Content-Type": content_type},
            Conditions=[{"Content-Type": content_type}, ["content-length-range", size, size]], ExpiresIn=300)
        require(urlparse(form["url"]).scheme == "https", "storage_failed")
        return {"status": "upload", "url": form["url"], "fields": form["fields"]}
    body, _, _ = read_object(client, settings["quarantine_bucket"], key, ATTACHMENT_LIMIT)
    require(len(body) == size, "source_changed")
    require(body.startswith(ATTACHMENT_MAGIC[content_type]), "unsupported_file")
    scanned = scan(body, scanner)
    retained = attachment_key("attachments", tenant, agreement, payload)
    saved_version, until = put_frozen(client, settings["frozen_bucket"], retained, body, content_type, settings["retention_days"])
    return {"status": "clean", "sha256": digest(body), "storageVersion": saved_version, "retainUntil": int(until.timestamp()*1000),
        "scanEngine": scanned["engine"], "scanVersion": scanned["version"], "scannedAt": scanned["scannedAt"]}


def main(operation: str, tenant_id: str, agreement_id: str, payload: dict):
    try:
        tenant, agreement = identity(tenant_id), identity(agreement_id)
        require(operation in ("upload", "stat", "prepare", "download", "attachment_upload", "attachment_scan", "attachment_download"), "result_invalid")
        settings = wmill.get_resource("f/signing/document_storage")
        endpoint = urlparse(settings.get("endpoint", ""))
        require(endpoint.scheme == "https" and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment, "not_configured")
        require(type(settings.get("retention_days")) is int and 1 <= settings["retention_days"] <= 36500, "not_configured")
        require(settings.get("quarantine_bucket") and settings.get("frozen_bucket") and settings["quarantine_bucket"] != settings["frozen_bucket"], "not_configured")
        client = boto3.client("s3", endpoint_url=settings["endpoint"], region_name=settings.get("region", "us-east-1"),
            aws_access_key_id=settings["access_key"], aws_secret_access_key=settings["secret_key"],
            config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=20, retries={"max_attempts": 1}, s3={"addressing_style": "path"}))
        bucket = settings["quarantine_bucket"]
        private_bucket(client, bucket)
        if operation.startswith("attachment_"):
            if operation != "attachment_upload":
                private_bucket(client, settings["frozen_bucket"], frozen=True)
            scanner = wmill.get_resource("f/signing/pdf_scanner") if operation == "attachment_scan" else None
            return attachment(client, settings, scanner, operation, tenant, agreement, payload)
        if operation in ("upload", "stat"):
            key = f"quarantine/{tenant}/{agreement}/{identity(payload['uploadId'])}.pdf"
            size = payload.get("sizeBytes")
            require(type(size) is int and 0 < size <= FILE_LIMIT, "limit_exceeded")
            if operation == "upload":
                form = client.generate_presigned_post(Bucket=bucket, Key=key, Fields={"Content-Type": "application/pdf"},
                    Conditions=[{"Content-Type": "application/pdf"}, ["content-length-range", size, size]], ExpiresIn=300)
                require(urlparse(form["url"]).scheme == "https", "storage_failed")
                return {"status": "upload", "url": form["url"], "fields": form["fields"]}
            obj = client.head_object(Bucket=bucket, Key=key)
            require(obj.get("ContentLength") == size and obj.get("ContentType") == "application/pdf" and obj.get("ServerSideEncryption") in ("AES256", "aws:kms"), "source_changed")
            return {"status": "quarantined", "sourceVersion": version(obj.get("VersionId")), "sizeBytes": size}
        bucket = settings["frozen_bucket"]
        private_bucket(client, bucket, frozen=True)
        if operation == "prepare":
            return prepare(client, settings, wmill.get_resource("f/signing/pdf_scanner"), tenant, agreement, payload["attemptId"], payload["inputDigest"], payload["files"])
        prefix = f"prepared/{tenant}/{agreement}/{identity(payload['attemptId'])}"
        manifest, _, _ = read_object(client, bucket, prefix+"/manifest.json", 2*MIB, payload["manifestVersion"], protected=True)
        require(digest(manifest) == payload["manifestHash"], "storage_failed")
        data = json.loads(manifest)
        require(data["tenantId"] == tenant and data["agreementId"] == agreement and data["attemptId"] == payload["attemptId"], "result_invalid")
        pdf, pv, _ = read_object(client, bucket, prefix+"/bundle.pdf", OUTPUT_LIMIT, payload["storageVersion"], protected=True)
        require(digest(pdf) == payload["pdfHash"] == data["pdfHash"], "storage_failed")
        url = client.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": prefix+"/bundle.pdf", "VersionId": pv, "ResponseContentType": "application/pdf", "ResponseContentDisposition": 'inline; filename="agreement.pdf"'}, ExpiresIn=60)
        require(urlparse(url).scheme == "https", "storage_failed")
        return {"status": "download", "url": url, "expiresAt": int(time.time()*1000)+60_000}
    except Blocked as error:
        return {"status": "blocked", "error": str(error) if str(error) in ERRORS else "preparation_failed"}
    except Exception:
        # Provider/parser exceptions can contain private keys, URLs, paths or document text.
        return {"status": "blocked", "error": "preparation_failed"}
