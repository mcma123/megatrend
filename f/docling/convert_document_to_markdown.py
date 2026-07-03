from __future__ import annotations

import json
import mimetypes
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

import boto3
import requests
import wmill
from botocore.config import Config
from wmill import S3Object


DEFAULT_DOCLING_BASE_URL = "http://rag-infrastucture-doclingserve-6e6e80-84-8-132-135.sslip.io"
DEFAULT_MINIO_ENDPOINT = "minio.mmfshub.co.za"
DEFAULT_MINIO_BUCKET = "parsedinjson"
DEFAULT_MINIO_ACCESS_KEY = "minioadmin"
DEFAULT_MINIO_SECRET_KEY = "bcskn3p8iwmkaxor"
DEFAULT_MINIO_REGION = "us-east-1"
SUPPORTED_FROM_FORMATS = {
    "pdf",
    "docx",
    "pptx",
    "html",
    "image",
    "asciidoc",
    "md",
    "csv",
    "xlsx",
    "xml_uspto",
    "xml_jats",
    "xml_xbrl",
    "xml_doclang",
    "mets_gbs",
    "json_docling",
    "audio",
    "vtt",
    "latex",
    "email",
    "epub",
}
EXTENSION_TO_FORMAT = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
    ".htm": "html",
    ".html": "html",
    ".png": "image",
    ".jpg": "image",
    ".jpeg": "image",
    ".tif": "image",
    ".tiff": "image",
    ".bmp": "image",
    ".gif": "image",
    ".webp": "image",
    ".adoc": "asciidoc",
    ".asciidoc": "asciidoc",
    ".md": "md",
    ".markdown": "md",
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".xml": "xml_doclang",
    ".json": "json_docling",
    ".mp3": "audio",
    ".wav": "audio",
    ".m4a": "audio",
    ".flac": "audio",
    ".ogg": "audio",
    ".vtt": "vtt",
    ".tex": "latex",
    ".eml": "email",
    ".epub": "epub",
}
FILENAME_CANDIDATE_KEYS = (
    "filename",
    "name",
    "originalName",
    "original_name",
    "fileName",
    "file_name",
)


def _normalize_base_url(base_url: str) -> str:
    return base_url.rstrip("/")


def _new_session() -> requests.Session:
    session = requests.Session()
    session.trust_env = False
    return session


def _clean_filename(value: str | None) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    cleaned = unquote(cleaned)
    return Path(cleaned).name or None


def _guess_filename(file: S3Object | None, filename: str | None, file_url: str | None) -> str:
    explicit = _clean_filename(filename)
    if explicit:
        return explicit

    if isinstance(file, dict):
        for key in FILENAME_CANDIDATE_KEYS:
            candidate = _clean_filename(file.get(key))
            if candidate:
                return candidate

        s3_value = file.get("s3")
        if isinstance(s3_value, str) and s3_value.strip():
            candidate = Path(s3_value).name
            if candidate:
                return candidate

    if file_url:
        parsed = urlparse(file_url)
        candidate = _clean_filename(parsed.path)
        if candidate:
            return candidate

    return "document"


def _guess_from_format(filename: str, from_format: str | None) -> str | None:
    if from_format:
        normalized = from_format.strip().lower()
        if normalized not in SUPPORTED_FROM_FORMATS:
            raise ValueError(
                f"Unsupported from_format '{from_format}'. Supported values: {sorted(SUPPORTED_FROM_FORMATS)}"
            )
        return normalized

    return EXTENSION_TO_FORMAT.get(Path(filename).suffix.lower())


def _coerce_bool(value: bool) -> str:
    return "true" if value else "false"


def _build_common_fields(
    *,
    detected_from_format: str | None,
    do_ocr: bool,
    force_ocr: bool,
    ocr_lang: list[str] | None,
    ocr_preset: str,
    pdf_backend: str,
    table_mode: str,
    include_images: bool,
    include_page_images: bool,
    image_export_mode: str,
    document_timeout: float | None,
) -> list[tuple[str, str]]:
    fields: list[tuple[str, str]] = [("to_formats", "md"), ("target_type", "inbody")]

    if detected_from_format:
        fields.append(("from_formats", detected_from_format))

    fields.extend(
        [
            ("do_ocr", _coerce_bool(do_ocr)),
            ("force_ocr", _coerce_bool(force_ocr)),
            ("ocr_preset", ocr_preset),
            ("pdf_backend", pdf_backend),
            ("table_mode", table_mode),
            ("include_images", _coerce_bool(include_images)),
            ("include_page_images", _coerce_bool(include_page_images)),
            ("image_export_mode", image_export_mode),
        ]
    )

    if document_timeout is not None:
        fields.append(("document_timeout", str(document_timeout)))

    if ocr_lang:
        for lang in ocr_lang:
            fields.append(("ocr_lang", lang))

    return fields


def _extract_markdown(payload: dict[str, Any]) -> str | None:
    document = payload.get("document") or {}
    markdown = document.get("md_content")
    if isinstance(markdown, str) and markdown.strip():
        return markdown

    text_content = document.get("text_content")
    if isinstance(text_content, str) and text_content.strip():
        return text_content

    return None


def _save_json_to_minio(
    *,
    payload: dict[str, Any],
    resolved_filename: str,
    minio_endpoint: str,
    minio_bucket: str,
    minio_access_key: str,
    minio_secret_key: str,
    minio_use_ssl: bool,
    minio_region: str,
    minio_path_prefix: str | None,
) -> dict[str, str]:
    object_name = f"{Path(resolved_filename).stem}.json"
    prefix = (minio_path_prefix or "").strip("/")
    object_key = f"{prefix}/{object_name}" if prefix else object_name

    output_payload = {
        "source_filename": resolved_filename,
        "parsed_result": payload,
    }

    s3_client = boto3.client(
        "s3",
        endpoint_url=f"{'https' if minio_use_ssl else 'http'}://{minio_endpoint}",
        aws_access_key_id=minio_access_key,
        aws_secret_access_key=minio_secret_key,
        region_name=minio_region,
        config=Config(s3={"addressing_style": "path"}),
    )
    s3_client.put_object(
        Bucket=minio_bucket,
        Key=object_key,
        Body=json.dumps(output_payload, indent=2).encode("utf-8"),
        ContentType="application/json; charset=utf-8",
    )
    return {
        "bucket": minio_bucket,
        "key": object_key,
        "endpoint": minio_endpoint,
    }


def _convert_uploaded_file(
    *,
    session: requests.Session,
    docling_base_url: str,
    tenant_id: str | None,
    file: S3Object,
    resolved_filename: str,
    detected_from_format: str | None,
    do_ocr: bool,
    force_ocr: bool,
    ocr_lang: list[str] | None,
    ocr_preset: str,
    pdf_backend: str,
    table_mode: str,
    include_images: bool,
    include_page_images: bool,
    image_export_mode: str,
    document_timeout: float | None,
    request_timeout_seconds: int,
) -> dict[str, Any]:
    file_bytes = wmill.load_s3_file(file)
    mime_type = mimetypes.guess_type(resolved_filename)[0] or "application/octet-stream"
    headers: dict[str, str] = {}
    if tenant_id:
        headers["X-Tenant-Id"] = tenant_id

    response = session.post(
        f"{_normalize_base_url(docling_base_url)}/v1/convert/file",
        headers=headers,
        data=_build_common_fields(
            detected_from_format=detected_from_format,
            do_ocr=do_ocr,
            force_ocr=force_ocr,
            ocr_lang=ocr_lang,
            ocr_preset=ocr_preset,
            pdf_backend=pdf_backend,
            table_mode=table_mode,
            include_images=include_images,
            include_page_images=include_page_images,
            image_export_mode=image_export_mode,
            document_timeout=document_timeout,
        ),
        files=[("files", (resolved_filename, file_bytes, mime_type))],
        timeout=request_timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def _convert_source_url(
    *,
    session: requests.Session,
    docling_base_url: str,
    tenant_id: str | None,
    file_url: str,
    detected_from_format: str | None,
    do_ocr: bool,
    force_ocr: bool,
    ocr_lang: list[str] | None,
    ocr_preset: str,
    pdf_backend: str,
    table_mode: str,
    include_images: bool,
    include_page_images: bool,
    image_export_mode: str,
    document_timeout: float | None,
    request_timeout_seconds: int,
) -> dict[str, Any]:
    headers: dict[str, str] = {}
    if tenant_id:
        headers["X-Tenant-Id"] = tenant_id

    options: dict[str, Any] = {
        "to_formats": ["md"],
        "image_export_mode": image_export_mode,
        "do_ocr": do_ocr,
        "force_ocr": force_ocr,
        "ocr_preset": ocr_preset,
        "pdf_backend": pdf_backend,
        "table_mode": table_mode,
        "include_images": include_images,
        "include_page_images": include_page_images,
    }
    if detected_from_format:
        options["from_formats"] = [detected_from_format]
    if ocr_lang:
        options["ocr_lang"] = ocr_lang
    if document_timeout is not None:
        options["document_timeout"] = document_timeout

    response = session.post(
        f"{_normalize_base_url(docling_base_url)}/v1/convert/source",
        headers=headers,
        json={
            "options": options,
            "sources": [{"kind": "http", "url": file_url, "headers": {}}],
        },
        timeout=request_timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def main(
    file: S3Object | None = None,
    file_url: str | None = None,
    filename: str | None = None,
    docling_base_url: str | None = DEFAULT_DOCLING_BASE_URL,
    from_format: str | None = None,
    do_ocr: bool = True,
    force_ocr: bool = False,
    ocr_lang: list[str] | None = None,
    ocr_preset: str = "auto",
    pdf_backend: str = "docling_parse",
    table_mode: str = "accurate",
    include_images: bool = False,
    include_page_images: bool = False,
    image_export_mode: str = "placeholder",
    document_timeout: float | None = None,
    request_timeout_seconds: int = 300,
    tenant_id: str | None = None,
    save_markdown_to_s3: bool = False,
    output_s3_path: str | None = None,
    save_json_to_minio: bool = True,
    minio_endpoint: str | None = DEFAULT_MINIO_ENDPOINT,
    minio_bucket: str | None = DEFAULT_MINIO_BUCKET,
    minio_access_key: str | None = DEFAULT_MINIO_ACCESS_KEY,
    minio_secret_key: str | None = DEFAULT_MINIO_SECRET_KEY,
    minio_use_ssl: bool = True,
    minio_region: str | None = DEFAULT_MINIO_REGION,
    minio_path_prefix: str | None = None,
) -> dict[str, Any]:
    if file is None and not file_url:
        raise ValueError("Provide either 'file' or 'file_url'.")
    if file is not None and file_url:
        raise ValueError("Provide only one source: either 'file' or 'file_url'.")

    docling_base_url = docling_base_url or DEFAULT_DOCLING_BASE_URL
    minio_endpoint = minio_endpoint or DEFAULT_MINIO_ENDPOINT
    minio_bucket = minio_bucket or DEFAULT_MINIO_BUCKET
    minio_access_key = minio_access_key or DEFAULT_MINIO_ACCESS_KEY
    minio_secret_key = minio_secret_key or DEFAULT_MINIO_SECRET_KEY
    minio_region = minio_region or DEFAULT_MINIO_REGION

    resolved_filename = _guess_filename(file, filename, file_url)
    detected_from_format = _guess_from_format(resolved_filename, from_format)
    session = _new_session()

    if file is not None:
        payload = _convert_uploaded_file(
            session=session,
            docling_base_url=docling_base_url,
            tenant_id=tenant_id,
            file=file,
            resolved_filename=resolved_filename,
            detected_from_format=detected_from_format,
            do_ocr=do_ocr,
            force_ocr=force_ocr,
            ocr_lang=ocr_lang,
            ocr_preset=ocr_preset,
            pdf_backend=pdf_backend,
            table_mode=table_mode,
            include_images=include_images,
            include_page_images=include_page_images,
            image_export_mode=image_export_mode,
            document_timeout=document_timeout,
            request_timeout_seconds=request_timeout_seconds,
        )
        source_kind = "file"
    else:
        payload = _convert_source_url(
            session=session,
            docling_base_url=docling_base_url,
            tenant_id=tenant_id,
            file_url=file_url,
            detected_from_format=detected_from_format,
            do_ocr=do_ocr,
            force_ocr=force_ocr,
            ocr_lang=ocr_lang,
            ocr_preset=ocr_preset,
            pdf_backend=pdf_backend,
            table_mode=table_mode,
            include_images=include_images,
            include_page_images=include_page_images,
            image_export_mode=image_export_mode,
            document_timeout=document_timeout,
            request_timeout_seconds=request_timeout_seconds,
        )
        source_kind = "url"

    markdown = _extract_markdown(payload)
    if markdown is None:
        raise ValueError(
            "DocLing response did not include markdown or text content. "
            f"Response keys: {sorted(payload.keys())}"
        )

    saved_output: S3Object | None = None
    if save_markdown_to_s3:
        target = output_s3_path or f"docling-output/{Path(resolved_filename).stem}.md"
        saved_output = wmill.write_s3_file(
            target,
            markdown.encode("utf-8"),
            None,
            "text/markdown; charset=utf-8",
        )

    saved_json_to_minio: dict[str, str] | None = None
    if save_json_to_minio:
        saved_json_to_minio = _save_json_to_minio(
            payload=payload,
            resolved_filename=resolved_filename,
            minio_endpoint=minio_endpoint,
            minio_bucket=minio_bucket,
            minio_access_key=minio_access_key,
            minio_secret_key=minio_secret_key,
            minio_use_ssl=minio_use_ssl,
            minio_region=minio_region,
            minio_path_prefix=minio_path_prefix,
        )

    return {
        "source_kind": source_kind,
        "filename": resolved_filename,
        "file_url": file_url,
        "from_format": detected_from_format,
        "status": payload.get("status"),
        "processing_time": payload.get("processing_time"),
        "markdown": markdown,
        "saved_markdown": saved_output,
        "saved_json_to_minio": saved_json_to_minio,
        "errors": payload.get("errors", []),
        "timings": payload.get("timings", {}),
        "confidence": payload.get("confidence"),
        "document": {
            "filename": (payload.get("document") or {}).get("filename"),
            "html_content": (payload.get("document") or {}).get("html_content"),
            "text_content": (payload.get("document") or {}).get("text_content"),
        },
        "raw_response": json.loads(json.dumps(payload)),
    }
