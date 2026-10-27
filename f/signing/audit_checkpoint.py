"""Immutable, non-PII signing audit anchors. Credentials never enter job arguments."""
import json
import re
import boto3
import wmill
from botocore.config import Config
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse


def _validate(payload, tenant_id, agreement_id):
    if not all(re.fullmatch(r"[A-Za-z0-9_-]{1,100}", x) for x in (tenant_id, agreement_id)):
        raise ValueError("Invalid checkpoint identity")
    if (set(payload) != {"contractVersion", "tenantId", "agreementId", "sequence", "headHash", "revision", "contentHash"}
        or payload["contractVersion"] != 1 or payload["tenantId"] != tenant_id or payload["agreementId"] != agreement_id
        or type(payload["sequence"]) is not int or not 1 <= payload["sequence"] < 10**12
        or type(payload["revision"]) is not int or payload["revision"] < 1
        or not all(isinstance(payload[k], str) and re.fullmatch(r"[a-f0-9]{64}", payload[k]) for k in ("headHash", "contentHash"))):
        raise ValueError("Invalid checkpoint payload")
    return f"checkpoints/{tenant_id}/{agreement_id}/"


def _inspect(client, bucket):
    for grant in client.get_bucket_acl(Bucket=bucket).get("Grants", []):
        if grant.get("Grantee", {}).get("URI") in ("http://acs.amazonaws.com/groups/global/AllUsers", "http://acs.amazonaws.com/groups/global/AuthenticatedUsers"):
            raise ValueError("Checkpoint bucket ACL must not allow public access")
    if client.get_bucket_versioning(Bucket=bucket).get("Status") != "Enabled":
        raise ValueError("Checkpoint bucket requires versioning")
    if client.get_object_lock_configuration(Bucket=bucket).get("ObjectLockConfiguration", {}).get("ObjectLockEnabled") != "Enabled":
        raise ValueError("Checkpoint bucket requires Object Lock")
    encryption = client.get_bucket_encryption(Bucket=bucket).get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
    if not any(r.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm") in ("AES256", "aws:kms") for r in encryption):
        raise ValueError("Checkpoint bucket requires encryption at rest")
    try:
        policy = json.loads(client.get_bucket_policy(Bucket=bucket)["Policy"])
    except Exception as error:
        if getattr(error, "response", {}).get("Error", {}).get("Code") not in ("NoSuchBucketPolicy", "NoSuchBucketPolicyException"):
            raise ValueError("Could not verify checkpoint bucket privacy") from None
        policy = {}
    for statement in policy.get("Statement", []):
        principal = statement.get("Principal")
        if statement.get("Effect") == "Allow" and (principal == "*" or isinstance(principal, dict) and (principal.get("AWS") == "*" or "*" in principal.get("AWS", []))):
            raise ValueError("Checkpoint bucket must not allow public access")


def _read(client, bucket, key, version=None):
    args = {"Bucket": bucket, "Key": key}
    if version:
        args["VersionId"] = version
    obj = client.get_object(**args)
    if obj.get("ServerSideEncryption") not in ("AES256", "aws:kms"):
        raise ValueError("Checkpoint object must be encrypted at rest")
    if not obj.get("VersionId") or obj["VersionId"] == "null":
        raise ValueError("Checkpoint must have a version identity")
    retention = client.get_object_retention(**{**args, "VersionId": obj["VersionId"]}).get("Retention", {})
    until = retention.get("RetainUntilDate")
    if retention.get("Mode") != "COMPLIANCE" or not isinstance(until, datetime) or until <= datetime.now(timezone.utc):
        raise ValueError("Checkpoint retention is not protected")
    try:
        body = obj["Body"].read(16385)
    finally:
        obj["Body"].close()
    if len(body) > 16384:
        raise ValueError("Checkpoint exceeds limit")
    data = json.loads(body)
    prefix = _validate(data, data.get("tenantId", ""), data.get("agreementId", ""))
    expected = f"{prefix}{data['sequence']:012d}-{data['headHash']}.json"
    if key != expected:
        raise ValueError("Checkpoint key and contents do not match")
    return {"payload": data, "objectVersion": obj["VersionId"], "retainUntil": int(until.timestamp() * 1000)}


def checkpoint(client, bucket, operation, tenant_id, agreement_id, payload, retention_days):
    # Validate identities even for reads; callers never select a bucket, prefix or URL.
    prefix = _validate(payload, tenant_id, agreement_id)
    _inspect(client, bucket)
    if operation == "put":
        if type(retention_days) is not int or not 1 <= retention_days <= 36500:
            raise ValueError("Configure an approved checkpoint retention period")
        key = f"{prefix}{payload['sequence']:012d}-{payload['headHash']}.json"
        body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        try:
            client.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json",
                IfNoneMatch="*", ObjectLockMode="COMPLIANCE", ObjectLockRetainUntilDate=datetime.now(timezone.utc) + timedelta(days=retention_days),
                ChecksumAlgorithm="SHA256")
        except Exception as error:
            if getattr(error, "response", {}).get("Error", {}).get("Code") not in ("PreconditionFailed", "412"):
                raise ValueError("Checkpoint write failed; reconcile before retrying") from None
        result = _read(client, bucket, key)
        if result["payload"] != payload:
            raise ValueError("Stored checkpoint does not match the issued checkpoint")
        return result
    if operation != "latest":
        raise ValueError("Unsupported checkpoint operation")
    latest = None
    sequences = {}
    continuation = None
    # Read independent storage, not a potentially rolled-back database receipt.
    for _ in range(10):
        response = client.list_objects_v2(Bucket=bucket, Prefix=prefix, **({"ContinuationToken": continuation} if continuation else {}))
        for item in response.get("Contents", []):
            key = item["Key"]
            if not re.fullmatch(re.escape(prefix) + r"\d{12}-[a-f0-9]{64}\.json", key):
                raise ValueError("Unexpected checkpoint object")
            sequence = key[len(prefix):len(prefix) + 12]
            if sequence in sequences and sequences[sequence] != key:
                raise ValueError("Conflicting retained audit anchors require investigation")
            sequences[sequence] = key
            latest = max(latest or key, key)
        if not response.get("IsTruncated"):
            return _read(client, bucket, latest) if latest else None
        continuation = response.get("NextContinuationToken")
        if not continuation:
            break
    raise ValueError("Checkpoint enumeration limit exceeded; operator review required")


def main(operation: str, tenant_id: str, agreement_id: str, payload: dict):
    resource = wmill.get_resource("f/signing/checkpoint_storage")
    endpoint = resource.get("endpoint", "")
    url = urlparse(endpoint)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise ValueError("Configure a trusted HTTPS checkpoint endpoint")
    if not resource.get("independent_admin_reference"):
        raise ValueError("Record the independently controlled storage administrator")
    client = boto3.client("s3", endpoint_url=endpoint, aws_access_key_id=resource["access_key"], aws_secret_access_key=resource["secret_key"],
        region_name=resource.get("region", "us-east-1"), config=Config(connect_timeout=5, read_timeout=10, retries={"max_attempts": 2}, s3={"addressing_style": "path"}))
    try:
        return checkpoint(client, resource["bucket"], operation, tenant_id, agreement_id, payload, resource.get("retention_days"))
    except ValueError:
        raise
    except Exception:
        raise ValueError("Checkpoint verification failed; check service configuration") from None
