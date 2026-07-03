from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config


DEFAULT_MINIO_ENDPOINT = "minio.mmfshub.co.za"
DEFAULT_MINIO_ACCESS_KEY = "minioadmin"
DEFAULT_MINIO_SECRET_KEY = "bcskn3p8iwmkaxor"
DEFAULT_MINIO_REGION = "us-east-1"
DEFAULT_SOURCE_BUCKET = "parsedinjson"
DEFAULT_DESTINATION_BUCKET = "okfdata"
DEFAULT_CONCEPT_TYPE = "Parsed Document"
DEFAULT_TAGS = ["docling", "okf", "parsed-document"]


def _safe_object_component(value: str) -> str:
    cleaned = re.sub(r"[\\/]+", "-", value).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    cleaned = cleaned.strip(".")
    return cleaned or "document"


def _new_s3_client(
    *,
    endpoint: str,
    access_key: str,
    secret_key: str,
    region: str,
    use_ssl: bool,
):
    return boto3.client(
        "s3",
        endpoint_url=f"{'https' if use_ssl else 'http'}://{endpoint}",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(s3={"addressing_style": "path"}),
    )


def _load_parsed_payload(
    *,
    client,
    source_bucket: str,
    parsed_json_key: str,
) -> tuple[str, dict[str, Any], dict[str, Any]]:
    response = client.get_object(Bucket=source_bucket, Key=parsed_json_key)
    raw_body = response["Body"].read().decode("utf-8")
    parsed_wrapper = json.loads(raw_body)

    parsed_result = parsed_wrapper.get("parsed_result")
    if not isinstance(parsed_result, dict):
        raise ValueError("Parsed JSON object does not contain a 'parsed_result' object.")

    source_filename = parsed_wrapper.get("source_filename")
    if not isinstance(source_filename, str) or not source_filename.strip():
        source_filename = Path(parsed_json_key).stem

    return source_filename, parsed_result, parsed_wrapper


def _extract_markdown(parsed_result: dict[str, Any]) -> str:
    document = parsed_result.get("document") or {}
    markdown = document.get("md_content")
    if isinstance(markdown, str) and markdown.strip():
        return markdown.strip()

    text_content = document.get("text_content")
    if isinstance(text_content, str) and text_content.strip():
        return text_content.strip()

    raise ValueError("Parsed JSON does not contain DocLing markdown or text content.")


def _extract_headings(markdown_body: str) -> list[str]:
    headings: list[str] = []
    for line in markdown_body.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            heading = stripped.lstrip("#").strip()
            if heading:
                headings.append(heading)
    return headings


def _extract_text_preview(markdown_body: str, limit: int = 800) -> str:
    preview = re.sub(r"```.*?```", " ", markdown_body, flags=re.DOTALL)
    preview = re.sub(r"`([^`]*)`", r"\1", preview)
    preview = re.sub(r"!\[[^\]]*\]\([^\)]*\)", " ", preview)
    preview = re.sub(r"\[[^\]]*\]\([^\)]*\)", " ", preview)
    preview = re.sub(r"[#>*_-]", " ", preview)
    preview = re.sub(r"\s+", " ", preview).strip()
    if len(preview) <= limit:
        return preview
    return preview[: limit - 3].rstrip() + "..."


def _yaml_list(values: list[str]) -> str:
    return "[" + ", ".join(json.dumps(value) for value in values) + "]"


def _markdown_list(values: list[str]) -> str:
    if not values:
        return "- None\n"
    return "".join(f"- {value}\n" for value in values)


def _json_code_block(value: Any) -> str:
    return "```json\n" + json.dumps(value, indent=2, sort_keys=True) + "\n```\n"


def _build_concept_markdown(
    *,
    source_filename: str,
    concept_type: str,
    tags: list[str],
    parsed_json_key: str,
    parsed_result: dict[str, Any],
) -> str:
    title = Path(source_filename).name
    description = f"Parsed DocLing output for {title}."
    timestamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    markdown_body = _extract_markdown(parsed_result)
    headings = _extract_headings(markdown_body)
    preview = _extract_text_preview(markdown_body)
    errors = parsed_result.get("errors") or []
    document_meta = parsed_result.get("document") or {}

    frontmatter_lines = [
        "---",
        f"type: {concept_type}",
        f"title: {json.dumps(title)}",
        f"description: {json.dumps(description)}",
        f"tags: {_yaml_list(tags)}",
        f"timestamp: {timestamp}",
        f"source_filename: {json.dumps(source_filename)}",
        f"source_object: {json.dumps(parsed_json_key)}",
        "---",
        "",
    ]

    body_lines = [
        "# Summary",
        description,
        "",
        "# Source Document",
        f"- Display name: `{title}`",
        f"- Original filename: `{source_filename}`",
        f"- Parsed JSON object: `{parsed_json_key}`",
        f"- Status: `{parsed_result.get('status', 'unknown')}`",
    ]

    processing_time = parsed_result.get("processing_time")
    if processing_time is not None:
        body_lines.append(f"- Processing time: `{processing_time}` seconds")
    if isinstance(document_meta, dict) and document_meta.get("filename"):
        body_lines.append(f"- DocLing document filename: `{document_meta['filename']}`")

    body_lines.extend(
        [
            "",
            "# Extracted Outline",
            _markdown_list(headings).rstrip(),
            "",
            "# Preview",
            preview or "No preview available.",
            "",
            "# Parsed Markdown",
            markdown_body,
        ]
    )

    if errors:
        body_lines.extend(["", "# Errors"])
        for error in errors:
            if isinstance(error, dict):
                message = error.get("error_message") or error.get("message") or json.dumps(error)
            else:
                message = str(error)
            body_lines.append(f"- {message}")

    body_lines.extend(
        [
            "",
            "# Citations",
            f"- Parsed JSON source object: `{parsed_json_key}`",
        ]
    )

    return "\n".join(frontmatter_lines + body_lines).strip() + "\n"


def _build_root_index(bundle_name: str, title: str) -> str:
    return (
        "# Open Knowledge Format Bundle\n"
        f"Bundle for `{title}`.\n\n"
        "## Contents\n"
        "- [documents](documents/index.md)\n"
        "- [metadata](metadata/index.md)\n"
        f"- [primary document](documents/{bundle_name}.md)\n"
        "- [source metadata](metadata/source.md)\n"
        "- [processing report](metadata/processing.md)\n"
    )


def _build_documents_index(document_filename: str, title: str) -> str:
    return (
        "# Documents\n"
        f"- [{title}]({document_filename}) - Primary parsed document in OKF markdown form.\n"
    )


def _build_metadata_index() -> str:
    return (
        "# Metadata\n"
        "- [source.md](source.md) - Source document and naming metadata.\n"
        "- [processing.md](processing.md) - Parser status, timings, and diagnostic metadata.\n"
    )


def _build_source_metadata_markdown(
    *,
    source_filename: str,
    parsed_json_key: str,
    parsed_wrapper: dict[str, Any],
) -> str:
    title = Path(source_filename).name
    stem = Path(source_filename).stem
    wrapper_keys = sorted(parsed_wrapper.keys())

    body = [
        "# Source Metadata",
        "",
        f"- Display name: `{title}`",
        f"- Source filename: `{source_filename}`",
        f"- Source stem: `{stem}`",
        f"- Parsed JSON object: `{parsed_json_key}`",
        f"- Wrapper keys: `{', '.join(wrapper_keys)}`",
        "",
        "## Parsed Wrapper",
        _json_code_block(parsed_wrapper),
    ]
    return "\n".join(body).strip() + "\n"


def _build_processing_markdown(
    *,
    parsed_result: dict[str, Any],
    source_filename: str,
) -> str:
    document_meta = parsed_result.get("document") or {}
    timings = parsed_result.get("timings") or {}
    errors = parsed_result.get("errors") or []
    markdown_body = _extract_markdown(parsed_result)

    body = [
        "# Processing Report",
        "",
        f"- Source filename: `{source_filename}`",
        f"- Status: `{parsed_result.get('status', 'unknown')}`",
        f"- Processing time: `{parsed_result.get('processing_time', 'unknown')}`",
        f"- Confidence: `{parsed_result.get('confidence', 'unknown')}`",
        f"- Markdown length: `{len(markdown_body)}` characters",
        f"- Heading count: `{len(_extract_headings(markdown_body))}`",
    ]

    if isinstance(document_meta, dict):
        if document_meta.get("filename"):
            body.append(f"- Document filename from parser: `{document_meta['filename']}`")
        if document_meta.get("origin"):
            body.append(f"- Document origin: `{document_meta['origin']}`")

    body.extend(["", "## Timings", _json_code_block(timings)])

    if errors:
        body.extend(["", "## Errors", _json_code_block(errors)])

    return "\n".join(body).strip() + "\n"


def _put_text_object(*, client, bucket: str, key: str, content: str) -> None:
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=content.encode("utf-8"),
        ContentType="text/markdown; charset=utf-8",
    )


def main(
    parsed_json_key: str,
    source_bucket: str | None = DEFAULT_SOURCE_BUCKET,
    destination_bucket: str | None = DEFAULT_DESTINATION_BUCKET,
    bundle_prefix: str | None = None,
    concept_type: str | None = DEFAULT_CONCEPT_TYPE,
    tags: list[str] | None = None,
    minio_endpoint: str | None = DEFAULT_MINIO_ENDPOINT,
    minio_access_key: str | None = DEFAULT_MINIO_ACCESS_KEY,
    minio_secret_key: str | None = DEFAULT_MINIO_SECRET_KEY,
    minio_use_ssl: bool = True,
    minio_region: str | None = DEFAULT_MINIO_REGION,
) -> dict[str, Any]:
    source_bucket = source_bucket or DEFAULT_SOURCE_BUCKET
    destination_bucket = destination_bucket or DEFAULT_DESTINATION_BUCKET
    concept_type = concept_type or DEFAULT_CONCEPT_TYPE
    minio_endpoint = minio_endpoint or DEFAULT_MINIO_ENDPOINT
    minio_access_key = minio_access_key or DEFAULT_MINIO_ACCESS_KEY
    minio_secret_key = minio_secret_key or DEFAULT_MINIO_SECRET_KEY
    minio_region = minio_region or DEFAULT_MINIO_REGION
    tags = tags or list(DEFAULT_TAGS)

    client = _new_s3_client(
        endpoint=minio_endpoint,
        access_key=minio_access_key,
        secret_key=minio_secret_key,
        region=minio_region,
        use_ssl=minio_use_ssl,
    )

    source_filename, parsed_result, parsed_wrapper = _load_parsed_payload(
        client=client,
        source_bucket=source_bucket,
        parsed_json_key=parsed_json_key,
    )

    title = Path(source_filename).name
    object_stem = _safe_object_component(Path(source_filename).stem)
    bundle_root_name = object_stem
    bundle_root = f"{bundle_prefix.strip('/')}/{bundle_root_name}" if bundle_prefix and bundle_prefix.strip('/') else bundle_root_name
    document_filename = f"{object_stem}.md"

    objects = {
        f"{bundle_root}/index.md": _build_root_index(bundle_root_name, title),
        f"{bundle_root}/documents/index.md": _build_documents_index(document_filename, title),
        f"{bundle_root}/documents/{document_filename}": _build_concept_markdown(
            source_filename=source_filename,
            concept_type=concept_type,
            tags=tags,
            parsed_json_key=parsed_json_key,
            parsed_result=parsed_result,
        ),
        f"{bundle_root}/metadata/index.md": _build_metadata_index(),
        f"{bundle_root}/metadata/source.md": _build_source_metadata_markdown(
            source_filename=source_filename,
            parsed_json_key=parsed_json_key,
            parsed_wrapper=parsed_wrapper,
        ),
        f"{bundle_root}/metadata/processing.md": _build_processing_markdown(
            parsed_result=parsed_result,
            source_filename=source_filename,
        ),
    }

    for key, content in objects.items():
        _put_text_object(client=client, bucket=destination_bucket, key=key, content=content)

    written_keys = list(objects.keys())
    return {
        "source_bucket": source_bucket,
        "parsed_json_key": parsed_json_key,
        "destination_bucket": destination_bucket,
        "bundle_root": bundle_root,
        "written_keys": written_keys,
        "concept_id": f"documents/{object_stem}",
        "title": title,
        "description": f"Parsed DocLing output for {title}.",
        "source_filename": source_filename,
        "document_filename": document_filename,
    }
