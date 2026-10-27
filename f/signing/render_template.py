# requirements:
# boto3
# wmill
# requests
# pypdf==6.21.2
"""Renders server-generated agreement HTML to PDF through a private, network-isolated Chromium
converter, normalises volatile PDF metadata so identical HTML yields identical bytes, and stores
the result in signing quarantine for the normal scan/preparation pipeline. Never serves files."""
import hashlib
import io
import re
import time
from urllib.parse import urlparse

import boto3
import requests
import wmill
from botocore.config import Config

from f.signing.prepare_bundle import Blocked, identity, private_bucket, read_object, require, version

MIB = 1024 * 1024
HTML_LIMIT, PDF_LIMIT, PAGE_LIMIT = 1 * MIB, 25 * MIB, 200
RENDERER = "gotenberg-chromium+pypdf-normalized-v1"
ERRORS = {"not_configured", "renderer_unavailable", "render_failed", "storage_failed", "limit_exceeded", "result_invalid"}
# Server HTML never needs these; their presence means the input was not produced by Convex.
FORBIDDEN = re.compile(r"<\s*(script|iframe|object|embed|link|img|svg|video|audio|base|meta\s+http-equiv|form)|\b(src|href|srcset|action)\s*=|url\s*\(|@import|javascript:", re.I)


def check_html(html, html_hash):
    require(isinstance(html, str) and 0 < len(html) <= HTML_LIMIT, "limit_exceeded")
    require(hashlib.sha256(html.encode("utf-8")).hexdigest() == html_hash, "result_invalid")
    require(html.startswith("<!doctype html>") and FORBIDDEN.search(html) is None, "result_invalid")
    return html.encode("utf-8")


def convert(html_bytes, settings, deadline):
    """Fixed Chromium HTML route; callers never choose the converter URL or form fields."""
    url = urlparse(settings.get("url", ""))
    require(url.scheme in ("http", "https") and url.hostname and not url.username and not url.password and not url.query and not url.fragment, "not_configured")
    require(settings.get("username") and settings.get("password"), "not_configured")
    try:
        with requests.post(
            settings["url"].rstrip("/") + "/forms/chromium/convert/html",
            files={"files": ("index.html", html_bytes, "text/html")},
            data={"preferCssPageSize": "true", "printBackground": "true", "emulatedMediaType": "print", "skipNetworkIdleEvent": "true"},
            auth=(settings["username"], settings["password"]),
            stream=True, timeout=(10, 120), allow_redirects=False,
        ) as response:
            require(response.status_code == 200, "renderer_unavailable")
            out = io.BytesIO()
            for chunk in response.iter_content(65536):
                require(time.monotonic() < deadline, "limit_exceeded")
                require(out.tell() + len(chunk) <= PDF_LIMIT, "limit_exceeded")
                out.write(chunk)
            pdf = out.getvalue()
    except requests.RequestException:
        raise Blocked("renderer_unavailable") from None
    require(pdf.startswith(b"%PDF-"), "render_failed")
    return pdf


def normalize(pdf, html_hash):
    """Drops creation dates, XMP and random IDs; the document ID derives from the HTML hash."""
    import pypdf
    from pypdf.generic import ArrayObject, ByteStringObject, NameObject
    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf), strict=False)
        require(not reader.is_encrypted and 0 < len(reader.pages) <= PAGE_LIMIT, "limit_exceeded")
        writer = pypdf.PdfWriter(clone_from=reader)
        writer.metadata = None
        writer.add_metadata({"/Producer": "Cyphersoft template renderer", "/Creator": RENDERER})
        writer._root_object.pop(NameObject("/Metadata"), None)
        fixed = bytes.fromhex(html_hash)[:16]
        writer._ID = ArrayObject([ByteStringObject(fixed), ByteStringObject(fixed)])
        out = io.BytesIO()
        writer.write(out)
        data = out.getvalue()
        check = pypdf.PdfReader(io.BytesIO(data), strict=False)
        return data, len(check.pages)
    except Blocked:
        raise
    except Exception:
        raise Blocked("render_failed") from None


def store(client, bucket, key, pdf):
    """One immutable object per generation upload; a retry must find byte-identical content."""
    try:
        client.put_object(Bucket=bucket, Key=key, Body=pdf, ContentType="application/pdf", IfNoneMatch="*", ChecksumAlgorithm="SHA256")
    except Exception as error:
        require(getattr(error, "response", {}).get("Error", {}).get("Code") in ("PreconditionFailed", "412"), "storage_failed")
    saved, saved_version, _ = read_object(client, bucket, key, PDF_LIMIT)
    require(saved == pdf, "storage_failed")
    return saved_version


def render(client, settings, renderer, tenant, agreement, payload, convert_fn=convert):
    generation, upload = identity(payload.get("generationId")), identity(payload.get("uploadId"))
    html_hash = payload.get("htmlHash")
    require(isinstance(html_hash, str) and re.fullmatch(r"[a-f0-9]{64}", html_hash) is not None, "result_invalid")
    html = check_html(payload.get("html"), html_hash)
    deadline = time.monotonic() + 200
    pdf, pages = normalize(convert_fn(html, renderer, deadline), html_hash)
    key = f"quarantine/{tenant}/{agreement}/{upload}.pdf"
    source_version = version(store(client, settings["quarantine_bucket"], key, pdf))
    return {"status": "rendered", "generationId": generation, "sourceVersion": source_version, "sizeBytes": len(pdf),
        "pdfHash": hashlib.sha256(pdf).hexdigest(), "pageCount": pages, "renderer": RENDERER}


def main(operation: str, tenant_id: str, agreement_id: str, payload: dict):
    try:
        tenant, agreement = identity(tenant_id), identity(agreement_id)
        require(operation == "render" and isinstance(payload, dict), "result_invalid")
        settings = wmill.get_resource("f/signing/document_storage")
        endpoint = urlparse(settings.get("endpoint", ""))
        require(endpoint.scheme == "https" and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment, "not_configured")
        require(settings.get("quarantine_bucket"), "not_configured")
        client = boto3.client("s3", endpoint_url=settings["endpoint"], region_name=settings.get("region", "us-east-1"),
            aws_access_key_id=settings["access_key"], aws_secret_access_key=settings["secret_key"],
            config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=20, retries={"max_attempts": 1}, s3={"addressing_style": "path"}))
        private_bucket(client, settings["quarantine_bucket"])
        return render(client, settings, wmill.get_resource("f/signing/template_renderer"), tenant, agreement, payload)
    except Blocked as error:
        return {"status": "blocked", "error": str(error) if str(error) in ERRORS else "render_failed"}
    except Exception:
        # Converter, storage and PDF exceptions can contain URLs, credentials or document text.
        return {"status": "blocked", "error": "render_failed"}
