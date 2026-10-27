# requirements:
# boto3
# wmill
# pypdf==6.21.2
# rfc8785==0.1.4
"""Private company handover. Fixed storage, pinned inputs, deterministic bounded ZIP volumes."""
import csv
import io
import json
import re
import time
import zipfile
from urllib.parse import urlparse

import boto3
import rfc8785
import wmill
from botocore.config import Config
from f.signing.prepare_bundle import Blocked, digest, identity, private_bucket, put_frozen, read_object, require, version

MIB = 1024 * 1024
VOLUME_LIMIT = 50 * MIB
ERRORS = {"not_configured", "storage_failed", "source_changed", "limit_exceeded", "result_invalid", "export_failed"}


def encoded(value):
    return rfc8785.dumps(value)


def location(settings, tenant, artifact):
    agreement, item = identity(artifact["agreementId"]), identity(artifact["id"])
    kind = artifact["kind"]
    if kind == "source":
        return settings["quarantine_bucket"], f"quarantine/{tenant}/{agreement}/{item}.pdf", False
    if kind in ("bundle", "manifest"):
        return settings["frozen_bucket"], f"prepared/{tenant}/{agreement}/{item}/{'bundle.pdf' if kind == 'bundle' else 'manifest.json'}", True
    if kind in ("pdf", "evidence", "record"):
        filename = {"pdf": "signed.pdf", "evidence": "evidence.json", "record": "record.json"}[kind]
        return settings["frozen_bucket"], f"completed/{tenant}/{agreement}/{item}/{filename}", True
    require(kind == "attachment", "result_invalid")
    return settings["frozen_bucket"], f"attachments/{tenant}/{agreement}/{item}", True


def zip_bytes(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_STORED) as archive:
        for name, body in entries:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            archive.writestr(info, body)
    return output.getvalue()


def csv_bytes(items):
    stream = io.StringIO(newline="")
    fields = sorted({key for item in items for key in item})
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for item in items:
        row = {}
        for key, value in item.items():
            text = json.dumps(value, ensure_ascii=False, sort_keys=True) if isinstance(value, (dict, list)) else str(value) if value is not None else ""
            # Prevent spreadsheet formula execution on exported user-entered values.
            row[key] = "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text
        writer.writerow(row)
    return stream.getvalue().encode("utf-8-sig")


def build(client, settings, tenant, export_id, snapshot_hash, payload):
    require(len(encoded(payload)) <= 700_000 and digest(encoded(payload)) == snapshot_hash, "source_changed")
    records, artifacts = payload["records"], payload["artifacts"]
    require(records["company"]["_id"] == tenant and len(artifacts) <= 400, "result_invalid")
    agreement_ids = {a["agreement"]["_id"] for a in records["agreements"]}
    require(all(a["agreement"]["tenantId"] == tenant for a in records["agreements"]), "result_invalid")
    prefix = f"exports/{tenant}/{export_id}/{snapshot_hash}"
    # Completed receipt is written last; retries check all exact stored volume bytes.
    try:
        receipt, _, _ = read_object(client, settings["frozen_bucket"], prefix + "/receipt.json", MIB, protected=True)
    except Exception as error:
        require(getattr(error, "response", {}).get("Error", {}).get("Code") in ("NoSuchKey", "NoSuchVersion", "404"), "storage_failed")
    else:
        saved = json.loads(receipt)
        require(saved["snapshotHash"] == snapshot_hash, "source_changed")
        verify_volumes(client, settings, prefix, saved["volumes"])
        return saved
    entries = [("records.json", encoded(records)), ("unavailable.json", encoded(payload["unavailable"]))]
    for name in ("parties", "units", "properties", "leases", "applications", "payments"):
        entries.append((name + ".csv", csv_bytes(records[name])))
    volumes, manifest = [], []
    metadata = [{"path": name, "sha256": digest(body), "sizeBytes": len(body), "part": 0} for name, body in entries]
    total = sum(len(body) for _, body in entries)
    started = time.monotonic()

    def flush():
        nonlocal entries, total
        if not entries:
            return
        part = len(volumes)
        require(part < 100, "limit_exceeded")
        data = zip_bytes(entries)
        require(len(data) <= 55 * MIB, "limit_exceeded")
        saved_version, _ = put_frozen(client, settings["frozen_bucket"], prefix + f"/part-{part}.zip", data, "application/zip", settings["retention_days"])
        volumes.append({"part": part, "version": saved_version, "sha256": digest(data), "sizeBytes": len(data)})
        entries, total = [], 0

    for index, artifact in enumerate(artifacts):
        require(time.monotonic() - started < 240 and artifact["agreementId"] in agreement_ids, "limit_exceeded")
        require(re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]) is not None, "result_invalid")
        bucket, key, protected = location(settings, tenant, artifact)
        body, _, _ = read_object(client, bucket, key, VOLUME_LIMIT, version(artifact["version"]), protected=protected)
        require(digest(body) == artifact["sha256"], "source_changed")
        extension = "json" if artifact["kind"] in ("manifest", "evidence", "record") else {"image/png": "png", "image/jpeg": "jpg"}.get(artifact.get("contentType"), "pdf")
        filename = f"artifacts/{artifact['agreementId']}/{index}-{artifact['kind']}.{extension}"
        if total + len(body) > VOLUME_LIMIT:
            flush()
        entries.append((filename, body))
        total += len(body)
        manifest.append({**artifact, "path": filename, "part": len(volumes), "sizeBytes": len(body)})
    flush()
    # Separate small index volume avoids a size-dependent manifest/volume cycle.
    entries = [("manifest.json", encoded({"contractVersion": 1, "tenantId": tenant, "exportId": export_id, "snapshotHash": snapshot_hash, "metadataPart": 0, "metadata": metadata, "artifacts": manifest, "volumes": volumes, "unavailable": payload["unavailable"]}))]
    flush()
    result = {"status": "ready", "snapshotHash": snapshot_hash, "volumes": volumes}
    put_frozen(client, settings["frozen_bucket"], prefix + "/receipt.json", encoded(result), "application/json", settings["retention_days"])
    return result


def verify_volumes(client, settings, prefix, volumes):
    require(isinstance(volumes, list) and 0 < len(volumes) <= 100, "result_invalid")
    for index, item in enumerate(volumes):
        require(item["part"] == index, "result_invalid")
        body, _, _ = read_object(client, settings["frozen_bucket"], prefix + f"/part-{index}.zip", 55*MIB, version(item["version"]), protected=True)
        require(digest(body) == item["sha256"] and len(body) == item["sizeBytes"], "source_changed")


def main(operation: str, tenant_id: str, export_id: str, snapshot_hash: str, payload: dict):
    try:
        tenant, export = identity(tenant_id), identity(export_id)
        require(operation in ("build", "download") and re.fullmatch(r"[a-f0-9]{64}", snapshot_hash) is not None, "result_invalid")
        settings = wmill.get_resource("f/signing/document_storage")
        endpoint = urlparse(settings.get("endpoint", ""))
        require(endpoint.scheme == "https" and endpoint.hostname and not endpoint.username and not endpoint.password and not endpoint.query and not endpoint.fragment, "not_configured")
        require(type(settings.get("retention_days")) is int and 1 <= settings["retention_days"] <= 36500 and settings["quarantine_bucket"] != settings["frozen_bucket"], "not_configured")
        client = boto3.client("s3", endpoint_url=settings["endpoint"], region_name=settings.get("region", "us-east-1"), aws_access_key_id=settings["access_key"], aws_secret_access_key=settings["secret_key"], config=Config(signature_version="s3v4", connect_timeout=5, read_timeout=20, retries={"max_attempts": 1}, s3={"addressing_style": "path"}))
        private_bucket(client, settings["quarantine_bucket"])
        private_bucket(client, settings["frozen_bucket"], frozen=True)
        if operation == "build":
            return build(client, settings, tenant, export, snapshot_hash, payload)
        prefix = f"exports/{tenant}/{export}/{snapshot_hash}"
        receipt, _, _ = read_object(client, settings["frozen_bucket"], prefix + "/receipt.json", MIB, protected=True)
        saved = json.loads(receipt)
        require(saved["snapshotHash"] == snapshot_hash and saved["volumes"] == payload["volumes"], "source_changed")
        verify_volumes(client, settings, prefix, saved["volumes"])
        links = []
        for item in saved["volumes"]:
            url = client.generate_presigned_url("get_object", Params={"Bucket": settings["frozen_bucket"], "Key": prefix + f"/part-{item['part']}.zip", "VersionId": item["version"], "ResponseContentType": "application/zip", "ResponseContentDisposition": "attachment"}, ExpiresIn=60)
            require(urlparse(url).scheme == "https", "storage_failed")
            links.append({"part": item["part"], "url": url, "sha256": item["sha256"], "sizeBytes": item["sizeBytes"]})
        return {"status": "download", "volumes": links, "expiresAt": int(time.time()*1000)+60_000}
    except Blocked as error:
        return {"status": "blocked", "error": str(error) if str(error) in ERRORS else "export_failed"}
    except Exception:
        return {"status": "blocked", "error": "export_failed"}
