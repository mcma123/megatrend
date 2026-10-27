// Derives the email worker's `envelope_keys` from the Convex signing access keyring.
// Usage: node scripts/derive-signing-envelope-keys.mjs <path-to-keyring.json>
// The keyring file is the SIGNING_ACCESS_KEYS_JSON value ({"<keyId>": "<64 hex>"}). The output
// contains only HKDF "email-envelope-v1" keys for the `f/signing/email_delivery` resource; it is
// still secret, so paste it into the Windmill secret directly and never commit or log it.
import { hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  process.stderr.write(
    "Provide the path to the signing access keyring JSON file\n",
  );
  process.exit(1);
}
const keys = JSON.parse(readFileSync(path, "utf8"));
const derived = {};
for (const [id, master] of Object.entries(keys)) {
  if (
    !/^[A-Za-z0-9_-]{1,64}$/.test(id) ||
    !/^[a-f0-9]{64}$/i.test(String(master))
  )
    throw new Error(`Invalid key entry ${id}`);
  derived[id] = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(master, "hex"),
      Buffer.from("Cyphersoft signing keys v1"),
      Buffer.from("email-envelope-v1"),
      32,
    ),
  ).toString("hex");
}
process.stdout.write(`${JSON.stringify(derived)}\n`);
