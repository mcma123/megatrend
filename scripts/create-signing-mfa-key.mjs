import { openSync, closeSync, writeFileSync, unlinkSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Fixed gitignored output; never print keys or replace an existing keyring.
const target = fileURLToPath(new URL("../.env.signing-mfa-keys.local", import.meta.url));
let descriptor;
try {
  descriptor = openSync(target, "wx", 0o600);
} catch (error) {
  if (error.code === "EEXIST") throw new Error("A local signing keyring already exists. Refusing to overwrite it.");
  throw new Error("Could not create the local signing keyring");
}
try {
  if (process.platform === "win32") {
    const account = execFileSync("whoami", [], { encoding: "utf8" }).trim();
    execFileSync("icacls", [target, "/inheritance:r", "/grant:r", `${account}:(F)`], { stdio: "pipe" });
  }
} catch {
  closeSync(descriptor);
  unlinkSync(target); // This is the exact empty file created above, before any secret exists.
  throw new Error("Could not restrict keyring permissions. No signing key was written.");
}
try {
  writeFileSync(descriptor, JSON.stringify({ activeKeyId: "primary", keys: { primary: randomBytes(32).toString("hex") } }) + "\n");
} finally {
  closeSync(descriptor);
}
console.log("Created a private local signing MFA keyring. No key values were printed. Follow docs/signing-prerequisites.md to configure deployment secrets.");
