"""Exercise saved-parser recovery without OCR, network requests, or storage writes."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import MagicMock, patch

for name in ("boto3", "requests", "wmill", "botocore", "botocore.config"):
    sys.modules[name] = types.ModuleType(name)
sys.modules["boto3"].client = MagicMock()
sys.modules["requests"].Session = MagicMock
sys.modules["wmill"].S3Object = dict
sys.modules["botocore.config"].Config = MagicMock
source = Path(__file__).resolve().parents[1] / "f/docling/convert_document_to_markdown.py"
spec = importlib.util.spec_from_file_location("saved_parser", source)
parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(parser)


class RecoveryTests(unittest.TestCase):
    def run_saved(self, payload):
        storage = MagicMock()
        storage.get_object.return_value = {"Body": io.BytesIO(json.dumps(payload).encode())}
        with patch.object(parser.boto3, "client", return_value=storage), patch.object(parser, "_convert_source_url") as ocr, patch.object(parser, "_save_json_to_minio") as save:
            result = parser.main(parsed_json_key="tenant/doc/source.json", filename="lease.pdf", minio_endpoint="fixture-storage", minio_access_key="fixture-key", minio_secret_key="fixture-secret")
            ocr.assert_not_called()
            save.assert_not_called()
            storage.put_object.assert_not_called()
            storage.get_object.assert_called_once_with(Bucket="parsedinjson", Key="tenant/doc/source.json")
            return result

    def test_saved_parse_reuses_text_and_original_artifact_without_ocr(self):
        result = self.run_saved({"parsed_result": {"status": "success", "errors": [], "document": {"md_content": "Lease text"}}})
        self.assertEqual(result["markdown"], "Lease text")
        self.assertTrue(result["reused"])
        self.assertEqual(result["saved_json_to_minio"]["key"], "tenant/doc/source.json")

    def test_partial_parse_keeps_its_status_and_errors(self):
        result = self.run_saved({"parsed_result": {"status": "partial_success", "errors": ["Missing page"], "document": {"md_content": "Partial lease text"}}})
        self.assertEqual(result["status"], "partial_success")
        self.assertEqual(result["errors"], ["Missing page"])

    def test_invalid_saved_shape_requires_reading_the_original(self):
        with self.assertRaisesRegex(ValueError, "Invalid saved parsed JSON"):
            self.run_saved({"parsed_result": "invalid"})


if __name__ == "__main__":
    unittest.main()
