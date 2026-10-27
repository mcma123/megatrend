"""Offline signing ingestion checks. Synthetic contracts, no network or credentials."""
import copy
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

sys.dont_write_bytecode = True
for name in ("boto3", "wmill", "botocore", "botocore.config"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["botocore.config"].Config = lambda **kwargs: kwargs
spec = importlib.util.spec_from_file_location("signing_pdf", Path(__file__).resolve().parents[1] / "f/signing/prepare_bundle.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, DictionaryObject, NameObject, NumberObject, TextStringObject
from reportlab.pdfgen.canvas import Canvas


def pdf(text="Synthetic agreement", size=(612, 792)):
    stream = io.BytesIO()
    canvas = Canvas(stream, pagesize=size, invariant=True)
    canvas.drawString(60, size[1]-60, text)
    canvas.rect(60, 100, 200, 100)
    canvas.save()
    return stream.getvalue()


def edited(edit):
    writer = PdfWriter()
    writer.add_page(PdfReader(io.BytesIO(pdf())).pages[0])
    edit(writer)
    stream = io.BytesIO()
    writer.write(stream)
    return stream.getvalue()


class Missing(Exception):
    response = {"Error": {"Code": "NoSuchKey"}}


class Exists(Exception):
    response = {"Error": {"Code": "PreconditionFailed"}}


class Storage:
    def __init__(self):
        self.items = {}
        self.public = False
        self.versioning = "Enabled"
        self.lock = "Enabled"
        self.encryption = "AES256"
        self.policy = {"Statement": []}

    def get_bucket_acl(self, **_):
        return {"Grants": [{"Grantee": {"URI": "http://acs.amazonaws.com/groups/global/AllUsers"}}] if self.public else []}

    def get_bucket_versioning(self, **_):
        return {"Status": self.versioning}

    def get_bucket_encryption(self, **_):
        return {"ServerSideEncryptionConfiguration": {"Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": self.encryption}}]}}

    def get_object_lock_configuration(self, **_):
        return {"ObjectLockConfiguration": {"ObjectLockEnabled": self.lock}}

    def get_bucket_policy(self, **_):
        return {"Policy": json.dumps(self.policy)}

    def get_object(self, Bucket, Key, VersionId=None):
        if (Bucket, Key) not in self.items:
            raise Missing()
        obj = self.items[Bucket, Key]
        if VersionId and VersionId != obj["VersionId"]:
            raise Missing()
        return {**obj, "ContentLength": len(obj["Body"]), "Body": io.BytesIO(obj["Body"])}

    def get_object_retention(self, Bucket, Key, VersionId):
        obj = self.items[Bucket, Key]
        assert obj["VersionId"] == VersionId
        return {"Retention": {"Mode": obj.get("ObjectLockMode"), "RetainUntilDate": obj.get("ObjectLockRetainUntilDate")}}

    def put_object(self, Bucket, Key, **args):
        assert args["IfNoneMatch"] == "*"
        if (Bucket, Key) in self.items:
            raise Exists()
        self.items[Bucket, Key] = {**args, "VersionId": "frozen-v1", "ServerSideEncryption": "AES256"}


class PdfTests(unittest.TestCase):
    def setUp(self):
        self.files = [{"fileId": "file-primary", "uploadId": "upload-primary", "sourceVersion": "source-v1", "sizeBytes": 1, "role": "primary"}]

    def sanitize(self, data, extra=None):
        with tempfile.TemporaryDirectory() as root:
            paths, files = [], copy.deepcopy(self.files)
            for index, content in enumerate([data]+([extra] if extra else [])):
                path = Path(root) / f"source-{index}.pdf"
                path.write_bytes(content)
                paths.append(str(path))
                if index:
                    files.append({**files[0], "fileId": "file-annexure", "role": "annexure"})
            output = str(Path(root) / "out.pdf")
            result = worker.sanitize_local(paths, files, output)
            return result, Path(output).read_bytes()

    def test_flat_pdf_preserves_text_vectors_order_and_page_geometry(self):
        primary = edited(lambda w: w.pages[0].rotate(90))
        result, body = self.sanitize(primary, pdf("Synthetic annexure", (400, 500)))
        reader = PdfReader(io.BytesIO(body))
        self.assertEqual(len(reader.pages), 2)
        self.assertIn("Synthetic agreement", reader.pages[0].extract_text())
        self.assertIn("Synthetic annexure", reader.pages[1].extract_text())
        self.assertIn(b" re", reader.pages[0].get_contents().get_data())
        self.assertEqual(result["counts"], [1, 1])
        self.assertEqual(result["pages"][0]["rotation"], 90)
        self.assertEqual(result["pages"][1]["mediaBox"], [0, 0, 400, 500])

    def test_crop_box_and_non_integer_geometry_are_preserved(self):
        def crop(w):
            w.pages[0].cropbox.lower_left = (10.5, 20.25)
            w.pages[0].cropbox.upper_right = (600.5, 770.75)
        info, body = self.sanitize(edited(crop))
        self.assertEqual(info["pages"][0]["widthPt"], 590)
        self.assertEqual(list(PdfReader(io.BytesIO(body)).pages[0].cropbox), [10.5,20.25,600.5,770.75])

    def test_corrupt_encrypted_and_signed_sources_are_rejected(self):
        cases = [(b"not a PDF", "invalid_pdf"), (b"%PDF-1.7 broken", "invalid_pdf"),
            (edited(lambda w: w.encrypt("synthetic-password")), "encrypted_pdf"),
            (pdf()+b"\n/ByteRange [0 1 2 3]", "signed_pdf")]
        for content, code in cases:
            with self.subTest(code=code), self.assertRaisesRegex(worker.Blocked, code):
                self.sanitize(content)

    def test_active_content_forms_layers_attachments_and_signatures_are_rejected(self):
        cases = [lambda w: w.add_js("app.alert('synthetic')"),
            lambda w: w.add_attachment("synthetic.txt", b"test"),
            lambda w: w._root_object.update({NameObject("/AcroForm"): DictionaryObject()}),
            lambda w: w._root_object.update({NameObject("/OCProperties"): DictionaryObject()}),
            lambda w: w._root_object.update({NameObject("/Perms"): DictionaryObject({NameObject("/DocMDP"): TextStringObject("synthetic")})})]
        for change in cases:
            with self.subTest(change=change), self.assertRaisesRegex(worker.Blocked, "unsupported_pdf|signed_pdf"):
                self.sanitize(edited(change))

    def test_visible_annotations_require_a_flat_export(self):
        def annotate(w):
            w.pages[0][NameObject("/Annots")] = ArrayObject([DictionaryObject({NameObject("/Subtype"): NameObject("/Text"), NameObject("/Contents"): TextStringObject("Synthetic contract term")})])
        with self.assertRaisesRegex(worker.Blocked, "unsupported_pdf"):
            self.sanitize(edited(annotate))

    def test_page_count_and_dimensions_are_limited(self):
        with patch.object(worker, "PAGE_LIMIT", 1), self.assertRaisesRegex(worker.Blocked, "limit_exceeded"):
            self.sanitize(pdf(), pdf())
        with self.assertRaisesRegex(worker.Blocked, "limit_exceeded"):
            self.sanitize(pdf(size=(15000, 100)))
        with self.assertRaisesRegex(worker.Blocked, "unsupported_pdf"):
            self.sanitize(edited(lambda w: w.pages[0].update({NameObject("/UserUnit"): NumberObject(20)})))

    def prepared(self, scan=None, render=None):
        storage, files = Storage(), copy.deepcopy(self.files)
        content = pdf()
        files[0]["sizeBytes"] = len(content)
        storage.items["quarantine", "quarantine/company/agreement/upload-primary.pdf"] = {"Body": content, "VersionId": "source-v1", "ServerSideEncryption": "AES256"}
        settings = {"quarantine_bucket": "quarantine", "frozen_bucket": "frozen", "retention_days": 365}
        def renderer(root):
            return worker.sanitize_local([str(root / "source-0.pdf")], files, str(root / "bundle.pdf"))
        def scanner(data, _):
            return {"engine": "ClamAV", "version": "ClamAV synthetic", "scannedAt": int(datetime.now(timezone.utc).timestamp()*1000)}
        result = worker.prepare(storage, settings, {}, "company", "agreement", "attempt", "a"*64, files, render=render or renderer, scan=scan or scanner)
        return storage, settings, files, result, renderer, scanner

    def test_manifest_is_canonical_hashed_retained_and_idempotent(self):
        storage, settings, files, result, renderer, scanner = self.prepared()
        encoded = storage.items["frozen", result["manifestKey"]]["Body"]
        self.assertEqual(worker.digest(encoded), result["manifestHash"])
        self.assertEqual(encoded, worker.rfc8785.dumps(result["manifest"]))
        self.assertEqual(worker.digest(storage.items["frozen", result["artifactKey"]]["Body"]), result["manifest"]["pdfHash"])
        def must_not_run(*_):
            self.fail("Completed attempts must reuse retained artifacts")
        duplicate = worker.prepare(storage, settings, {}, "company", "agreement", "attempt", "a"*64, files, render=must_not_run, scan=must_not_run)
        self.assertEqual(duplicate, result)

    def test_malware_is_blocked_before_parser_and_never_published(self):
        calls = []
        def blocked(*_):
            calls.append("scan")
            raise worker.Blocked("malware_detected")
        def forbidden(*_):
            self.fail("A blocked source reached the parser")
        with self.assertRaisesRegex(worker.Blocked, "malware_detected"):
            self.prepared(scan=blocked, render=forbidden)
        self.assertEqual(calls, ["scan"])

    def test_output_is_scanned_as_well_as_input(self):
        calls = []
        def scanner(*_):
            calls.append("scan")
            if len(calls) == 2:
                raise worker.Blocked("malware_detected")
            return {"engine": "ClamAV", "version": "synthetic", "scannedAt": 1}
        with self.assertRaisesRegex(worker.Blocked, "malware_detected"):
            self.prepared(scan=scanner)
        self.assertEqual(len(calls), 2)

    def test_source_replacement_and_frozen_tampering_are_detected(self):
        storage, settings, files, result, render, scan = self.prepared()
        changed = copy.deepcopy(files); changed[0]["sourceVersion"] = "new-version"
        with self.assertRaisesRegex(worker.Blocked, "source_changed"):
            worker.prepare(storage, settings, {}, "company", "agreement", "attempt", "a"*64, changed, render=render, scan=scan)
        storage.items["frozen", result["artifactKey"]]["Body"] += b"tampered"
        with self.assertRaisesRegex(worker.Blocked, "storage_failed"):
            worker.prepare(storage, settings, {}, "company", "agreement", "attempt", "a"*64, files, render=render, scan=scan)

    def test_partial_pdf_write_can_resume_without_overwriting_retained_bytes(self):
        storage, settings, files, result, render, scan = self.prepared()
        original = storage.items["frozen", result["artifactKey"]]["Body"]
        # Model a failed manifest write: the conditional PDF write already succeeded.
        del storage.items["frozen", result["manifestKey"]]
        resumed = worker.prepare(storage, settings, {}, "company", "agreement", "attempt", "a"*64, files, render=render, scan=scan)
        self.assertEqual(original, storage.items["frozen", result["artifactKey"]]["Body"])
        self.assertEqual(resumed["storageVersion"], result["storageVersion"])

    def test_upload_policy_pins_key_type_exact_size_and_short_expiry(self):
        storage = Storage()
        settings = {"endpoint": "https://storage.example.test", "access_key": "synthetic", "secret_key": "synthetic", "quarantine_bucket": "quarantine", "frozen_bucket": "frozen", "retention_days": 365}
        calls = []
        def post(**args):
            calls.append(args)
            return {"url": "https://storage.example.test/quarantine", "fields": {"key": args["Key"], **args["Fields"]}}
        storage.generate_presigned_post = post
        with patch.object(worker.wmill, "get_resource", return_value=settings, create=True), patch.object(worker.boto3, "client", return_value=storage, create=True):
            result = worker.main("upload", "company", "agreement", {"uploadId": "upload", "sizeBytes": 100})
        self.assertEqual(result["status"], "upload")
        self.assertEqual(calls[0]["Key"], "quarantine/company/agreement/upload.pdf")
        self.assertEqual(calls[0]["ExpiresIn"], 300)
        self.assertEqual(calls[0]["Conditions"], [{"Content-Type": "application/pdf"}, ["content-length-range", 100, 100]])
        self.assertNotIn("synthetic", str(result))

    def test_storage_requires_private_encrypted_versioned_compliance_lock(self):
        for setting, value in [("public", True), ("versioning", "Suspended"), ("encryption", "none"), ("lock", "Disabled"), ("policy", {"Statement": [{"Effect": "Allow", "Principal": "*"}]})]:
            storage = Storage(); setattr(storage, setting, value)
            with self.subTest(setting=setting), self.assertRaisesRegex(worker.Blocked, "storage_failed"):
                worker.private_bucket(storage, "synthetic", frozen=True)

    def test_null_versions_and_unprotected_retention_are_rejected(self):
        storage, _, _, result, _, _ = self.prepared()
        record = storage.items["frozen", result["artifactKey"]]
        record["ObjectLockMode"] = "GOVERNANCE"
        with self.assertRaisesRegex(worker.Blocked, "storage_failed"):
            worker.read_object(storage, "frozen", result["artifactKey"], worker.OUTPUT_LIMIT, protected=True)
        record["VersionId"] = "null"
        with self.assertRaisesRegex(worker.Blocked, "source_changed"):
            worker.read_object(storage, "frozen", result["artifactKey"], worker.OUTPUT_LIMIT)

    def test_missing_resources_do_not_expose_provider_errors(self):
        with patch.object(worker.wmill, "get_resource", side_effect=RuntimeError("synthetic-secret-url"), create=True):
            result = worker.main("upload", "company", "agreement", {})
        self.assertEqual(result, {"status": "blocked", "error": "preparation_failed"})
        self.assertNotIn("synthetic-secret", str(result))

    def test_plaintext_scanner_transport_is_never_used(self):
        with self.assertRaisesRegex(worker.Blocked, "scanner_unavailable"):
            worker.scan_bytes(b"synthetic", {"transport": "tcp", "host": "example.invalid"})

    def test_scanner_protocol_clean_infected_stale_and_error_results(self):
        now = datetime.now(timezone.utc).strftime("%a %b %d %H:%M:%S %Y")
        class Connection:
            def __init__(self, response):
                self.response, self.sent = response, []
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def settimeout(self, *_): pass
            def connect(self, *_): pass
            def sendall(self, data): self.sent.append(data)
            def recv(self, *_):
                result, self.response = self.response, b""
                return result
        def call(reply, timestamp=now):
            sockets = [Connection(f"ClamAV 1.4.3/12345/{timestamp}\0".encode()), Connection(reply)]
            with patch.object(worker.socket, "AF_UNIX", 1, create=True), patch.object(worker.socket, "socket", side_effect=sockets):
                result = worker.scan_bytes(b"synthetic", {"transport": "unix", "socket_path": "/tmp/clamd.sock"})
            self.assertEqual(sockets[0].sent, [b"zVERSION\0"])
            self.assertEqual(sockets[1].sent, [b"zINSTREAM\0", b"\x00\x00\x00\x09synthetic", b"\0\0\0\0"])
            return result
        self.assertEqual(call(b"stream: OK\0")["engine"], "ClamAV")
        for reply, code in [(b"stream: Eicar-Test-Signature FOUND\0", "malware_detected"), (b"INSTREAM size limit exceeded. ERROR\0", "scanner_unavailable"), (b"", "scanner_unavailable")]:
            with self.subTest(reply=reply), self.assertRaisesRegex(worker.Blocked, code):
                call(reply)
        old = (datetime.now(timezone.utc)-timedelta(days=3)).strftime("%a %b %d %H:%M:%S %Y")
        with self.assertRaisesRegex(worker.Blocked, "scanner_unavailable"):
            call(b"stream: OK\0", old)


class AttachmentTests(unittest.TestCase):
    """Supporting documents: quarantine form, type check before scan, retained copy, verified download."""

    def setUp(self):
        self.storage = Storage()
        self.storage.generate_presigned_post = lambda **args: {"url": "https://storage.example/q", "fields": {"key": args["Key"], **args["Fields"]}}
        self.storage.generate_presigned_url = lambda op, Params, ExpiresIn: f"https://storage.example/{Params['Key']}?v={Params['VersionId']}"
        self.settings = {"quarantine_bucket": "q", "frozen_bucket": "frozen", "retention_days": 30}
        self.scanned = []

    def scan(self, data, _):
        self.scanned.append(data)
        return {"engine": "ClamAV", "version": "1.4/27000", "scannedAt": 1}

    def run_op(self, operation, payload):
        return worker.attachment(self.storage, self.settings, {}, operation, "company", "agreement", payload, scan=self.scan)

    def upload(self, body, content_type="image/png"):
        self.storage.items["q", "attachments-quarantine/company/agreement/att1"] = {"Body": body, "VersionId": "q1", "ServerSideEncryption": "AES256"}
        return self.run_op("attachment_scan", {"attachmentId": "att1", "contentType": content_type, "sizeBytes": len(body)})

    def test_upload_form_is_bound_to_type_size_and_key(self):
        form = self.run_op("attachment_upload", {"attachmentId": "att1", "contentType": "application/pdf", "sizeBytes": 10})
        self.assertEqual(form["fields"]["key"], "attachments-quarantine/company/agreement/att1")
        self.assertEqual(form["fields"]["Content-Type"], "application/pdf")
        for payload in [{"attachmentId": "att1", "contentType": "text/html", "sizeBytes": 10},
                        {"attachmentId": "../x", "contentType": "image/png", "sizeBytes": 10}]:
            with self.subTest(payload=payload), self.assertRaises(worker.Blocked):
                self.run_op("attachment_upload", payload)
        with self.assertRaisesRegex(worker.Blocked, "limit_exceeded"):
            self.run_op("attachment_upload", {"attachmentId": "att1", "contentType": "image/png", "sizeBytes": worker.ATTACHMENT_LIMIT + 1})

    def test_clean_upload_is_scanned_then_retained_and_downloadable(self):
        body = b"\x89PNG\r\n\x1a\n" + b"synthetic"
        result = self.upload(body)
        self.assertEqual(result["status"], "clean")
        self.assertEqual(self.scanned, [body])
        self.assertEqual(result["sha256"], worker.digest(body))
        retained = self.storage.items["frozen", "attachments/company/agreement/att1"]
        self.assertEqual((retained["Body"], retained["ObjectLockMode"]), (body, "COMPLIANCE"))
        link = self.run_op("attachment_download", {"attachmentId": "att1", "contentType": "image/png",
            "storageVersion": result["storageVersion"], "sha256": result["sha256"]})
        self.assertEqual(link["status"], "download")
        with self.assertRaisesRegex(worker.Blocked, "storage_failed"):
            self.run_op("attachment_download", {"attachmentId": "att1", "contentType": "image/png",
                "storageVersion": result["storageVersion"], "sha256": "0" * 64})

    def test_mislabelled_content_is_rejected_before_scanning(self):
        with self.assertRaisesRegex(worker.Blocked, "unsupported_file"):
            self.upload(b"<html>synthetic</html>", "application/pdf")
        self.assertEqual(self.scanned, [])
        self.assertNotIn(("frozen", "attachments/company/agreement/att1"), self.storage.items)

    def test_malware_blocks_retention(self):
        def infected(data, _):
            raise worker.Blocked("malware_detected")
        self.storage.items["q", "attachments-quarantine/company/agreement/att1"] = {"Body": b"%PDF-1.7 synthetic", "VersionId": "q1", "ServerSideEncryption": "AES256"}
        with self.assertRaisesRegex(worker.Blocked, "malware_detected"):
            worker.attachment(self.storage, self.settings, {}, "attachment_scan", "company", "agreement",
                {"attachmentId": "att1", "contentType": "application/pdf", "sizeBytes": 18}, scan=infected)
        self.assertNotIn(("frozen", "attachments/company/agreement/att1"), self.storage.items)


if __name__ == "__main__":
    unittest.main(verbosity=2)
