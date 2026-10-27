"""Offline signing email adapter checks. All recipients, credentials and services are synthetic."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import subprocess
import time
import types
import unittest
from unittest.mock import patch

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

sys.dont_write_bytecode = True
sys.modules.setdefault("wmill", types.SimpleNamespace(get_resource=lambda _: SETTINGS))
spec = importlib.util.spec_from_file_location("signing_email_worker", Path(__file__).resolve().parents[1] / "f/signing/deliver_email.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
DELIVERY = "10000000-0000-4000-8000-000000000001"
DOMAIN = "20000000-0000-4000-8000-000000000002"
PROVIDER = "30000000-0000-4000-8000-000000000003"
MASTER = "12" * 32
# The worker receives only the derived envelope key, never the master access key.
ENVELOPE = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"Cyphersoft signing keys v1", info=b"email-envelope-v1").derive(bytes.fromhex(MASTER)).hex()
SETTINGS = {"resend_api_key":"synthetic-only", "domain_id":DOMAIN, "from_address":"Company <sign@example.test>", "reply_to":"help@example.test", "signing_origin":"https://portal.example.test", "envelope_keys":{"test":ENVELOPE}}


def payload(kind="invitation", **changes):
    value = {"contractVersion":1, "deliveryId":DELIVERY, "kind":kind, "recipient":"tenant@example.test", "from":SETTINGS["from_address"], "companyName":"Company <&>", "title":"Synthetic lease", "expiresAt":int(time.time()*1000)+60_000, "origin":SETTINGS["signing_origin"]}
    if kind == "otp": value["code"] = "01234567"
    elif kind in ("invitation", "reminder", "correction"): value["link"] = SETTINGS["signing_origin"] + "/sign#" + "A"*43
    return {**value, **changes}


def seal(value, iv=b"\x01"*12):
    key = HKDF(algorithm=hashes.SHA256(), length=32, salt=b"Cyphersoft signing keys v1", info=b"email-envelope-v1").derive(bytes.fromhex(MASTER))
    encrypted = AESGCM(key).encrypt(iv, json.dumps(value, separators=(",", ":")).encode(), f"signing-email/v1/{DELIVERY}/{value['kind']}".encode())
    encode = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")
    return f"v1.test.{encode(iv)}.{encode(encrypted)}"


class Response:
    def __init__(self, value, status=200): self.value, self.status_code, self.closed = value, status, False
    def iter_content(self, _): yield json.dumps(self.value).encode()
    def close(self): self.closed = True


class Client:
    def __init__(self, domain_changes=None, status=200, failure=False, after_domain=None):
        self.gets, self.posts = [], []
        self.domain = {"id":DOMAIN, "name":"example.test", "status":"verified", "open_tracking":False, "click_tracking":False, **(domain_changes or {})}
        self.status, self.failure, self.after_domain = status, failure, after_domain
    def get(self, url, **args):
        self.gets.append((url,args))
        if "/domains/" in url:
            result = Response(self.domain)
            if self.after_domain: self.after_domain()
            return result
        return Response({"id":PROVIDER, "from":SETTINGS["from_address"], "last_event":"delivered"})
    def post(self, url, **args):
        self.posts.append((url,args))
        if self.failure: raise RuntimeError("sensitive provider error body")
        return Response({"id":PROVIDER}, self.status)


class SigningMailChecks(unittest.TestCase):
    def send(self, value=None, client=None):
        value = value or payload()
        sealed = seal(value)
        return worker.deliver(SETTINGS, "send", DELIVERY, value["kind"], hashlib.sha256(sealed.encode()).hexdigest(), sealed, client=client or Client())

    def test_all_six_templates_and_escaped_branding(self):
        for kind in worker.KINDS:
            with self.subTest(kind=kind):
                client = Client()
                self.assertEqual(self.send(payload(kind),client)["status"], "accepted")
                mail = client.posts[0][1]["json"]
                self.assertIn("Company &lt;&amp;&gt;", mail["html"])
                self.assertNotIn("<img", mail["html"])
                self.assertEqual(mail["tags"], [{"name":"signing_delivery","value":DELIVERY}])
                self.assertFalse(client.trust_env)

    def test_stable_provider_idempotency_and_safe_results(self):
        client = Client()
        first, second = self.send(client=client), self.send(client=client)
        self.assertEqual(first, second)
        self.assertEqual(client.posts[0][1]["headers"]["Idempotency-Key"], f"signing/{DELIVERY}")
        self.assertEqual(client.posts[0][1]["headers"]["Idempotency-Key"],client.posts[1][1]["headers"]["Idempotency-Key"])
        self.assertEqual(set(first), {"status","providerMessageId"})

    def test_tracking_domain_verification_and_exact_domain_fail_closed(self):
        for change in ({"open_tracking":True},{"click_tracking":True},{"open_tracking":None},{"status":"pending"},{"name":"other.test"},{"id":PROVIDER}):
            with self.subTest(change=change):
                client=Client(change)
                self.assertEqual(self.send(client=client)["status"],"rejected")
                self.assertEqual(client.posts, [])

    def test_expired_payload_does_not_call_provider(self):
        client=Client()
        with self.assertRaises(ValueError): self.send(payload(expiresAt=int(time.time()*1000)-1),client)
        self.assertEqual(client.gets,[]); self.assertEqual(client.posts,[])

    def test_expiry_is_rechecked_after_domain_preflight(self):
        with patch.object(worker.time,"time",return_value=1000) as clock:
            client=Client(after_domain=lambda: setattr(clock,"return_value",1002))
            with self.assertRaises(ValueError): self.send(payload(expiresAt=1001000),client)
            self.assertEqual(client.posts,[])

    def test_body_digest_and_aad_tampering_are_rejected(self):
        sealed=seal(payload())
        with self.assertRaises(ValueError): worker.deliver(SETTINGS,"send",DELIVERY,"invitation","0"*64,sealed,client=Client())
        for kind, identity in (("otp",DELIVERY),("invitation",DOMAIN)):
            with self.assertRaises(Exception): worker.decrypt(sealed,SETTINGS["envelope_keys"],identity,kind)
        with self.assertRaises(Exception): worker.decrypt(sealed,{"test":"34"*32},DELIVERY,"invitation")

    def test_convex_webcrypto_envelope_decrypts_in_python_worker(self):
        value=payload("otp")
        code="import {sealEmail} from './convex/lib/signingAccessCrypto.ts'; console.log(await sealEmail(" + ",".join(json.dumps(x) for x in (MASTER,"test",DELIVERY,"otp",value)) + "));"
        result=subprocess.run(["node","--experimental-strip-types","--input-type=module","-e",code],cwd=Path(__file__).resolve().parents[1],capture_output=True,text=True,check=True,timeout=15)
        self.assertEqual(worker.decrypt(result.stdout.strip(),SETTINGS["envelope_keys"],DELIVERY,"otp"),value)

    def test_external_links_query_links_and_header_injection_are_rejected(self):
        for changes in ({"link":"https://attacker.example/sign#"+"A"*43},{"link":SETTINGS["signing_origin"]+"/sign?token="+"A"*43},{"companyName":"Company\r\nBcc: bad@example.test"},{"recipient":"a@example.test\r\nBcc:b@example.test"},{"from":"Other <x@other.test>"}):
            with self.subTest(changes=changes), self.assertRaises(ValueError): self.send(payload(**changes),Client())

    def test_post_failure_and_retryable_statuses_remain_unknown(self):
        for status in (409,429,500,503):
            with self.subTest(status=status): self.assertEqual(self.send(client=Client(status=status))["status"],"unknown")
        result=self.send(client=Client(failure=True))
        self.assertEqual(result,{"status":"unknown","error":"provider_result_unconfirmed"})

    def test_confirmed_provider_rejections_are_not_reported_accepted(self):
        for status in (400,401,403,404,413,422):
            with self.subTest(status=status): self.assertEqual(self.send(client=Client(status=status))["status"],"rejected")

    def test_lookup_never_posts_and_keeps_observation_separate_from_event_timestamp(self):
        client=Client()
        result=worker.deliver(SETTINGS,"lookup",DELIVERY,"invitation","",provider_id=PROVIDER,client=client)
        self.assertEqual(result["status"],"observed"); self.assertEqual(result["event"],"delivered")
        self.assertIn("observedAt",result); self.assertNotIn("deliveredAt",result); self.assertEqual(client.posts,[])

    def test_unknown_identity_lookup_never_calls_provider(self):
        client=Client()
        self.assertEqual(worker.deliver(SETTINGS,"lookup",DELIVERY,"invitation","",client=client)["status"],"unknown")
        self.assertEqual(client.gets,[])

    def test_main_sanitizes_configuration_failure(self):
        with patch.object(worker.wmill,"get_resource",side_effect=RuntimeError("private-provider-details")):
            result=worker.main("send",DELIVERY,"invitation")
        self.assertEqual(result["status"],"rejected");self.assertNotIn("private-provider",json.dumps(result))


if __name__ == "__main__": unittest.main(verbosity=2)
