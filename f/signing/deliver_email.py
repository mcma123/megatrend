# requirements:
# cryptography
# requests
# wmill
"""Signing-only Resend adapter. No plaintext credentials or mail bodies in job logs."""
import base64
import hashlib
import html
import json
import re
import time
from email.utils import parseaddr
from urllib.parse import urlparse

import requests
import wmill
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KINDS = {"invitation", "reminder", "correction", "decline", "completion", "otp"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def require(ok):
    if not ok:
        raise ValueError("Invalid signing mail configuration or context")


def unbase64(value):
    require(isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]+", value))
    return base64.urlsafe_b64decode(value + "="*((-len(value)) % 4))


def decrypt(sealed, keys, delivery_id, kind):
    require(isinstance(sealed, str) and len(sealed) <= 24000)
    parts = sealed.split(".")
    require(len(parts) == 4 and parts[0] == "v1")
    # Resource holds only HKDF-derived `email-envelope-v1` keys per key ID, never master access keys.
    derived = keys.get(parts[1], "")
    require(isinstance(derived, str) and re.fullmatch(r"[a-fA-F0-9]{64}", derived))
    key = bytes.fromhex(derived)
    iv = unbase64(parts[2]); require(len(iv) == 12)
    plain = AESGCM(key).decrypt(iv, unbase64(parts[3]), f"signing-email/v1/{delivery_id}/{kind}".encode())
    require(len(plain) <= 16000)
    value = json.loads(plain)
    require(value.get("contractVersion") == 1 and value.get("deliveryId") == delivery_id and value.get("kind") == kind)
    return value


def address(value, display=False):
    require(isinstance(value, str) and len(value) <= 320 and not re.search(r"[\r\n]", value))
    email = parseaddr(value)[1] if display else value
    require(re.fullmatch(r"[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+", email) is not None)
    return email


def message(payload, settings):
    require(payload.get("from") == settings["from_address"])
    address(payload["from"], display=True); address(payload["recipient"])
    company, title = payload.get("companyName"), payload.get("title")
    require(all(isinstance(x, str) and 0 < len(x) <= 200 and not re.search(r"[\x00-\x1f]", x) for x in (company,title)))
    origin = urlparse(settings["signing_origin"])
    require(origin.scheme == "https" and origin.hostname and not origin.username and not origin.password and origin.path in ("", "/") and not origin.query and not origin.fragment)
    canonical = f"https://{origin.netloc}"
    require(payload.get("origin") == canonical and type(payload.get("expiresAt")) is int and payload["expiresAt"] > int(time.time()*1000))
    kind, link = payload["kind"], payload.get("link")
    wording = {
        "invitation": "Please review the agreement using your personal secure link.",
        "reminder": "Your action on this agreement is still outstanding. Use your personal link below.",
        "correction": "An updated agreement or access link is available. Review the latest version before acting.",
        "decline": "A participant declined the agreement. Please contact the company to discuss the next steps.",
        "completion": "The signing process is complete. Contact the company for authorized completed-document access.",
        "otp": "Use this verification code in the secure page where you requested it. Never share it with anyone.",
    }[kind]
    text = f"{company}\n\n{title}\n\n{wording}\n\n"
    body = f"<h1>{html.escape(company)}</h1><h2>{html.escape(title)}</h2><p>{html.escape(wording)}</p>"
    if kind == "otp":
        code = payload.get("code", ""); require(re.fullmatch(r"\d{8}", code) is not None and not link)
        text += f"{code}\n\nThis code expires in no more than ten minutes.\n"
        body += f'<p style="font-size:28px;letter-spacing:4px"><strong>{code}</strong></p><p>This code expires in no more than ten minutes.</p>'
    elif link:
        require(isinstance(link, str) and re.fullmatch(re.escape(canonical)+r"/sign#[A-Za-z0-9_-]{43}", link) is not None)
        text += f"{link}\n\nOpening this link does not sign the agreement. Email verification is required.\n"
        body += f'<p><a href="{html.escape(link, quote=True)}">Open secure agreement access</a></p><p>Opening this link does not sign the agreement. Email verification is required.</p>'
    else:
        require(kind in ("decline", "completion"))
    reply = settings.get("reply_to")
    if reply:
        address(reply); text += f"\nQuestions? Contact {reply}.\n"; body += f"<p>Questions? Contact {html.escape(reply)}.</p>"
    subject = ("Verification code" if kind == "otp" else {"invitation":"Agreement invitation","reminder":"Agreement reminder","correction":"Agreement update","decline":"Agreement declined","completion":"Agreement completed"}[kind]) + f" · {company}"
    result = {"from":payload["from"],"to":[payload["recipient"]],"subject":subject,"text":text,"html":body,
        "tags":[{"name":"signing_delivery","value":payload["deliveryId"]}],"headers":{"X-Cyphersoft-Delivery":payload["deliveryId"]}}
    if reply: result["reply_to"] = reply
    return result


def response_json(response):
    data = bytearray()
    try:
        for chunk in response.iter_content(4096):
            data.extend(chunk)
            require(len(data) <= 65536)
        return json.loads(data)
    finally:
        response.close()


def deliver(settings, operation, delivery_id, kind, payload_digest, sealed=None, provider_id=None, client=None):
    require(UUID.fullmatch(delivery_id) and kind in KINDS and operation in ("send", "lookup"))
    session = client or requests.Session()
    session.trust_env = False
    headers = {"Authorization":"Bearer "+settings["resend_api_key"],"Content-Type":"application/json"}
    if operation == "lookup":
        if not provider_id: return {"status":"unknown","error":"provider_identity_unconfirmed"}
        require(UUID.fullmatch(provider_id))
        response = session.get(f"https://api.resend.com/emails/{provider_id}",headers=headers,timeout=(5,15),allow_redirects=False,stream=True)
        if response.status_code != 200: response.close(); return {"status":"unknown","error":"provider_lookup_unavailable"}
        data = response_json(response)
        require(data.get("id") == provider_id and address(data.get("from", ""), True).lower() == address(settings["from_address"], True).lower())
        event = data.get("last_event")
        require(event in ("sent","delivered","delivery_delayed","bounced","complained","failed","suppressed","scheduled","queued"))
        return {"status":"observed","providerMessageId":provider_id,"event":event,"observedAt":int(time.time()*1000)}
    require(isinstance(sealed, str) and hashlib.sha256(sealed.encode()).hexdigest() == payload_digest)
    payload = decrypt(sealed, settings["envelope_keys"], delivery_id, kind)
    mail = message(payload, settings)
    domain_id = settings.get("domain_id", ""); require(UUID.fullmatch(domain_id))
    check_headers = {**headers,"Authorization":"Bearer "+settings.get("domain_read_api_key", settings["resend_api_key"])}
    response = session.get(f"https://api.resend.com/domains/{domain_id}",headers=check_headers,timeout=(5,15),allow_redirects=False,stream=True)
    if response.status_code != 200: response.close(); return {"status":"rejected","error":"domain_configuration_unverified"}
    domain = response_json(response)
    sender_domain = address(settings["from_address"],True).split("@")[1].lower()
    if domain.get("id") != domain_id or domain.get("name", "").lower() != sender_domain or domain.get("status") != "verified" or domain.get("open_tracking") is not False or domain.get("click_tracking") is not False:
        return {"status":"rejected","error":"verified_domain_with_tracking_disabled_required"}
    require(payload["expiresAt"] > int(time.time()*1000))
    try:
        response = session.post("https://api.resend.com/emails",headers={**headers,"Idempotency-Key":f"signing/{delivery_id}"},json=mail,timeout=(5,20),allow_redirects=False,stream=True)
        if response.status_code not in (200,201):
            status=response.status_code;response.close()
            return {"status":"rejected" if status in (400,401,403,404,413,422) else "unknown","error":"provider_rejected" if status in (400,401,403,404,413,422) else "provider_result_unconfirmed"}
        data=response_json(response);require(UUID.fullmatch(data.get("id", "")))
        return {"status":"accepted","providerMessageId":data["id"]}
    except Exception:
        return {"status":"unknown","error":"provider_result_unconfirmed"}


def main(operation: str, delivery_id: str, kind: str, payload_digest: str = "", sealed: str = "", provider_id: str = ""):
    try:
        settings=wmill.get_resource("f/signing/email_delivery")
        return deliver(settings,operation,delivery_id,kind,payload_digest,sealed or None,provider_id or None)
    except Exception:
        # No provider exception/body, recipient, token or OTP enters logs/results.
        return {"status":"unknown" if operation == "lookup" else "rejected","error":"signing_email_configuration_or_payload_invalid"}
