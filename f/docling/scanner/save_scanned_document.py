from __future__ import annotations

import base64
import re
import time
from datetime import datetime, timezone
from typing import Any

import wmill
from wmill import S3Object


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return slug or "scanned-document"


def write_pdf_to_storage(document_name: str, pdf_base64: str) -> tuple[S3Object, str]:
    pdf_bytes = base64.b64decode(pdf_base64)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    path = f"scanner/{timestamp}-{slugify(document_name)}.pdf"
    stored = wmill.write_s3_file(
        path,
        pdf_bytes,
        None,
        "application/pdf",
        f'attachment; filename="{slugify(document_name)}.pdf"',
    )
    return stored, wmill.get_presigned_s3_public_url(stored)


def main(
    documentName: str,
    documentType: str = "scanner",
    uploadedBy: str | None = None,
    pdfBase64: str | None = None,
    pdfUrl: str | None = None,
    userId: str | None = None,
    scanSessionId: str | None = None,
    scanMetadata: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    started_at = time.perf_counter()
    try:
        stored_object = None
        resolved_pdf_url = pdfUrl
        if pdfBase64:
            stored_object, resolved_pdf_url = write_pdf_to_storage(documentName, pdfBase64)

        details = scanMetadata or {}
        page_count = int(details.get("pageCount", 0) or 0)
        quality_score = float(details.get("scanQualityScore", 0.0) or 0.0)
        now = datetime.now(timezone.utc).isoformat()

        result = {
            "documentName": documentName,
            "documentType": documentType,
            "fileUrl": resolved_pdf_url,
            "thumbnailUrl": details.get("thumbnailUrl"),
            "pageCount": page_count,
            "uploadDate": now,
            "processingStatus": "saved",
            "uploadedBy": uploadedBy or userId,
            "scanQualityScore": quality_score,
            "source": "scanner",
            "createdFromImages": True,
            "storageObject": stored_object,
            "userId": userId,
            "scanSessionId": scanSessionId,
            "metadata": metadata or {},
        }

        return {
            "success": True,
            "result": result,
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
            "scanQualityMetadata": {
                "pageCount": page_count,
                "storedInWorkspaceS3": stored_object is not None,
            },
        }
    except Exception as error:
        return {
            "success": False,
            "error": str(error),
            "processingTimeMs": round((time.perf_counter() - started_at) * 1000, 2),
        }
