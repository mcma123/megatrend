"""Offline handover checks with fake private storage. No network or customer artifacts."""
import copy
from datetime import datetime, timedelta, timezone
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
import zipfile

sys.dont_write_bytecode = True
for name in ("boto3", "wmill", "botocore", "botocore.config"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["botocore.config"].Config = lambda **kwargs: kwargs
ROOT = Path(__file__).resolve().parents[1]
for name in ("f", "f.signing"):
    module = types.ModuleType(name)
    module.__path__ = []
    sys.modules[name] = module


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load("f.signing.prepare_bundle", ROOT / "f/signing/prepare_bundle.py")
worker = load("f.signing.export_company", ROOT / "f/signing/export_company.py")


class Missing(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


class Exists(Exception):
    response = {"Error": {"Code": "PreconditionFailed"}}


class Storage:
    def __init__(self):
        self.items, self.puts = {}, 0

    def put_object(self, Bucket, Key, Body, IfNoneMatch, **_):
        assert IfNoneMatch == "*"
        if (Bucket, Key) in self.items:
            raise Exists()
        self.puts += 1
        self.items[Bucket, Key] = {"Body": Body, "VersionId": f"v{self.puts}", "ServerSideEncryption": "AES256"}

    def get_object(self, Bucket, Key, VersionId=None):
        if (Bucket, Key) not in self.items:
            raise Missing()
        item = self.items[Bucket, Key]
        if VersionId and item["VersionId"] != VersionId:
            raise Missing()
        return {**item, "Body": io.BytesIO(item["Body"]), "ContentLength": len(item["Body"])}

    def get_object_retention(self, **_):
        return {"Retention": {"Mode": "COMPLIANCE", "RetainUntilDate": datetime.now(timezone.utc) + timedelta(days=30)}}


SETTINGS = {"quarantine_bucket": "quarantine", "frozen_bucket": "retained", "retention_days": 30}


def fixture():
    storage = Storage()
    body = b"%PDF-synthetic-source"
    storage.items["quarantine", "quarantine/company/agreement/upload.pdf"] = {"Body": body, "VersionId": "source-v1", "ServerSideEncryption": "AES256"}
    payload = {"records": {"company": {"_id": "company"}, "agreements": [{"agreement": {"_id": "agreement", "tenantId": "company"}}], **{name: [] for name in ("parties", "units", "properties", "leases", "applications", "payments")}}, "artifacts": [{"agreementId": "agreement", "kind": "source", "id": "upload", "version": "source-v1", "sha256": worker.digest(body)}], "unavailable": [{"fileId": "unvalidated", "reason": "No validated retained source"}]}
    return storage, payload


def build(storage, payload):
    return worker.build(storage, SETTINGS, "company", "export", worker.digest(worker.encoded(payload)), payload)


class ExportTests(unittest.TestCase):
    def test_complete_metadata_artifacts_and_hash_manifest(self):
        storage, payload = fixture()
        result = build(storage, payload)
        self.assertEqual(result["status"], "ready")
        volumes = [item for (bucket, key), item in storage.items.items() if key.endswith(".zip")]
        self.assertEqual(len(volumes), 2)
        with zipfile.ZipFile(io.BytesIO(volumes[0]["Body"])) as z:
            self.assertIn("leases.csv", z.namelist())
            self.assertIn("records.json", z.namelist())
            self.assertEqual(z.read("artifacts/agreement/0-source.pdf"), b"%PDF-synthetic-source")
        with zipfile.ZipFile(io.BytesIO(volumes[-1]["Body"])) as z:
            manifest = json.loads(z.read("manifest.json"))
        self.assertEqual(manifest["unavailable"], payload["unavailable"])
        self.assertEqual(manifest["artifacts"][0]["sha256"], payload["artifacts"][0]["sha256"])
        self.assertEqual(manifest["metadata"][0]["path"], "records.json")

    def test_deterministic_write_once_replay_and_interrupted_resume(self):
        storage, payload = fixture()
        first = build(storage, payload)
        puts = storage.puts
        self.assertEqual(first, build(storage, payload))
        self.assertEqual(puts, storage.puts)
        receipt = next(key for key in storage.items if key[1].endswith("receipt.json"))
        del storage.items[receipt]
        self.assertEqual(first, build(storage, payload))
        another, _ = fixture()
        second = build(another, payload)
        self.assertEqual([v["sha256"] for v in first["volumes"]], [v["sha256"] for v in second["volumes"]])

    def test_changed_source_hash_or_version_blocks_publication(self):
        for change in ("bytes", "version"):
            storage, payload = fixture()
            item = storage.items["quarantine", "quarantine/company/agreement/upload.pdf"]
            item["Body" if change == "bytes" else "VersionId"] = b"tampered" if change == "bytes" else "different"
            with self.assertRaises(Exception):
                build(storage, payload)
            self.assertFalse(any(key.endswith("receipt.json") for _, key in storage.items))

    def test_snapshot_and_cross_company_artifacts_rejected(self):
        storage, payload = fixture()
        with self.assertRaises(worker.Blocked):
            worker.build(storage, SETTINGS, "company", "export", "0"*64, payload)
        for change in ("company", "agreement"):
            other = copy.deepcopy(payload)
            if change == "company":
                other["records"]["company"]["_id"] = "another-company"
            else:
                other["artifacts"][0]["agreementId"] = "another-agreement"
            with self.assertRaises(worker.Blocked):
                build(storage, other)

    def test_tampered_saved_volume_is_detected_on_replay(self):
        storage, payload = fixture()
        build(storage, payload)
        key = next(key for key in storage.items if key[1].endswith("part-0.zip"))
        storage.items[key]["Body"] += b"tamper"
        with self.assertRaises(worker.Blocked):
            build(storage, payload)

    def test_storage_outage_never_returns_ready(self):
        storage, payload = fixture()
        def unavailable(**_):
            raise RuntimeError("synthetic secret-bearing provider error")
        storage.put_object = unavailable
        with self.assertRaises(worker.Blocked):
            build(storage, payload)

    def test_csv_formula_protection_and_safe_fixed_paths(self):
        data = worker.csv_bytes([{"name": "=HYPERLINK(secret)", "safe": "text"}]).decode("utf-8-sig")
        self.assertIn("'=HYPERLINK", data)
        with self.assertRaises(worker.Blocked):
            worker.location(SETTINGS, "company", {"agreementId": "../other", "id": "upload", "kind": "source"})
        with self.assertRaises(worker.Blocked):
            worker.location(SETTINGS, "company", {"agreementId": "agreement", "id": "upload", "kind": "arbitrary-key"})

    def test_bounded_volumes_preserve_every_artifact(self):
        storage, payload = fixture()
        original = worker.VOLUME_LIMIT
        try:
            worker.VOLUME_LIMIT = 256
            payload["artifacts"] *= 20
            result = build(storage, payload)
            self.assertGreater(len(result["volumes"]), 2)
            manifest_key = next(key for key in storage.items if key[1].endswith(f"part-{len(result['volumes'])-1}.zip"))
            with zipfile.ZipFile(io.BytesIO(storage.items[manifest_key]["Body"])) as z:
                manifest = json.loads(z.read("manifest.json"))
            self.assertEqual(len(manifest["artifacts"]), 20)
        finally:
            worker.VOLUME_LIMIT = original


if __name__ == "__main__":
    unittest.main()
