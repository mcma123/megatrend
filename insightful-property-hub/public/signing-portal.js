// Signer portal: local assets only; no analytics, third-party requests or persistent browser storage.
// Opening, viewing, typing, drawing and saving never sign. Only "Finish" after review submits an outcome.
const $ = (id) => document.getElementById(id);
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node && key !== "type" && key !== "role") node[key] = value;
    else node.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children.flat())
    if (child !== null && child !== undefined && child !== false)
      node.append(typeof child === "string" ? document.createTextNode(child) : child);
  return node;
}
const MARK_LIMIT = 105_000;
const LABELS = {
  signature: "Signature",
  initials: "Initials",
  full_name: "Full name",
  signing_date: "Signing date",
  text: "Text",
  number: "Number",
  checkbox: "Checkbox",
  radio: "Choice",
  dropdown: "Choice",
  attachment: "Supporting document",
};
const UPLOAD_TYPES = ["application/pdf", "image/jpeg", "image/png"];
const state = {
  uploads: {},
  portal: null,
  values: {},
  revision: 0,
  dirty: false,
  saving: null,
  retry: 0,
  retryTimer: 0,
  saveTimer: 0,
  conflict: null,
  current: null,
  pdf: null,
  pages: [],
  zoom: 1,
  observer: null,
  expiredTimer: 0,
  message: () => {},
  onEnded: () => {},
};

async function call(operation, values = {}) {
  const response = await fetch("/api/signing", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operation, ...values }),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}
function fail(data, fallback) {
  throw new Error((data && data.error) || fallback);
}
function canEdit() {
  const p = state.portal;
  return (
    p &&
    p.mode === "active" &&
    p.consent.required &&
    p.consent.accepted &&
    Date.now() < p.sessionExpiresAt
  );
}
/** Mirrors the server's one-level conditions: hidden fields are neither shown nor required. */
function visible(field) {
  if (!field.showIf) return true;
  const source = state.portal.fields.find((f) => f.key === field.showIf.fieldKey);
  if (!source) return false;
  const raw = source.editable ? state.values[source.key] || "" : source.value || "";
  const value = source.type === "checkbox" ? (raw === "true" ? "true" : "false") : raw;
  return value === field.showIf.equals;
}
function ownEditable() {
  return state.portal.fields.filter((f) => f.own && f.editable && visible(f));
}
function markFor(hash) {
  return state.portal.marks.find((m) => m.hash === hash);
}
function latestMark(kind) {
  const placed = ownEditable().find((f) => f.type === kind && state.values[f.key]);
  if (placed && markFor(state.values[placed.key])) return markFor(state.values[placed.key]);
  return [...state.portal.marks].reverse().find((m) => m.kind === kind) || null;
}
/** Mirrors server validation so the signer sees problems before Finish; the server remains authoritative. */
function problem(field) {
  const value = (state.values[field.key] || "").trim();
  const name = field.label || LABELS[field.type];
  if (field.type === "signature" || field.type === "initials")
    return field.required && !(value && markFor(value)) ? `${name} is required` : "";
  if (field.type === "checkbox")
    return field.required && value !== "true" ? `${name} must be checked` : "";
  if (field.type === "attachment") return field.required && !value ? `${name} is required` : "";
  if (field.type === "radio" || field.type === "dropdown")
    return field.required && !(field.options || []).includes(value)
      ? `Choose an option for ${name}`
      : "";
  if (!value) return field.required ? `${name} is required` : "";
  if (field.type === "number") {
    const n = Number(value);
    if (
      !/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value) ||
      (field.min !== undefined && n < field.min) ||
      (field.max !== undefined && n > field.max) ||
      (value.split(".")[1] || "").length > (field.decimals ?? 2)
    )
      return `${name} must be a number${field.min !== undefined ? ` from ${field.min}` : ""}${field.max !== undefined ? ` up to ${field.max}` : ""}${(field.decimals ?? 2) === 0 ? ", whole numbers only" : ` with at most ${field.decimals ?? 2} decimals`}`;
    return "";
  }
  const min = field.minLength ?? (field.required ? 1 : 0),
    max = field.maxLength ?? (field.type === "full_name" ? 160 : 500);
  return value.length < min || value.length > max ? `${name} must be ${min}–${max} characters` : "";
}
function ordered(fields) {
  return [...fields].sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x);
}
function remaining() {
  return ordered(ownEditable()).filter((f) => problem(f));
}
function displayRect(field, rotation) {
  const { x, y, width, height } = field;
  const sub = (a, b, c = 0) => Math.max(0, a - b - c);
  if (rotation === 90) return { x: sub(1, y, height), y: x, width: height, height: width };
  if (rotation === 180) return { x: sub(1, x, width), y: sub(1, y, height), width, height };
  if (rotation === 270) return { x: y, y: sub(1, x, width), width: height, height: width };
  return { x, y, width, height };
}
function dateText(ms) {
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// ---- Rendering --------------------------------------------------------------------------------

export async function openPortal({ message, onEnded }) {
  state.message = message;
  state.onEnded = onEnded;
  await reload();
}
async function reload(keepDocument = false) {
  const response = await fetch("/api/signing?view=portal", {
    credentials: "same-origin",
    cache: "no-store",
    referrerPolicy: "no-referrer",
    redirect: "error",
  });
  const data = await response.json().catch(() => ({}));
  if (!data.ok || !data.portal) {
    clearPortal();
    state.onEnded(
      "Your secure session has ended. Reopen your invitation link to continue. Saved entries are kept.",
    );
    return;
  }
  const previous = state.portal;
  state.portal = data.portal;
  if (!state.dirty) {
    state.values = { ...data.portal.draft.values };
    state.revision = data.portal.draft.revision;
  }
  renderShell();
  if (!keepDocument || !state.pdf || previous?.document.pdfHash !== data.portal.document.pdfHash)
    await loadDocument();
  else renderOverlays();
  clearInterval(state.expiredTimer);
  state.expiredTimer = setInterval(() => {
    if (state.portal && Date.now() >= state.portal.sessionExpiresAt) {
      clearInterval(state.expiredTimer);
      state.message(
        "Your secure session expired. Reopen your invitation link to continue; saved entries are kept.",
      );
      renderShell();
      renderOverlays();
    }
  }, 5000);
}
export function clearPortal() {
  clearInterval(state.expiredTimer);
  clearTimeout(state.saveTimer);
  clearTimeout(state.retryTimer);
  state.observer?.disconnect();
  void state.pdf?.destroy();
  Object.assign(state, {
    portal: null,
    values: {},
    pdf: null,
    pages: [],
    dirty: false,
    current: null,
  });
  const root = $("portal");
  root.replaceChildren();
  root.hidden = true;
  $("access").hidden = false;
}
function renderShell() {
  const p = state.portal;
  const root = $("portal");
  root.hidden = false;
  $("access").hidden = true;
  $("brand").textContent = `${p.company.name} · Secure signing`;
  $("contact").textContent = p.company.contact ? `Questions: ${p.company.contact}` : "";
  const actor =
    p.participant.responsibility === "signer" || p.participant.responsibility === "approver";
  const editable = ownEditable();
  const left = remaining();
  const done = editable.length - left.length;
  const summary = el(
    "section",
    { class: "card" },
    el("h1", { text: p.agreement.title }),
    el(
      "div",
      { class: "summary" },
      el("span", { text: `From ${p.company.name}` }),
      el("span", { text: `You: ${p.participant.name} · ${p.participant.role}` }),
      el("span", { text: `Reference ${p.agreement.reference.slice(0, 8)}` }),
      el("span", { text: `Respond by ${dateText(p.agreement.expiresAt)}` }),
      el("span", { text: `${p.progress.completed} of ${p.progress.total} participants finished` }),
    ),
    actor && p.mode === "active"
      ? el(
          "div",
          {},
          el(
            "div",
            {
              class: "progress",
              role: "progressbar",
              "aria-valuemin": 0,
              "aria-valuemax": editable.length || 1,
              "aria-valuenow": done,
            },
            Object.assign(el("span"), {}),
          ),
          el("p", {
            class: "muted small",
            id: "remaining",
            text: editable.length
              ? `${left.length} required ${left.length === 1 ? "entry" : "entries"} remaining · ${done} of ${editable.length} fields complete`
              : p.participant.responsibility === "approver"
                ? "Review the agreement, then approve it."
                : "No entries are needed from you.",
          }),
        )
      : null,
  );
  const bar = summary.querySelector(".progress > span");
  if (bar)
    bar.style.width = `${editable.length ? Math.round((done / editable.length) * 100) : 100}%`;
  const banners = [];
  if (p.mode === "completed" && p.submission) {
    const verb =
      { sign: "signed", approve: "approved", decline: "declined" }[p.submission.intent] ||
      "responded to";
    banners.push(
      el(
        "div",
        { class: "banner ok", role: "status" },
        el("strong", {
          text: `You ${verb} this agreement on ${dateText(p.submission.acceptedAt)}.`,
        }),
        el("p", {
          class: "small",
          text: `Record ${p.submission.submissionHash.slice(0, 16)}… for document version ${p.submission.preparationHash.slice(0, 12)}…. ${p.submission.intent === "decline" ? "The company has been told you declined." : p.completion ? "Every participant has finished and the agreement is complete." : p.finalising ? "Every participant has finished. The completed copy is being sealed; check back shortly." : "The company finalises the agreement after every participant has finished."}`,
        }),
        p.completion
          ? el(
              "p",
              { class: "small" },
              el("a", {
                href: "/api/signing?view=final",
                download: "signed-agreement.pdf",
                text: "Download the signed agreement (PDF)",
              }),
              ` · sealed ${dateText(p.completion.sealedAt)} · SHA-256 ${p.completion.pdfHash.slice(0, 16)}…`,
            )
          : null,
      ),
    );
  } else if (p.mode === "paused")
    banners.push(
      el("div", {
        class: "banner",
        role: "status",
        text: "Signing is paused while the company reviews a correction request. Nothing has been signed. The company will contact you.",
      }),
    );
  else if (p.mode === "closed")
    banners.push(
      el("div", {
        class: "banner",
        role: "status",
        text: "This agreement is no longer open for signing. Contact the company if you need help.",
      }),
    );
  else if (!actor)
    banners.push(
      el("div", {
        class: "banner",
        role: "status",
        text: "You were invited to view this agreement. You do not need to sign it.",
      }),
    );
  else if (p.agreement.paused)
    banners.push(el("div", { class: "banner", text: "Signing is paused." }));
  if (p.mode === "active" && Date.now() >= p.sessionExpiresAt)
    banners.push(
      el("div", {
        class: "banner",
        text: "Your secure session expired. Reopen your invitation link to continue.",
      }),
    );
  if (state.conflict) banners.push(conflictBanner());
  const consent = p.mode === "active" && actor && !p.consent.accepted ? consentCard() : null;
  // The page container is reused so rendered canvases survive summary/toolbar refreshes.
  const pages = $("pages") ?? el("div", { class: "pages", id: "pages" });
  const slot = $("editor-slot") ?? el("div", { id: "editor-slot" });
  root.replaceChildren(summary, ...banners, consent ?? "", toolbar(), pages, slot);
  $("logout").hidden = false;
  renderEditor();
}
function consentCard() {
  const p = state.portal;
  const box = el("input", { type: "checkbox", id: "consent-check" });
  const accept = el("button", {
    text: "Accept and continue",
    disabled: true,
    onclick: () =>
      guarded(accept, async () => {
        const { data } = await call("consent", { consentHash: p.consent.consentHash });
        if (!data.ok) fail(data, "Consent could not be recorded");
        await reload(true);
      }),
  });
  box.addEventListener("change", () => (accept.disabled = !box.checked));
  return el(
    "section",
    { class: "card", "aria-labelledby": "consent-title" },
    el("h2", { id: "consent-title", text: "Consent to sign electronically" }),
    ...p.consent.text.map((line) => el("p", { class: "muted", text: line })),
    el("p", {
      class: "muted small",
      text: `Platform wording ${p.consent.platformVersion} · Company consent version ${p.consent.policyVersion || "not stated"}${p.consent.privacyNoticeReference ? ` · Privacy notice ${p.consent.privacyNoticeReference}` : ""}`,
    }),
    el(
      "label",
      { class: "row" },
      box,
      " I have read and agree to sign this agreement electronically.",
    ),
    el(
      "div",
      { class: "row" },
      accept,
      outcomeButton("decline"),
      outcomeButton("request_correction"),
    ),
  );
}
function outcomeButton(kind) {
  return el("button", {
    class: kind === "decline" ? "danger" : "ghost",
    text: kind === "decline" ? "Decline to sign" : "Request a correction",
    onclick: () => outcomeDialog(kind),
  });
}
function toolbar() {
  const p = state.portal;
  const actorActive = canEdit();
  const initials = ownEditable().filter((f) => f.type === "initials");
  const pageLabel = el("span", {
    class: "status",
    id: "page-label",
    text: `${p.document.pages.length} pages`,
  });
  return el(
    "div",
    { class: "toolbar", role: "toolbar", "aria-label": "Document tools" },
    el("button", {
      class: "ghost",
      text: "−",
      "aria-label": "Zoom out",
      onclick: () => setZoom(state.zoom / 1.25),
    }),
    el("button", {
      class: "ghost",
      text: "Fit",
      "aria-label": "Fit to width",
      onclick: () => setZoom(1),
    }),
    el("button", {
      class: "ghost",
      text: "+",
      "aria-label": "Zoom in",
      onclick: () => setZoom(state.zoom * 1.25),
    }),
    el("button", { class: "ghost", text: "Previous page", onclick: () => stepPage(-1) }),
    el("button", { class: "ghost", text: "Next page", onclick: () => stepPage(1) }),
    pageLabel,
    el("a", {
      class: "status",
      href: "/api/signing?view=download",
      download: "agreement.pdf",
      text: "Download PDF",
    }),
    actorActive && ownEditable().length
      ? el("button", {
          class: "secondary",
          text: "Next required field",
          onclick: () => nextRequired(),
        })
      : null,
    actorActive && initials.length > 1
      ? el("button", { class: "secondary", text: "Initial all", onclick: () => initialAllDialog() })
      : null,
    actorActive
      ? el("button", {
          id: "finish",
          text:
            p.participant.responsibility === "approver"
              ? "Review and approve"
              : "Review and finish",
          onclick: () => reviewDialog(),
        })
      : null,
    actorActive ? outcomeButton("decline") : null,
    actorActive ? outcomeButton("request_correction") : null,
    el("span", { class: "status", id: "save-status", "aria-live": "polite", text: saveText() }),
  );
}
function saveText() {
  if (state.conflict) return "Entries changed elsewhere";
  if (state.saving) return "Saving…";
  if (state.retry) return "Not saved yet — retrying";
  if (state.dirty) return "Unsaved changes";
  if (!canEdit()) return "";
  return state.portal?.draft.updatedAt || state.revision ? "All entries saved" : "";
}
function updateStatus() {
  const node = $("save-status");
  if (node) node.textContent = saveText();
  const p = state.portal;
  const left = remaining();
  const editable = ownEditable();
  const label = $("remaining");
  if (label && editable.length)
    label.textContent = `${left.length} required ${left.length === 1 ? "entry" : "entries"} remaining · ${editable.length - left.length} of ${editable.length} fields complete`;
  const bar = document.querySelector(".progress > span");
  if (bar && p)
    bar.style.width = `${editable.length ? Math.round(((editable.length - left.length) / editable.length) * 100) : 100}%`;
}

// ---- PDF ----------------------------------------------------------------------------------------

async function sha256(buffer) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function loadDocument() {
  const p = state.portal;
  const container = $("pages");
  if (!p.document.available) {
    container.replaceChildren(
      el("p", {
        class: "muted",
        text: "The agreement document is not available. Contact the company.",
      }),
    );
    return;
  }
  container.replaceChildren(el("p", { class: "muted", text: "Loading the agreement securely…" }));
  try {
    const response = await fetch("/api/signing?view=document", {
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
    });
    if (!response.ok) throw new Error("The agreement could not be loaded. Please retry");
    const buffer = await response.arrayBuffer();
    if ((await sha256(buffer)) !== p.document.pdfHash)
      throw new Error("The agreement failed its integrity check. Do not sign; contact the company");
    const pdfjs = await import("/pdfjs/build/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/build/pdf.worker.min.mjs";
    void state.pdf?.destroy();
    state.pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
      useSystemFonts: true,
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      wasmUrl: "/pdfjs/wasm/",
      iccUrl: "/pdfjs/iccs/",
    }).promise;
    if (state.pdf.numPages !== p.document.pages.length)
      throw new Error("The agreement pages do not match the approved version. Contact the company");
    await layoutPages();
  } catch (error) {
    container.replaceChildren(
      el("p", {
        class: "muted",
        role: "alert",
        text: error instanceof Error ? error.message : "The agreement could not be loaded",
      }),
    );
  }
}
async function layoutPages() {
  const container = $("pages");
  if (!container || !state.pdf) return;
  state.observer?.disconnect();
  const available = Math.max(240, Math.min(container.clientWidth || 800, 900));
  state.pages = [];
  const nodes = [];
  for (const geometry of state.portal.document.pages) {
    const page = await state.pdf.getPage(geometry.pageIndex + 1);
    if (
      page.view.some((v, i) => Math.abs(v - geometry.cropBox[i]) > 0.001) ||
      Math.abs(page.userUnit - geometry.userUnit) > 0.0001 ||
      ((page.rotate % 360) + 360) % 360 !== geometry.rotation
    )
      throw new Error("The agreement pages do not match the approved version. Contact the company");
    const base = page.getViewport({ scale: 1, rotation: geometry.rotation });
    const scale = Math.min(
      (available / base.width) * state.zoom,
      8192 / base.width,
      8192 / base.height,
    );
    const viewport = page.getViewport({ scale, rotation: geometry.rotation });
    const canvas = el("canvas", { "aria-hidden": "true" });
    const overlay = el("div");
    const node = el(
      "div",
      {
        class: "page",
        role: "region",
        "aria-label": `Page ${geometry.pageIndex + 1} of ${state.portal.document.pages.length}`,
      },
      canvas,
      overlay,
    );
    node.style.width = `${viewport.width}px`;
    node.style.height = `${viewport.height}px`;
    overlay.style.position = "absolute";
    overlay.style.inset = "0";
    node.dataset.index = String(geometry.pageIndex);
    state.pages.push({ geometry, page, viewport, canvas, overlay, node, rendered: false });
    nodes.push(node);
  }
  container.replaceChildren(...nodes);
  state.observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const view = state.pages[Number(entry.target.dataset.index)];
        if (entry.isIntersecting) void renderPage(view);
      }
    },
    { rootMargin: "400px 0px" },
  );
  for (const node of nodes) state.observer.observe(node);
  renderOverlays();
}
async function renderPage(view) {
  if (view.rendered) return;
  view.rendered = true;
  const ratio = Math.min(
    window.devicePixelRatio || 1,
    2,
    Math.sqrt(12_000_000 / (view.viewport.width * view.viewport.height)),
  );
  view.canvas.width = Math.ceil(view.viewport.width * ratio);
  view.canvas.height = Math.ceil(view.viewport.height * ratio);
  view.canvas.style.width = `${view.viewport.width}px`;
  view.canvas.style.height = `${view.viewport.height}px`;
  const context = view.canvas.getContext("2d");
  try {
    await view.page.render({
      canvas: view.canvas,
      canvasContext: context,
      viewport: view.viewport,
      transform: [ratio, 0, 0, ratio, 0, 0],
    }).promise;
  } catch {
    view.rendered = false;
  }
}
function setZoom(value) {
  state.zoom = Math.min(3, Math.max(0.5, value));
  void layoutPages();
}
/** The page whose area is under the sticky toolbar is the current page. */
function visiblePage() {
  const index = state.pages.findIndex((view) => view.node.getBoundingClientRect().bottom > 140);
  return Math.max(0, index);
}
let labelFrame = 0;
addEventListener("scroll", () => {
  cancelAnimationFrame(labelFrame);
  labelFrame = requestAnimationFrame(() => {
    const label = $("page-label");
    if (label && state.pages.length)
      label.textContent = `Page ${visiblePage() + 1} of ${state.pages.length}`;
  });
});
function stepPage(delta) {
  const current = visiblePage();
  const target = state.pages[Math.min(state.pages.length - 1, Math.max(0, current + delta))];
  target?.node.scrollIntoView({ behavior: "smooth", block: "start" });
}
function renderOverlays() {
  const editable = canEdit();
  for (const view of state.pages) {
    const fields = state.portal.fields.filter(
      (f) => f.pageIndex === view.geometry.pageIndex && visible(f),
    );
    view.overlay.replaceChildren(
      ...fields.map((field) => {
        const rect = displayRect(field, view.geometry.rotation);
        const interactive = field.own && field.editable && editable;
        const value = state.values[field.key];
        const issue = field.own && field.editable ? problem(field) : "";
        const node = el(interactive ? "button" : "div", {
          class: `field${!field.own || !field.editable ? " locked" : value && !issue ? " done" : issue && field.required ? " missing" : ""}${state.current === field.key ? " current" : ""}`,
          type: interactive ? "button" : undefined,
          "aria-label": `${field.label || LABELS[field.type]}${field.own && field.editable && field.required ? ", required" : ""}${issue ? ", incomplete" : field.own && field.editable ? ", complete" : ""}`,
          title: field.label || LABELS[field.type],
          onclick: interactive ? () => selectField(field.key) : undefined,
        });
        node.dataset.key = field.key;
        node.style.left = `${rect.x * 100}%`;
        node.style.top = `${rect.y * 100}%`;
        node.style.width = `${rect.width * 100}%`;
        node.style.height = `${rect.height * 100}%`;
        node.style.padding = "0";
        if ((field.type === "signature" || field.type === "initials") && value && markFor(value))
          node.append(el("img", { src: markFor(value).image, alt: `Your ${field.type}` }));
        else if (field.type === "checkbox")
          node.append(
            field.own && field.editable
              ? value === "true"
                ? "☑"
                : "☐"
              : field.value === "true"
                ? "☑"
                : "☐",
          );
        else if (field.type === "signing_date")
          node.append(field.own ? "Date set on signing" : "Date");
        else if (field.type === "attachment")
          node.append(field.own && value ? "Document uploaded" : field.label || LABELS.attachment);
        else if (field.own && field.editable)
          node.append(
            value ||
              (field.type === "signature"
                ? "Sign"
                : field.type === "initials"
                  ? "Initial"
                  : field.label || LABELS[field.type]),
          );
        else node.append(field.value ?? (field.ownerRole ? `For ${field.ownerRole}` : field.label));
        return node;
      }),
    );
  }
  updateStatus();
}

// ---- Field entry --------------------------------------------------------------------------------

function setValue(key, value) {
  if (value) state.values[key] = value;
  else delete state.values[key];
  state.dirty = true;
  scheduleSave();
  renderOverlays();
}
/** Uploading does not sign. The server scans the file and returns its fingerprint for this field. */
async function uploadAttachment(field, file, issue) {
  if (!UPLOAD_TYPES.includes(file.type)) {
    issue.textContent = "Upload a PDF, JPEG or PNG file.";
    return;
  }
  if (!file.size || file.size > 10 * 1024 * 1024) {
    issue.textContent = "Supporting documents must be 10 MB or smaller.";
    return;
  }
  issue.textContent = "Uploading and scanning securely…";
  try {
    const response = await fetch("/api/signing?upload=attachment", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      referrerPolicy: "no-referrer",
      redirect: "error",
      headers: {
        "Content-Type": file.type,
        "X-Signing-Field": field.key,
        "X-Signing-Filename": encodeURIComponent(file.name.slice(0, 120)),
      },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) fail(data, "The document could not be uploaded.");
    state.uploads[data.sha256] = data.filename;
    setValue(field.key, data.sha256);
    renderEditor();
  } catch (error) {
    issue.textContent =
      error instanceof Error ? error.message : "The document could not be uploaded.";
  }
}
function selectField(key) {
  state.current = key;
  const field = state.portal.fields.find((f) => f.key === key);
  if (field.type === "checkbox") setValue(key, state.values[key] === "true" ? "" : "true");
  else if ((field.type === "signature" || field.type === "initials") && !state.values[key]) {
    const mark = latestMark(field.type);
    if (mark) setValue(key, mark.hash);
    else adoptDialog(field.type, key);
  }
  renderOverlays();
  renderEditor();
}
function renderEditor() {
  const slot = $("editor-slot");
  if (!slot) return;
  const field = state.portal.fields.find((f) => f.key === state.current);
  if (!field || !canEdit()) return slot.replaceChildren();
  const name = field.label || LABELS[field.type];
  const issue = el("p", { class: "muted small", role: "status", text: problem(field) });
  let control;
  if (field.type === "text" || field.type === "number" || field.type === "full_name") {
    control = el("input", {
      id: "field-input",
      value: state.values[field.key] || "",
      inputMode: field.type === "number" ? "decimal" : "text",
      autocomplete: field.type === "full_name" ? "name" : "off",
      maxLength: field.maxLength ?? 500,
      oninput: (event) => {
        setValue(field.key, event.target.value);
        issue.textContent = problem(field);
      },
    });
  } else if (field.type === "radio") {
    control = el(
      "div",
      { role: "radiogroup", "aria-label": name },
      ...(field.options || []).map((option, index) =>
        el(
          "label",
          { class: "row" },
          el("input", {
            type: "radio",
            name: `choice-${field.key}`,
            id: index === 0 ? "field-input" : undefined,
            checked: state.values[field.key] === option,
            onchange: () => {
              setValue(field.key, option);
              renderEditor();
            },
          }),
          ` ${option}`,
        ),
      ),
    );
  } else if (field.type === "dropdown") {
    control = el(
      "select",
      {
        id: "field-input",
        onchange: (event) => {
          setValue(field.key, event.target.value);
          issue.textContent = problem(field);
        },
      },
      el("option", { value: "", text: "Choose…" }),
      ...(field.options || []).map((option) =>
        el("option", { value: option, text: option, selected: state.values[field.key] === option }),
      ),
    );
  } else if (field.type === "attachment") {
    control = el(
      "div",
      {},
      el("p", {
        class: "muted small",
        text: state.values[field.key]
          ? `Uploaded${state.uploads[state.values[field.key]] ? `: ${state.uploads[state.values[field.key]]}` : ""}. Choose another file to replace it.`
          : "PDF, JPEG or PNG, up to 10 MB. Files are malware-scanned and seen only by authorised company staff.",
      }),
      el("input", {
        id: "field-input",
        type: "file",
        accept: UPLOAD_TYPES.join(","),
        onchange: (event) => {
          const file = event.target.files && event.target.files[0];
          event.target.value = "";
          if (file) void uploadAttachment(field, file, issue);
        },
      }),
    );
  } else if (field.type === "checkbox") {
    control = el("p", {
      class: "muted",
      text: state.values[field.key] === "true" ? "Checked" : "Not checked",
    });
  } else {
    const mark = markFor(state.values[field.key]);
    control = el(
      "div",
      { class: "row" },
      mark ? el("img", { class: "preview", src: mark.image, alt: `Your ${field.type}` }) : null,
      el("button", {
        class: "secondary",
        text: mark ? `Change ${field.type}` : `Adopt ${field.type}`,
        onclick: () => adoptDialog(field.type, field.key),
      }),
    );
  }
  slot.replaceChildren(
    el(
      "section",
      { class: "editor", "aria-label": `${name} entry` },
      el("label", {
        for: "field-input",
        text: `${name}${field.required ? " (required)" : " (optional)"} · page ${field.pageIndex + 1}`,
      }),
      control,
      issue,
      el(
        "div",
        { class: "row" },
        field.type !== "checkbox" && state.values[field.key]
          ? el("button", {
              class: "ghost",
              text: "Clear",
              onclick: () => {
                setValue(field.key, "");
                renderEditor();
              },
            })
          : field.type === "checkbox"
            ? el("button", {
                class: "ghost",
                text: state.values[field.key] === "true" ? "Uncheck" : "Check",
                onclick: () => {
                  setValue(field.key, state.values[field.key] === "true" ? "" : "true");
                  renderEditor();
                },
              })
            : null,
        el("button", {
          class: "secondary",
          text: "Next required field",
          onclick: () => nextRequired(),
        }),
        el("button", {
          class: "ghost",
          text: "Close",
          onclick: () => {
            state.current = null;
            renderOverlays();
            renderEditor();
          },
        }),
      ),
    ),
  );
  $("field-input")?.focus({ preventScroll: true });
}
function nextRequired() {
  const left = remaining();
  if (!left.length) {
    state.message(
      "All required entries are complete. Select Review and finish when you are ready.",
    );
    return;
  }
  const order = ordered(ownEditable()).map((f) => f.key);
  const after = left.find((f) => order.indexOf(f.key) > order.indexOf(state.current)) || left[0];
  state.current = after.key;
  renderOverlays();
  renderEditor();
  const node = document.querySelector(`[data-key="${CSS.escape(after.key)}"]`);
  node?.scrollIntoView({ behavior: "smooth", block: "center" });
  if (!$("field-input")) node?.focus({ preventScroll: true });
}

// ---- Saving -------------------------------------------------------------------------------------

function scheduleSave() {
  updateStatus();
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => void save(), 1200);
}
async function save() {
  if (!state.dirty || state.conflict || !canEdit()) return true;
  if (state.saving) return state.saving;
  clearTimeout(state.saveTimer);
  clearTimeout(state.retryTimer);
  const values = { ...state.values };
  state.saving = (async () => {
    try {
      const { status, data } = await call("save_draft", {
        expectedRevision: state.revision,
        values,
      });
      if (data.ok) {
        state.revision = data.draft.revision;
        state.portal.draft = data.draft;
        state.retry = 0;
        // Only clear the dirty flag when no edits happened during the request.
        if (JSON.stringify(values) === JSON.stringify(state.values)) state.dirty = false;
        else scheduleSave();
        return true;
      }
      if (status === 409 && data.conflict) {
        state.conflict = data.conflict;
        renderShell();
        renderOverlays();
        return false;
      }
      if (status === 400) {
        state.message(data.error || "Your entries could not be saved");
        return false;
      }
      throw new Error("retry");
    } catch {
      state.retry = Math.min(state.retry + 1, 6);
      state.retryTimer = setTimeout(() => void save(), 2000 * 2 ** state.retry);
      return false;
    } finally {
      state.saving = null;
      updateStatus();
    }
  })();
  updateStatus();
  return state.saving;
}
addEventListener("online", () => {
  if (state.dirty) void save();
});
addEventListener("beforeunload", (event) => {
  if (state.dirty) event.preventDefault();
});
function conflictBanner() {
  return el(
    "div",
    { class: "banner", role: "alert" },
    el("p", {
      text: "Your entries were changed in another window or device. Choose which entries to keep.",
    }),
    el(
      "div",
      { class: "row" },
      el("button", {
        class: "secondary",
        text: "Use the saved entries",
        onclick: () => {
          state.values = { ...state.conflict.values };
          state.revision = state.conflict.revision;
          state.conflict = null;
          state.dirty = false;
          renderShell();
          renderOverlays();
        },
      }),
      el("button", {
        class: "ghost",
        text: "Keep the entries on this screen",
        onclick: () => {
          state.revision = state.conflict.revision;
          state.conflict = null;
          state.dirty = true;
          renderShell();
          renderOverlays();
          void save();
        },
      }),
    ),
  );
}

// ---- Dialogs ------------------------------------------------------------------------------------

function dialog(...children) {
  const node = el("dialog", { "aria-modal": "true" }, ...children);
  node.addEventListener("close", () => node.remove());
  document.body.append(node);
  node.showModal();
  return node;
}
async function guarded(button, action) {
  if (button.disabled) return;
  button.disabled = true;
  state.message("");
  try {
    await action();
  } catch (error) {
    state.message(error instanceof Error ? error.message : "The request could not be completed");
  } finally {
    button.disabled = false;
  }
}
/** Trims transparent edges and keeps the encoded PNG under the server's size limit. */
function exportPng(source) {
  const ctx = source.getContext("2d");
  const { width, height } = source;
  const data = ctx.getImageData(0, 0, width, height).data;
  let top = height,
    left = width,
    right = -1,
    bottom = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
  if (right < 0) return null;
  const pad = 6;
  left = Math.max(0, left - pad);
  top = Math.max(0, top - pad);
  let w = Math.max(16, Math.min(width, right + pad) - left),
    h = Math.max(8, Math.min(height, bottom + pad) - top);
  for (let scale = 1; scale > 0.2; scale *= 0.8) {
    const out = el("canvas");
    out.width = Math.max(16, Math.round(w * scale));
    out.height = Math.max(8, Math.round(h * scale));
    out.getContext("2d").drawImage(source, left, top, w, h, 0, 0, out.width, out.height);
    const url = out.toDataURL("image/png");
    if (url.length <= MARK_LIMIT) return url;
  }
  return null;
}
function adoptDialog(kind, applyTo) {
  const p = state.portal;
  const initials = p.participant.name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("")
    .slice(0, 4);
  let method = "drawn";
  const pad = el("canvas", {
    class: "pad",
    "aria-label": `Draw your ${kind} with a mouse, finger or stylus`,
  });
  pad.width = kind === "initials" ? 360 : 720;
  pad.height = 220;
  const pctx = pad.getContext("2d");
  pctx.lineWidth = 4;
  pctx.lineCap = "round";
  pctx.lineJoin = "round";
  pctx.strokeStyle = "#1b2a6b";
  let drawing = false;
  const point = (event) => {
    const box = pad.getBoundingClientRect();
    return [
      ((event.clientX - box.left) / box.width) * pad.width,
      ((event.clientY - box.top) / box.height) * pad.height,
    ];
  };
  pad.addEventListener("pointerdown", (event) => {
    drawing = true;
    pad.setPointerCapture(event.pointerId);
    pctx.beginPath();
    pctx.moveTo(...point(event));
  });
  pad.addEventListener("pointermove", (event) => {
    if (!drawing) return;
    pctx.lineTo(...point(event));
    pctx.stroke();
  });
  pad.addEventListener("pointerup", () => (drawing = false));
  pad.addEventListener("pointercancel", () => (drawing = false));
  const typed = el("input", {
    value: kind === "initials" ? initials : p.participant.name,
    maxLength: 80,
    "aria-label": `Typed ${kind}`,
  });
  const typedCanvas = el("canvas", { class: "pad" });
  typedCanvas.width = pad.width;
  typedCanvas.height = pad.height;
  const drawTyped = () => {
    const c = typedCanvas.getContext("2d");
    c.clearRect(0, 0, typedCanvas.width, typedCanvas.height);
    c.fillStyle = "#1b2a6b";
    c.textBaseline = "middle";
    let size = 84;
    do {
      c.font = `italic ${size}px "Segoe Script","Brush Script MT","Snell Roundhand","URW Chancery L",cursive`;
      size -= 4;
    } while (c.measureText(typed.value).width > typedCanvas.width - 30 && size > 20);
    c.fillText(typed.value, 15, typedCanvas.height / 2);
  };
  typed.addEventListener("input", drawTyped);
  const upload = el("input", {
    type: "file",
    accept: "image/png,image/jpeg",
    "aria-label": `Upload an image of your ${kind}`,
  });
  const uploadCanvas = el("canvas", { class: "pad" });
  uploadCanvas.width = pad.width;
  uploadCanvas.height = pad.height;
  upload.addEventListener("change", async () => {
    const file = upload.files?.[0];
    const c = uploadCanvas.getContext("2d");
    c.clearRect(0, 0, uploadCanvas.width, uploadCanvas.height);
    if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(file.type)) {
      error.textContent = "Choose a PNG or JPEG image under 5 MB";
      return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(
        uploadCanvas.width / bitmap.width,
        uploadCanvas.height / bitmap.height,
        1,
      );
      c.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
      bitmap.close();
      // Re-encoding through the canvas drops file metadata; light backgrounds become transparent.
      const image = c.getImageData(0, 0, uploadCanvas.width, uploadCanvas.height);
      for (let i = 0; i < image.data.length; i += 4)
        if (image.data[i] > 225 && image.data[i + 1] > 225 && image.data[i + 2] > 225)
          image.data[i + 3] = 0;
      c.putImageData(image, 0, 0);
      error.textContent = "";
    } catch {
      error.textContent = "That image could not be read";
    }
  });
  const panels = {
    drawn: el(
      "div",
      {},
      pad,
      el("button", {
        class: "ghost",
        text: "Clear drawing",
        onclick: () => pctx.clearRect(0, 0, pad.width, pad.height),
      }),
    ),
    typed: el("div", { hidden: true }, typed, typedCanvas),
    uploaded: el(
      "div",
      { hidden: true },
      upload,
      uploadCanvas,
      el("p", {
        class: "muted small",
        text: "Upload only your own handwritten mark. The image is stored with this agreement only.",
      }),
    ),
  };
  const tabs = el(
    "div",
    { class: "tabs", role: "tablist" },
    ...Object.entries({ drawn: "Draw", typed: "Type", uploaded: "Upload" }).map(([key, label]) =>
      el("button", {
        role: "tab",
        "aria-selected": String(key === "drawn"),
        text: label,
        onclick: (event) => {
          method = key;
          for (const [k, panel] of Object.entries(panels)) panel.hidden = k !== key;
          for (const tab of tabs.children)
            tab.setAttribute("aria-selected", String(tab === event.currentTarget));
          if (key === "typed") drawTyped();
        },
      }),
    ),
  );
  const error = el("p", { class: "muted small", role: "alert" });
  const placed = ownEditable().filter((f) => f.type === kind && state.values[f.key]);
  const adopt = el("button", {
    text: `Adopt ${kind}`,
    onclick: () =>
      guarded(adopt, async () => {
        const canvas = method === "drawn" ? pad : method === "typed" ? typedCanvas : uploadCanvas;
        if (method === "typed" && !typed.value.trim()) throw new Error(`Type your ${kind}`);
        const image = exportPng(canvas);
        if (!image) throw new Error(`Add your ${kind} first`);
        const { data } = await call("adopt_mark", {
          kind,
          method,
          image,
          ...(method === "typed" ? { typedText: typed.value.trim() } : {}),
        });
        if (!data.ok) fail(data, `Your ${kind} could not be adopted`);
        state.portal.marks.push(data.mark);
        // One adopted mark per kind: placed fields switch to the new mark together.
        for (const field of placed) state.values[field.key] = data.mark.hash;
        if (applyTo) state.values[applyTo] = data.mark.hash;
        state.dirty = true;
        scheduleSave();
        node.close();
        renderOverlays();
        renderEditor();
      }),
  });
  const node = dialog(
    el("h2", { text: `Adopt your ${kind}` }),
    el("p", {
      class: "muted small",
      text: `This ${kind} is used only for this agreement. Adopting or placing it does not sign; you sign when you select Finish after review.${placed.length ? ` It will replace your ${kind} in ${placed.length} placed field${placed.length === 1 ? "" : "s"}.` : ""}`,
    }),
    tabs,
    panels.drawn,
    panels.typed,
    panels.uploaded,
    error,
    el(
      "div",
      { class: "row" },
      adopt,
      el("button", { class: "ghost", text: "Cancel", onclick: () => node.close() }),
    ),
  );
}
function initialAllDialog() {
  const fields = ordered(ownEditable().filter((f) => f.type === "initials"));
  const mark = latestMark("initials");
  if (!mark) return adoptDialog("initials", null);
  const check = el("input", { type: "checkbox" });
  const apply = el("button", {
    text: `Apply to ${fields.length} fields`,
    disabled: true,
    onclick: () => {
      for (const field of fields) state.values[field.key] = mark.hash;
      state.dirty = true;
      scheduleSave();
      node.close();
      renderOverlays();
    },
  });
  check.addEventListener("change", () => (apply.disabled = !check.checked));
  const node = dialog(
    el("h2", { text: "Initial all pages" }),
    el("p", {
      class: "muted",
      text: "Preview where your initials will be placed. Review each page before you finish.",
    }),
    el("img", { class: "preview", src: mark.image, alt: "Your adopted initials" }),
    el(
      "ul",
      { class: "list" },
      ...fields.map((f) =>
        el("li", {
          text: `Page ${f.pageIndex + 1}: ${f.label || "Initials"}${state.values[f.key] ? " (already initialled)" : ""}`,
        }),
      ),
    ),
    el(
      "label",
      { class: "row" },
      check,
      ` I confirm placing these initials in the ${fields.length} fields listed.`,
    ),
    el(
      "div",
      { class: "row" },
      apply,
      el("button", { class: "ghost", text: "Cancel", onclick: () => node.close() }),
    ),
  );
}
function describe(field) {
  if (field.type === "signing_date") return "Recorded by the server when you sign";
  if (!field.editable) return field.value ?? "";
  const value = state.values[field.key];
  if (field.type === "checkbox") return value === "true" ? "Checked" : "Not checked";
  if (field.type === "attachment")
    return value
      ? `Uploaded${state.uploads[value] ? `: ${state.uploads[value]}` : ""}`
      : "Not provided";
  if (field.type === "signature" || field.type === "initials") {
    const mark = markFor(value);
    return mark ? el("img", { src: mark.image, alt: `Your ${field.type}` }) : "Not provided";
  }
  return value || "Not provided";
}
async function reviewDialog() {
  if (!(await save()) || state.dirty) {
    state.message("Your latest entries are not saved yet. Check your connection and try again.");
    return;
  }
  const left = remaining();
  if (left.length) {
    state.message(`${left[0].label || LABELS[left[0].type]}: ${problem(left[0])}`);
    state.current = left[0].key;
    nextRequired();
    return;
  }
  const p = state.portal;
  const approver = p.participant.responsibility === "approver";
  const requestKey = crypto.randomUUID();
  const check = el("input", { type: "checkbox" });
  const finish = el("button", {
    text: approver ? "Finish and approve" : "Finish and sign",
    disabled: true,
    onclick: () =>
      guarded(finish, async () => {
        let result;
        try {
          result = await call("submit", {
            requestKey,
            expectedDraftRevision: state.revision,
            preparationHash: p.document.preparationHash,
            pdfHash: p.document.pdfHash,
            consentHash: p.consent.consentHash,
          });
        } catch {
          // Retrying reuses the same request key, so a lost response cannot create a second signature.
          throw new Error(
            "We could not confirm your submission. Check your connection and select Finish again; it will not be duplicated.",
          );
        }
        const { data, status } = result;
        if (status === 409 && data.conflict) {
          node.close();
          state.conflict = data.conflict;
          renderShell();
          renderOverlays();
          return;
        }
        if (!data.ok) fail(data, "Your submission was not accepted");
        node.close();
        state.dirty = false;
        state.current = null;
        await reload(true);
      }),
  });
  check.addEventListener("change", () => (finish.disabled = !check.checked));
  const own = ordered(p.fields.filter((f) => f.own && visible(f)));
  const node = dialog(
    el("h2", { text: approver ? "Review and approve" : "Review and sign" }),
    el("p", {
      class: "muted",
      text: `${p.agreement.title} · document version ${p.document.preparationHash.slice(0, 12)}…`,
    }),
    own.length
      ? el(
          "dl",
          { class: "review" },
          ...own.flatMap((f) => [
            el("dt", { text: `${f.label || LABELS[f.type]} · page ${f.pageIndex + 1}` }),
            el("dd", {}, describe(f)),
          ]),
        )
      : el("p", { class: "muted", text: "You have no entries in this document." }),
    el(
      "label",
      { class: "row" },
      check,
      approver
        ? " I have reviewed the complete agreement and I approve it."
        : " I have reviewed the complete agreement and my entries, and I intend to sign it electronically.",
    ),
    el(
      "div",
      { class: "row" },
      finish,
      el("button", { class: "ghost", text: "Go back", onclick: () => node.close() }),
    ),
  );
}
function outcomeDialog(kind) {
  const decline = kind === "decline";
  const requestKey = crypto.randomUUID();
  const reason = el("textarea", {
    rows: 4,
    maxLength: 1000,
    required: true,
    "aria-label": decline ? "Reason for declining" : "What needs to be corrected",
  });
  const confirm = el("button", {
    class: decline ? "danger" : "secondary",
    text: decline ? "Decline agreement" : "Send correction request",
    onclick: () =>
      guarded(confirm, async () => {
        if (!reason.value.trim()) throw new Error("Please give a short reason");
        const { data } = await call(kind, { requestKey, reason: reason.value.trim() });
        if (!data.ok) fail(data, "Your response was not recorded");
        node.close();
        state.dirty = false;
        await reload(true);
      }),
  });
  const node = dialog(
    el("h2", { text: decline ? "Decline to sign" : "Request a correction" }),
    el("p", {
      class: "muted",
      text: decline
        ? "Declining ends signing for every participant. The company will see your reason. This cannot be undone here."
        : "Signing pauses for everyone while the company reviews your request. Nothing is signed or cancelled.",
    }),
    reason,
    el(
      "div",
      { class: "row" },
      confirm,
      el("button", { class: "ghost", text: "Cancel", onclick: () => node.close() }),
    ),
  );
}
