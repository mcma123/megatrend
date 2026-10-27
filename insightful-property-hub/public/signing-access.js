// Standalone portal: no platform auth, analytics, third-party assets or persistent credential storage.
// "#in-person:<token>" is a staff-prepared kiosk link; the code still goes to the participant's mailbox.
let invitation = location.hash.slice(1);
history.replaceState(null, "", "/sign");
const kiosk = invitation.startsWith("in-person:");
if (kiosk) invitation = invitation.slice("in-person:".length);
if (!/^[A-Za-z0-9_-]{43}$/.test(invitation)) invitation = "";
const byId = (id) => document.getElementById(id);
let busy = false,
  retryAt = 0,
  portal = null;
function show(section) {
  byId("access").hidden = false;
  for (const name of ["start", "challenge"]) byId(name).hidden = name !== section;
}
function message(text = "") {
  byId("message").textContent = text;
}
function controls(value) {
  busy = value;
  for (const id of ["begin", "send-code", "verify", "logout"])
    byId(id).disabled = value || (id === "send-code" && Date.now() < retryAt);
}
async function api(operation, values = {}) {
  const response = await fetch("/api/signing", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, ...values }),
  });
  const data = await response.json();
  if (!response.ok || !data.ok)
    throw new Error(data.error || "Verification is unavailable. Please contact the company.");
  return data;
}
async function run(action) {
  if (busy) return;
  controls(true);
  message();
  try {
    await action();
  } catch (error) {
    message(error instanceof Error ? error.message : "Verification is unavailable.");
  } finally {
    controls(false);
  }
}
function ended(text) {
  show("start");
  byId("begin").hidden = true;
  byId("logout").hidden = true;
  message(text);
}
async function openSigning() {
  // The signing journey is a separate same-origin module, loaded only after mailbox verification.
  portal ??= await import("/signing-portal.js");
  await portal.openPortal({ message, onEnded: ended });
}
async function resume() {
  if (invitation) {
    show("start");
    byId("begin").hidden = false;
    byId("start-help").textContent = kiosk
      ? "In-person session: the participant will receive a code at their own email address."
      : "Use email verification to open this personal invitation.";
    return;
  }
  try {
    const response = await fetch("/api/signing", {
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    const data = await response.json();
    if (data.ok && data.challengeReady) {
      show("challenge");
      byId("recipient").textContent = `A code will be sent to ${data.recipient}.`;
      byId("code-form").hidden = false;
    } else if (data.ok) {
      await openSigning();
    } else {
      show("start");
      byId("begin").hidden = true;
    }
  } catch {
    message("Secure access is unavailable. Please try again or contact the company.");
  }
}
byId("begin").addEventListener("click", () =>
  run(async () => {
    const data = kiosk
      ? await api("kiosk_exchange", { kioskToken: invitation })
      : await api("exchange", { invitationToken: invitation });
    invitation = "";
    show("challenge");
    byId("recipient").textContent = `Your verification code will be sent to ${data.recipient}.`;
  }),
);
byId("send-code").addEventListener("click", () =>
  run(async () => {
    const data = await api("request_code");
    retryAt = data.retryAt;
    byId("code-form").hidden = false;
    message("The code email is being prepared. Use the latest code when it arrives.");
    byId("code").focus();
  }),
);
byId("code-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run(async () => {
    const code = byId("code").value;
    byId("code").value = "";
    await api("verify_code", { code });
    await openSigning();
  });
});
byId("logout").addEventListener("click", () =>
  run(async () => {
    await api("logout");
    portal?.clearPortal();
    ended("Your secure session has ended. Reopen your invitation to verify again.");
  }),
);
setInterval(() => {
  if (!busy) controls(false);
}, 1000);
addEventListener("pagehide", () => {
  invitation = "";
  byId("code").value = "";
  portal?.clearPortal();
  show("start");
});
addEventListener("pageshow", (event) => {
  if (event.persisted) void resume();
});
void resume();
