"""Offline tests: no network, credentials, uploads or real signed documents."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
import sys
import types
from datetime import datetime, timedelta, timezone

target = Path(__file__).resolve().parents[1] / "f/signing/audit_checkpoint.py"
sys.dont_write_bytecode = True
# Replace external SDK modules only in this isolated offline test process.
sys.modules["boto3"] = types.ModuleType("boto3")
sys.modules["wmill"] = types.ModuleType("wmill")
sys.modules["botocore"] = types.ModuleType("botocore")
sys.modules["botocore.config"] = types.ModuleType("botocore.config")
sys.modules["botocore.config"].Config = lambda **kwargs: kwargs
spec = importlib.util.spec_from_file_location("signing_checkpoint", target)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class StorageError(Exception):
    def __init__(self, code):
        self.response = {"Error": {"Code": code}}


class FakeS3:
    def __init__(self):
        self.objects = {}
        self.versioning = "Enabled"
        self.lock = "Enabled"
        self.encryption = "AES256"
        self.policy = {"Statement": []}
        self.truncated = False
        self.public_acl = False

    def get_bucket_acl(self, **_):
        return {"Grants": [{"Grantee": {"URI": "http://acs.amazonaws.com/groups/global/AllUsers"}}] if self.public_acl else []}

    def get_bucket_versioning(self, **_):
        return {"Status": self.versioning}

    def get_object_lock_configuration(self, **_):
        return {"ObjectLockConfiguration": {"ObjectLockEnabled": self.lock}}

    def get_bucket_encryption(self, **_):
        return {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": self.encryption}}]}}

    def get_bucket_policy(self, **_):
        return {"Policy": json.dumps(self.policy)}

    def put_object(self, **args):
        if args["Key"] in self.objects:
            raise StorageError("PreconditionFailed")
        assert args["IfNoneMatch"] == "*"
        assert args["ChecksumAlgorithm"] == "SHA256"
        self.objects[args["Key"]] = args

    def get_object(self, **args):
        return {"VersionId": "synthetic-version", "ServerSideEncryption": "AES256", "Body": io.BytesIO(self.objects[args["Key"]]["Body"])}

    def get_object_retention(self, **args):
        record = self.objects[args["Key"]]
        return {"Retention": {"Mode": record["ObjectLockMode"], "RetainUntilDate": record["ObjectLockRetainUntilDate"]}}

    def list_objects_v2(self, **args):
        return {"Contents": [{"Key": k} for k in sorted(self.objects) if k.startswith(args["Prefix"])], "IsTruncated": self.truncated, "NextContinuationToken": "next"}


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.storage = FakeS3()
        self.payload = {"contractVersion": 1, "tenantId": "company-test", "agreementId": "agreement-test", "sequence": 1, "headHash": "a" * 64, "revision": 1, "contentHash": "b" * 64}

    def call(self, operation="put", payload=None):
        return module.checkpoint(self.storage, "synthetic-bucket", operation, "company-test", "agreement-test", payload or self.payload, 365)

    def test_round_trip_is_retained_versioned_and_idempotent(self):
        first = self.call()
        self.assertEqual(first, self.call())
        self.assertEqual(first, self.call("latest"))
        self.assertEqual(len(self.storage.objects), 1)
        self.assertEqual(first["payload"], self.payload)

    def test_latest_comes_from_storage_and_ignores_local_receipts(self):
        self.call()
        newer = {**self.payload, "sequence": 2, "headHash": "c" * 64}
        self.call(payload=newer)
        self.assertEqual(self.call("latest")["payload"], newer)

    def test_storage_must_be_versioned_locked_encrypted_and_private(self):
        for setting in ("versioning", "lock", "encryption"):
            with self.subTest(setting=setting):
                self.storage = FakeS3()
                setattr(self.storage, setting, "disabled")
                with self.assertRaises(ValueError): self.call()
        self.storage = FakeS3()
        self.storage.policy = {"Statement": [{"Effect": "Allow", "Principal": "*"}]}
        with self.assertRaisesRegex(ValueError, "public"): self.call()

    def test_changed_objects_and_expired_retention_fail_verification(self):
        self.call()
        obj = next(iter(self.storage.objects.values()))
        original = copy.deepcopy(obj)
        obj["Body"] = json.dumps({**self.payload, "headHash": "d" * 64}).encode()
        with self.assertRaisesRegex(ValueError, "do not match"): self.call("latest")
        obj.update(original)
        obj["ObjectLockRetainUntilDate"] = datetime.now(timezone.utc) - timedelta(seconds=1)
        with self.assertRaisesRegex(ValueError, "retention"): self.call("latest")

    def test_cross_company_and_invalid_payloads_are_rejected(self):
        for patch in ({"tenantId": "another-company"}, {"sequence": True}, {"headHash": "bad"}, {"revision": 0}):
            with self.subTest(patch=patch):
                with self.assertRaises(ValueError): self.call(payload={**self.payload, **patch})

    def test_enumeration_never_returns_a_partial_success(self):
        self.call()
        self.storage.truncated = True
        with self.assertRaisesRegex(ValueError, "enumeration limit"): self.call("latest")

    def test_writes_cannot_succeed_without_compliance_retention(self):
        self.call()
        next(iter(self.storage.objects.values()))["ObjectLockMode"] = "GOVERNANCE"
        with self.assertRaisesRegex(ValueError, "retention"): self.call()

    def test_public_bucket_acl_is_rejected(self):
        self.storage.public_acl = True
        with self.assertRaisesRegex(ValueError, "public"): self.call()

    def test_conflicting_branches_cannot_be_reported_as_a_valid_latest_anchor(self):
        self.call()
        self.call(payload={**self.payload, "headHash": "f" * 64})
        with self.assertRaisesRegex(ValueError, "Conflicting"): self.call("latest")


if __name__ == "__main__":
    unittest.main()
