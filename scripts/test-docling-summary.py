"""Regression checks for the app flow's compact processing result contract."""
import importlib.util
import unittest
from pathlib import Path

source = Path(__file__).resolve().parents[1] / "f/docling/process_document_for_app__flow/summarize.py"
spec = importlib.util.spec_from_file_location("docling_summary", source)
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class SummaryContractTests(unittest.TestCase):
    def summarize(self, **overrides):
        args = {
            "parse_result": {"status": "success", "markdown": "Lease text", "errors": [], "saved_json_to_minio": {"key": "tenant/doc/attempt/source.json"}},
            "okf_result": {"bundle_root": "tenant/doc/attempt/source"},
            "extraction": {"document_type": "lease", "fields": [{"key": "monthly_rental", "value": "10000"}], "truncated": False},
            "attempt_id": "attempt-1",
        }
        args.update(overrides)
        return summary.main(**args)

    def test_complete_result_carries_identity_and_artifacts(self):
        result = self.summarize()
        self.assertEqual(result["contract_version"], 1)
        self.assertEqual(result["attempt_id"], "attempt-1")
        self.assertTrue(result["completeness"]["complete"])
        self.assertEqual(result["parsed_json_key"], "tenant/doc/attempt/source.json")
        self.assertEqual(result["provenance"]["page_count_source"], "unknown")

    def test_truncated_source_is_partial(self):
        result = self.summarize(extraction={"fields": [{"key": "monthly_rental", "value": "10000"}], "truncated": True})
        self.assertFalse(result["completeness"]["complete"])
        self.assertEqual(result["stages"]["extract"]["status"], "partial")

    def test_parser_errors_prevent_complete_result(self):
        for status in ("success", "partial_success", "failure"):
            with self.subTest(status=status):
                result = self.summarize(parse_result={"status": status, "markdown": "Partial text", "errors": ["Page unavailable"]})
                self.assertFalse(result["completeness"]["complete"])
                self.assertEqual(result["stages"]["parse"]["status"], "partial")

    def test_knowledge_failure_is_independent_of_source_coverage(self):
        result = self.summarize(okf_result={"error": {"message": "Storage unavailable"}})
        self.assertEqual(result["stages"]["knowledge"]["status"], "failed")
        self.assertTrue(result["completeness"]["complete"])
        self.assertIsNone(result["okf_bundle_root"])

    def test_malformed_extraction_is_not_complete(self):
        for extraction in (None, {}, {"fields": "invalid"}, {"fields": []}):
            with self.subTest(extraction=extraction):
                result = self.summarize(extraction=extraction)
                self.assertFalse(result["completeness"]["complete"])
                self.assertEqual(result["stages"]["extract"]["status"], "failed")

    def test_legacy_caller_can_omit_attempt_id(self):
        result = self.summarize(attempt_id=None)
        self.assertIsNone(result["attempt_id"])
        self.assertTrue(result["completeness"]["complete"])

    def test_parse_failure_skips_dependents_and_classifies_transport(self):
        result = self.summarize(parse_result={"error": {"message": "503 Docling unavailable at https://host/private?token=secret"}}, extraction=None, okf_result=None)
        self.assertEqual(result["stages"]["parse"]["status"], "failed")
        self.assertEqual(result["stages"]["parse"]["error_kind"], "transport")
        self.assertEqual(result["stages"]["knowledge"]["status"], "skipped")
        self.assertEqual(result["stages"]["extract"]["status"], "skipped")
        self.assertNotIn("secret", result["stages"]["parse"]["error"])

    def test_extraction_failure_and_malformed_fields_are_explicit(self):
        result = self.summarize(extraction={"error": {"message": "429 rate limit"}})
        self.assertEqual(result["stages"]["extract"]["error_kind"], "rate_limit")
        self.assertTrue(result["stages"]["extract"]["retryable"])
        for fields in ([None], [{"key": "rent"}], ["invalid"]):
            self.assertEqual(self.summarize(extraction={"fields": fields})["stages"]["extract"]["status"], "failed")

    def test_knowledge_recovery_skips_extraction(self):
        result = self.summarize(retry_stage="knowledge", extraction=None)
        self.assertEqual(result["stages"]["knowledge"]["status"], "succeeded")
        self.assertEqual(result["stages"]["extract"]["status"], "skipped")

    def test_extraction_recovery_preserves_prior_knowledge_outcome(self):
        result = self.summarize(retry_stage="extract", okf_result=None, reused_knowledge={"bundle_root": "tenant/doc/source/bundle", "status": "succeeded"})
        self.assertEqual(result["stages"]["knowledge"]["status"], "succeeded")
        self.assertTrue(result["stages"]["knowledge"]["reused"])
        self.assertEqual(result["okf_bundle_root"], "tenant/doc/source/bundle")


if __name__ == "__main__":
    unittest.main()
