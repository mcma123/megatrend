from __future__ import annotations

import json
import re
from typing import Any

import requests
import wmill

OPENROUTER_KEY_VAR_PATH = "f/docling/OPENROUTER_API_KEY"
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

DOCUMENT_TYPES = ["lease", "invoice", "utility_statement", "addendum", "correspondence", "offer", "other"]

# Field catalogue per document type: key -> (label, kind). Keep keys stable; the app stores them.
FIELD_CATALOGUE: dict[str, dict[str, tuple[str, str]]] = {
    "lease": {
        "tenant_name": ("Tenant", "text"),
        "landlord_name": ("Landlord", "text"),
        "property_address": ("Property address", "text"),
        "lease_start_date": ("Lease start date", "date"),
        "lease_end_date": ("Lease end date", "date"),
        "monthly_rental": ("Monthly rental (ZAR)", "number"),
        "escalation_percent": ("Annual escalation (%)", "number"),
        "notice_period_months": ("Notice period (months)", "number"),
        "deposit_amount": ("Deposit (ZAR)", "number"),
        "lettable_area_sqm": ("Lettable area (m²)", "number"),
        "break_clause": ("Break clause", "text"),
        "renewal_option": ("Renewal option", "text"),
    },
    "invoice": {
        "supplier_name": ("Supplier", "text"),
        "invoice_number": ("Invoice number", "text"),
        "invoice_date": ("Invoice date", "date"),
        "billing_period": ("Billing period", "text"),
        "amount_excl_vat": ("Amount excl. VAT (ZAR)", "number"),
        "vat_amount": ("VAT (ZAR)", "number"),
        "total_amount": ("Total amount (ZAR)", "number"),
        "due_date": ("Due date", "date"),
        "property_address": ("Property address", "text"),
    },
    "utility_statement": {
        "supplier_name": ("Supplier", "text"),
        "account_number": ("Account number", "text"),
        "statement_date": ("Statement date", "date"),
        "billing_period": ("Billing period", "text"),
        "consumption": ("Consumption", "text"),
        "amount_due": ("Amount due (ZAR)", "number"),
        "due_date": ("Due date", "date"),
        "property_address": ("Property address", "text"),
    },
    "addendum": {
        "parent_lease_reference": ("Lease referenced", "text"),
        "effective_date": ("Effective date", "date"),
        "parties": ("Parties", "text"),
        "changes_summary": ("Changes", "text"),
    },
    "correspondence": {
        "sender": ("From", "text"),
        "recipient": ("To", "text"),
        "letter_date": ("Date", "date"),
        "subject": ("Subject", "text"),
    },
    "offer": {
        "property_address": ("Property address", "text"),
        "offered_monthly_rental": ("Offered monthly rental (ZAR)", "number"),
        "offer_date": ("Offer date", "date"),
        "valid_until": ("Valid until", "date"),
        "lease_term_months": ("Lease term (months)", "number"),
    },
    "other": {
        "title": ("Title", "text"),
        "document_date": ("Date", "date"),
        "parties": ("Parties", "text"),
    },
}

# Fields that must be present for the document to be usable without follow-up.
REQUIRED_FIELDS: dict[str, list[str]] = {
    "lease": ["lease_start_date", "lease_end_date", "monthly_rental"],
    "invoice": ["supplier_name", "invoice_date", "total_amount"],
    "utility_statement": ["supplier_name", "billing_period", "amount_due"],
}


def _catalogue_prompt() -> str:
    lines = []
    for doc_type, fields in FIELD_CATALOGUE.items():
        described = ", ".join(f"{key} ({kind})" for key, (_, kind) in fields.items())
        lines.append(f"- {doc_type}: {described}")
    return "\n".join(lines)


SYSTEM_PROMPT = f"""You extract structured data from South African commercial property documents
(leases, invoices, utility statements, addenda, offers, correspondence).

1. Classify the document as one of: {", ".join(DOCUMENT_TYPES)}.
2. Extract ONLY the fields listed for that type:
{_catalogue_prompt()}

Rules:
- Use only information present in the document. Never guess; omit fields you cannot find.
- Dates as YYYY-MM-DD. Numbers as plain numbers without currency symbols or thousands separators.
- confidence is 0..1: 0.95+ only when the value is stated explicitly and unambiguously.
- evidence is a short verbatim quote (max 160 characters) from the document supporting the value.
- page is the 1-based page number if you can tell, otherwise null.

Respond with JSON only:
{{"document_type": "...", "type_confidence": 0.0, "summary": "one sentence",
  "fields": [{{"key": "...", "value": "...", "confidence": 0.0, "evidence": "...", "page": null}}]}}"""


def _clean_value(kind: str, value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if kind == "number":
        cleaned = re.sub(r"[^0-9.\-]", "", text.replace(",", ""))
        try:
            number = float(cleaned)
        except ValueError:
            return None
        return str(int(number)) if number.is_integer() else str(number)
    if kind == "date" and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        return None
    return text[:500]


def _clamp(value: Any) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def main(
    markdown: str,
    filename: str,
    document_type_hint: str | None = None,
    model: str = "openai/gpt-4.1-mini",
    max_chars: int = 60000,
) -> dict[str, Any]:
    text = (markdown or "").strip()
    if not text:
        return {
            "document_type": document_type_hint or "other",
            "type_confidence": 0.0,
            "summary": "No readable text was found in the document.",
            "fields": [],
            "missing_fields": REQUIRED_FIELDS.get(document_type_hint or "", []),
            "model": model,
            "truncated": False,
        }

    truncated = len(text) > max_chars
    hint = (
        f"The uploader labelled this document as '{document_type_hint}'. Use that unless the content clearly says otherwise.\n"
        if document_type_hint and document_type_hint in DOCUMENT_TYPES
        else ""
    )
    user_message = f"Filename: {filename}\n{hint}\nDocument (markdown):\n{text[:max_chars]}"

    response = requests.post(
        OPENROUTER_URL,
        headers={
            "Authorization": f"Bearer {wmill.get_variable(OPENROUTER_KEY_VAR_PATH)}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_message},
            ],
        },
        timeout=180,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    data = json.loads(content)

    document_type = data.get("document_type")
    if document_type not in DOCUMENT_TYPES:
        document_type = document_type_hint if document_type_hint in DOCUMENT_TYPES else "other"
    catalogue = FIELD_CATALOGUE[document_type]

    fields: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in data.get("fields") or []:
        key = str(item.get("key", "")).strip()
        if key not in catalogue or key in seen:
            continue
        label, kind = catalogue[key]
        value = _clean_value(kind, item.get("value"))
        if value is None:
            continue
        seen.add(key)
        page = item.get("page")
        fields.append(
            {
                "key": key,
                "label": label,
                "kind": kind,
                "value": value,
                "confidence": _clamp(item.get("confidence")),
                "evidence": (str(item.get("evidence") or "").strip()[:200] or None),
                "page": page if isinstance(page, int) and page > 0 else None,
            }
        )

    missing = [key for key in REQUIRED_FIELDS.get(document_type, []) if key not in seen]

    return {
        "document_type": document_type,
        "type_confidence": _clamp(data.get("type_confidence")),
        "summary": str(data.get("summary") or "")[:400],
        "fields": fields,
        "missing_fields": missing,
        "model": model,
        "truncated": truncated,
    }
