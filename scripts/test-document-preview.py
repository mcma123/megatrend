"""Offline preview conversion checks. Uses fake HTTP; no production writes."""
import importlib.util
import io
from pathlib import Path
import sys
import time
import types
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True

from PIL import Image
from pypdf import PdfReader

sys.modules.setdefault("wmill", types.SimpleNamespace(get_variable=lambda name: {
    "f/docling/PREVIEW_GOTENBERG_URL": "http://converter:3000",
    "f/docling/PREVIEW_GOTENBERG_USERNAME": "test-user",
    "f/docling/PREVIEW_GOTENBERG_PASSWORD": "test-password",
}[name]))
spec = importlib.util.spec_from_file_location("document_preview", Path(__file__).resolve().parents[1] / "f/docling/render_document_preview.py")
preview = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preview)
SOURCE = "https://test.convex.cloud/api/storage/source"
UPLOAD = "https://test.convex.cloud/api/storage/upload"


class Response:
    def __init__(self, body=b"", status=200):
        self.body, self.status_code = body, status
    def __enter__(self):
        return self
    def __exit__(self, *_):
        pass
    def iter_content(self, _):
        yield self.body
    def json(self):
        return {"storageId": "generated-preview"}


class PreviewTests(unittest.TestCase):
    def test_storage_boundaries(self):
        preview.validate_storage_urls(SOURCE, UPLOAD)
        for bad in ["http://test.convex.cloud/api/storage/source", "https://evil.test/source", "https://test.convex.cloud.evil.test/api/storage/source", "https://test.convex.cloud/api/run", "https://user:password@test.convex.cloud/api/storage/source"]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                preview.validate_storage_urls(bad, UPLOAD)
        with self.assertRaises(ValueError):
            preview.validate_storage_urls(SOURCE, "https://other.convex.cloud/api/storage/upload")

    def test_multipage_tiff(self):
        frames = [Image.new("RGB", (100, 180), color) for color in ("white", "gray", "blue")]
        source = io.BytesIO()
        frames[0].save(source, format="TIFF", save_all=True, append_images=frames[1:])
        pdf = preview.tiff_to_pdf(source.getvalue())
        self.assertEqual(len(PdfReader(io.BytesIO(pdf)).pages), 3)
        for frame in frames:
            frame.close()

    def test_office_formats_use_private_converter_and_upload_pdf(self):
        for extension in ["doc", "docx", "xls", "xlsx", "pptx"]:
            with self.subTest(extension=extension), patch.object(preview.requests, "get", return_value=Response(b"office")), patch.object(preview.requests, "post", side_effect=[Response(b"%PDF-test"), Response()]) as post:
                self.assertEqual(preview.main(SOURCE, f"../../source.{extension}", UPLOAD), {"storage_id": "generated-preview"})
                self.assertEqual(post.call_args_list[0].args[0], "http://converter:3000/forms/libreoffice/convert")
                self.assertEqual(post.call_args_list[0].kwargs["auth"], ("test-user", "test-password"))
                self.assertEqual(post.call_args_list[1].kwargs["headers"]["Content-Type"], "application/pdf")

    def test_invalid_conversion_never_uploads(self):
        for response in [Response(b"corrupt"), Response(b"password required", 400), Response(b"converter unavailable", 503)]:
            with patch.object(preview.requests, "get", return_value=Response(b"office")), patch.object(preview.requests, "post", return_value=response) as post:
                with self.assertRaises(ValueError):
                    preview.main(SOURCE, "source.docx", UPLOAD)
                self.assertEqual(post.call_count, 1)

    def test_size_and_deadline_are_explicit_failures(self):
        with self.assertRaises(ValueError):
            preview.read_bounded(Response(b"12345"), 4, time.monotonic() + 5)
        with self.assertRaises(ValueError):
            preview.read_bounded(Response(b"data"), 100, time.monotonic() - 1)

    def test_transfer_errors_do_not_expose_signed_urls(self):
        with patch.object(preview.requests, "get", side_effect=preview.requests.RequestException(SOURCE)):
            with self.assertRaisesRegex(ValueError, "^Preview transfer or conversion failed.$"):
                preview.main(SOURCE, "source.doc", UPLOAD)


if __name__ == "__main__":
    unittest.main()
