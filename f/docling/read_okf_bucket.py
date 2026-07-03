from __future__ import annotations

import re
from collections import Counter
from pathlib import PurePosixPath
from typing import Any

import boto3
from botocore.config import Config


DEFAULT_MINIO_ENDPOINT = "minio.mmfshub.co.za"
DEFAULT_MINIO_ACCESS_KEY = "minioadmin"
DEFAULT_MINIO_SECRET_KEY = "bcskn3p8iwmkaxor"
DEFAULT_MINIO_REGION = "us-east-1"
DEFAULT_OKF_BUCKET = "okfdata"


def _new_s3_client(*, endpoint: str, access_key: str, secret_key: str, region: str, use_ssl: bool):
    return boto3.client(
        "s3",
        endpoint_url=f"{'https' if use_ssl else 'http'}://{endpoint}",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name=region,
        config=Config(s3={"addressing_style": "path"}),
    )


def _tokenize(text: str) -> list[str]:
    return [token for token in re.findall(r"[A-Za-z0-9_]+", text.lower()) if len(token) > 1]


def _load_text_object(*, client, bucket: str, key: str) -> str:
    response = client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read().decode("utf-8")


def _list_keys(*, client, bucket: str, prefix: str | None = None) -> list[dict[str, Any]]:
    continuation_token: str | None = None
    items: list[dict[str, Any]] = []
    while True:
        kwargs: dict[str, Any] = {"Bucket": bucket, "MaxKeys": 1000}
        if prefix:
            kwargs["Prefix"] = prefix.strip("/") + "/"
        if continuation_token:
            kwargs["ContinuationToken"] = continuation_token
        response = client.list_objects_v2(**kwargs)
        for item in response.get("Contents", []):
            key = item["Key"]
            items.append(
                {
                    "key": key,
                    "size": item.get("Size"),
                    "last_modified": item.get("LastModified").isoformat() if item.get("LastModified") else None,
                }
            )
        if not response.get("IsTruncated"):
            break
        continuation_token = response.get("NextContinuationToken")
    return items


def _bundle_root_from_key(key: str) -> str:
    return PurePosixPath(key).parts[0]


def _bundle_title(bundle_root: str) -> str:
    return bundle_root.replace("_", " ")


def _snippet(text: str, query: str | None, max_chars: int = 500) -> str:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return ""
    if not query:
        return compact[:max_chars]

    lowered = compact.lower()
    for token in _tokenize(query):
        index = lowered.find(token)
        if index >= 0:
            start = max(index - 160, 0)
            end = min(index + max_chars - 160, len(compact))
            snippet = compact[start:end].strip()
            return ("..." if start > 0 else "") + snippet + ("..." if end < len(compact) else "")
    return compact[:max_chars]


def _score_document(query: str, key: str, content: str) -> int:
    query_tokens = _tokenize(query)
    if not query_tokens:
        return 0

    key_counts = Counter(_tokenize(key))
    content_counts = Counter(_tokenize(content[:20000]))
    score = 0
    for token in query_tokens:
        if token in key_counts:
            score += 6 + key_counts[token]
        if token in content_counts:
            score += 2 + min(content_counts[token], 5)
    return score


def _filter_markdown_keys(keys: list[dict[str, Any]], include_metadata: bool) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for item in keys:
        key = item["key"]
        if not key.endswith(".md"):
            continue
        if not include_metadata and "/metadata/" in key:
            continue
        filtered.append(item)
    return filtered


def _list_bundles(keys: list[dict[str, Any]]) -> list[dict[str, Any]]:
    bundles: dict[str, dict[str, Any]] = {}
    for item in keys:
        bundle_root = _bundle_root_from_key(item["key"])
        bundle = bundles.setdefault(
            bundle_root,
            {
                "bundle_root": bundle_root,
                "title": _bundle_title(bundle_root),
                "object_count": 0,
                "keys": [],
            },
        )
        bundle["object_count"] += 1
        bundle["keys"].append(item["key"])
    return sorted(bundles.values(), key=lambda bundle: bundle["bundle_root"])


def _get_bundle_documents(
    *,
    client,
    bucket: str,
    bundle_root: str,
    include_metadata: bool,
    include_full_content: bool,
) -> dict[str, Any]:
    keys = _filter_markdown_keys(_list_keys(client=client, bucket=bucket, prefix=bundle_root), include_metadata)
    documents: list[dict[str, Any]] = []
    for item in keys:
        content = _load_text_object(client=client, bucket=bucket, key=item["key"])
        entry = {
            "key": item["key"],
            "bundle_root": bundle_root,
            "title": PurePosixPath(item["key"]).name,
            "snippet": _snippet(content, None),
        }
        if include_full_content:
            entry["content"] = content
        documents.append(entry)
    return {
        "bucket": bucket,
        "bundle_root": bundle_root,
        "title": _bundle_title(bundle_root),
        "document_count": len(documents),
        "documents": documents,
    }


def _search_documents(
    *,
    client,
    bucket: str,
    query: str,
    bundle_root: str | None,
    include_metadata: bool,
    include_full_content: bool,
    max_results: int,
    max_objects_to_scan: int,
) -> dict[str, Any]:
    raw_keys = _list_keys(client=client, bucket=bucket, prefix=bundle_root)
    markdown_keys = _filter_markdown_keys(raw_keys, include_metadata)[:max_objects_to_scan]

    matches: list[dict[str, Any]] = []
    for item in markdown_keys:
        content = _load_text_object(client=client, bucket=bucket, key=item["key"])
        score = _score_document(query, item["key"], content)
        if score <= 0:
            continue
        match = {
            "key": item["key"],
            "bundle_root": _bundle_root_from_key(item["key"]),
            "title": PurePosixPath(item["key"]).name,
            "score": score,
            "snippet": _snippet(content, query),
        }
        if include_full_content:
            match["content"] = content
        matches.append(match)

    matches.sort(key=lambda item: (-item["score"], item["key"]))
    return {
        "bucket": bucket,
        "query": query,
        "bundle_root": bundle_root,
        "scanned_objects": len(markdown_keys),
        "match_count": len(matches),
        "matches": matches[:max_results],
    }


def main(
    query: str | None = None,
    bundle_root: str | None = None,
    object_key: str | None = None,
    list_only: bool = False,
    include_metadata: bool = False,
    include_full_content: bool = False,
    max_results: int = 5,
    max_objects_to_scan: int = 200,
    minio_endpoint: str | None = DEFAULT_MINIO_ENDPOINT,
    minio_access_key: str | None = DEFAULT_MINIO_ACCESS_KEY,
    minio_secret_key: str | None = DEFAULT_MINIO_SECRET_KEY,
    minio_use_ssl: bool = True,
    minio_region: str | None = DEFAULT_MINIO_REGION,
    okf_bucket: str | None = DEFAULT_OKF_BUCKET,
) -> dict[str, Any]:
    minio_endpoint = minio_endpoint or DEFAULT_MINIO_ENDPOINT
    minio_access_key = minio_access_key or DEFAULT_MINIO_ACCESS_KEY
    minio_secret_key = minio_secret_key or DEFAULT_MINIO_SECRET_KEY
    minio_region = minio_region or DEFAULT_MINIO_REGION
    okf_bucket = okf_bucket or DEFAULT_OKF_BUCKET

    client = _new_s3_client(
        endpoint=minio_endpoint,
        access_key=minio_access_key,
        secret_key=minio_secret_key,
        region=minio_region,
        use_ssl=minio_use_ssl,
    )

    if object_key:
        content = _load_text_object(client=client, bucket=okf_bucket, key=object_key)
        result = {
            "bucket": okf_bucket,
            "object_key": object_key,
            "bundle_root": _bundle_root_from_key(object_key),
            "title": PurePosixPath(object_key).name,
            "snippet": _snippet(content, query),
        }
        if include_full_content:
            result["content"] = content
        return result

    if list_only:
        keys = _list_keys(client=client, bucket=okf_bucket, prefix=bundle_root)
        return {
            "bucket": okf_bucket,
            "bundle_root": bundle_root,
            "bundle_count": len({_bundle_root_from_key(item['key']) for item in keys}) if keys else 0,
            "bundles": _list_bundles(keys),
        }

    if bundle_root and not query:
        return _get_bundle_documents(
            client=client,
            bucket=okf_bucket,
            bundle_root=bundle_root,
            include_metadata=include_metadata,
            include_full_content=include_full_content,
        )

    if query:
        return _search_documents(
            client=client,
            bucket=okf_bucket,
            query=query,
            bundle_root=bundle_root,
            include_metadata=include_metadata,
            include_full_content=include_full_content,
            max_results=max_results,
            max_objects_to_scan=max_objects_to_scan,
        )

    keys = _list_keys(client=client, bucket=okf_bucket, prefix=bundle_root)
    return {
        "bucket": okf_bucket,
        "bundle_root": bundle_root,
        "bundle_count": len({_bundle_root_from_key(item['key']) for item in keys}) if keys else 0,
        "bundles": _list_bundles(keys),
        "usage": {
            "list_only": "Set list_only=true to list bundles and keys.",
            "bundle_root": "Set bundle_root to fetch one bundle's markdown files.",
            "query": "Set query to search OKF markdown for relevant bundle documents.",
            "object_key": "Set object_key to fetch one exact markdown object.",
        },
    }
