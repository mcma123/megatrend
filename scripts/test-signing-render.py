"""Offline template-render checks: fake Chromium converter and fake storage; no network."""
import hashlib
import importlib.util
import io
import sys
import time
import types
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
for name in ("boto3", "wmill", "botocore", "botocore.config", "requests"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["botocore.config"].Config = lambda **kwargs: kwargs
sys.modules["requests"].RequestException = type("RequestException", (Exception,), {})
ROOT = Path(__file__).resolve().parents[1]
for package in ("f", "f.signing"):
    module = types.ModuleType(package)
    module.__path__ = []
    sys.modules[package] = module


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


load("f.signing.prepare_bundle", ROOT / "f/signing/prepare_bundle.py")
worker = load("f.signing.render_template", ROOT / "f/signing/render_template.py")
from pypdf import PdfReader
from reportlab.pdfgen.canvas import Canvas


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
        obj = self.items[Bucket, Key]
        return {**obj, "ContentLength": len(obj["Body"]), "Body": io.BytesIO(obj["Body"])}


HTML = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><title>T</title><style>p{margin:0}</style></head><body><h1>Lease</h1><p>Rent R 12 000.00</p></body></html>"
HASH = hashlib.sha256(HTML.encode()).hexdigest()


def fake_convert(pages=2):
    def convert(html, settings, deadline):
        assert html == HTML.encode()
        stream = io.BytesIO()
        # Non-invariant output: creation dates and document IDs differ on every call.
        canvas = Canvas(stream, invariant=False)
        for n in range(pages):
            canvas.drawString(72, 720, f"Lease page {n + 1}")
            canvas.showPage()
        canvas.save()
        time.sleep(1.05)
        return stream.getvalue()
    return convert


SETTINGS = {"quarantine_bucket": "quarantine"}
PAYLOAD = {"generationId": "gen1", "uploadId": "upload1", "html": HTML, "htmlHash": HASH}


class RenderTests(unittest.TestCase):
    def test_identical_html_produces_identical_normalized_pdf(self):
        first, second = Storage(), Storage()
        a = worker.render(first, SETTINGS, {}, "tenant1", "agreement1", PAYLOAD, fake_convert())
        b = worker.render(second, SETTINGS, {}, "tenant1", "agreement1", PAYLOAD, fake_convert())
        self.assertEqual(a["pdfHash"], b["pdfHash"])
        pdf = first.items["quarantine", "quarantine/tenant1/agreement1/upload1.pdf"]["Body"]
        reader = PdfReader(io.BytesIO(pdf))
        self.assertEqual(len(reader.pages), 2)
        self.assertNotIn("/CreationDate", reader.metadata)
        self.assertEqual(reader.metadata["/Creator"], worker.RENDERER)
        self.assertEqual(a["status"], "rendered")
        self.assertEqual(a["pageCount"], 2)

    def test_retry_finds_identical_object_and_never_overwrites(self):
        storage = Storage()
        a = worker.render(storage, SETTINGS, {}, "tenant1", "agreement1", PAYLOAD, fake_convert())
        b = worker.render(storage, SETTINGS, {}, "tenant1", "agreement1", PAYLOAD, fake_convert())
        self.assertEqual((a["sourceVersion"], storage.puts), (b["sourceVersion"], 1))
        storage.items["quarantine", "quarantine/tenant1/agreement1/upload1.pdf"]["Body"] = b"%PDF-other"
        with self.assertRaisesRegex(worker.Blocked, "storage_failed"):
            worker.render(storage, SETTINGS, {}, "tenant1", "agreement1", PAYLOAD, fake_convert())

    def test_hash_mismatch_and_active_or_external_content_are_rejected(self):
        for html in (HTML.replace("Lease", "Changed"),):
            with self.assertRaisesRegex(worker.Blocked, "result_invalid"):
                worker.render(Storage(), SETTINGS, {}, "t", "a", {**PAYLOAD, "html": html}, fake_convert())
        for injected in ("<script>x()</script>", "<img src=x>", "<link href=x>", "<p style=\"background:url(x)\">", "<iframe></iframe>", "@import 'x';"):
            html = HTML.replace("<h1>", injected + "<h1>")
            payload = {**PAYLOAD, "html": html, "htmlHash": hashlib.sha256(html.encode()).hexdigest()}
            with self.subTest(injected=injected), self.assertRaisesRegex(worker.Blocked, "result_invalid"):
                worker.render(Storage(), SETTINGS, {}, "t", "a", payload, fake_convert())

    def test_identity_and_size_limits(self):
        with self.assertRaisesRegex(worker.Blocked, "result_invalid"):
            worker.render(Storage(), SETTINGS, {}, "t", "a", {**PAYLOAD, "uploadId": "../x"}, fake_convert())
        with self.assertRaisesRegex(worker.Blocked, "limit_exceeded"):
            worker.render(Storage(), SETTINGS, {}, "t", "a", PAYLOAD, fake_convert(pages=201))

    def test_converter_configuration_is_fixed_and_required(self):
        for bad in ({}, {"url": "ftp://renderer", "username": "u", "password": "p"},
                    {"url": "https://user:pw@renderer", "username": "u", "password": "p"},
                    {"url": "https://renderer", "username": "", "password": "p"}):
            with self.subTest(settings=bad), self.assertRaisesRegex(worker.Blocked, "not_configured"):
                worker.convert(b"x", bad, time.monotonic() + 10)

    def test_non_pdf_converter_output_fails(self):
        with self.assertRaisesRegex(worker.Blocked, "render_failed"):
            worker.render(Storage(), SETTINGS, {}, "t", "a", PAYLOAD, lambda *a: b"<html>error</html>")


if __name__ == "__main__":
    unittest.main(verbosity=2)
