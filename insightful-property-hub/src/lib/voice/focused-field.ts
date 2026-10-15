// Tracks the last focused text field so the floating dictation button can insert text into it,
// even after the button press or a closed keyboard moved focus. Covers every `Input`/`Textarea`
// in the app; mark a field with `data-no-dictation` (or `dictation={false}`) to opt out.

type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", ""]);

let target: { el: TextField; start: number | null; end: number | null } | null = null;

export function isDictationField(node: EventTarget | null): node is TextField {
  if (node instanceof HTMLTextAreaElement) {
    return !node.disabled && !node.readOnly && !node.closest("[data-no-dictation]");
  }
  if (node instanceof HTMLInputElement) {
    return (
      TEXT_INPUT_TYPES.has(node.type) &&
      !node.disabled &&
      !node.readOnly &&
      !node.closest("[data-no-dictation]")
    );
  }
  return false;
}

function remember(el: TextField) {
  let start: number | null = null;
  let end: number | null = null;
  try {
    start = el.selectionStart;
    end = el.selectionEnd;
  } catch {
    // Some input types (email) do not expose a selection.
  }
  target = { el, start, end };
}

/** Start tracking focus; returns a cleanup function. */
export function trackFocusedFields() {
  const onFocusIn = (event: FocusEvent) => {
    if (isDictationField(event.target)) remember(event.target);
  };
  const onSelection = () => {
    const active = document.activeElement;
    if (target && active === target.el) remember(target.el);
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("selectionchange", onSelection);
  document.addEventListener("keyup", onSelection, true);
  return () => {
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("selectionchange", onSelection);
    document.removeEventListener("keyup", onSelection, true);
  };
}

/** The remembered field, if it is still on the page and editable. */
export function getDictationTarget(): TextField | null {
  if (!target || !target.el.isConnected || !isDictationField(target.el)) return null;
  return target.el;
}

/**
 * Insert text at the remembered cursor position. Uses the native value setter plus an `input`
 * event so React's controlled `onChange` handlers see the change.
 */
export function insertDictation(text: string): boolean {
  const el = getDictationTarget();
  if (!el || !target) return false;
  const value = el.value;
  const start = Math.min(target.start ?? value.length, value.length);
  const end = Math.min(Math.max(target.end ?? start, start), value.length);
  const before = value.slice(0, start);
  const after = value.slice(end);
  let insert = text.trim();
  if (before && !/\s$/.test(before)) insert = ` ${insert}`;
  if (after && !/^\s/.test(after)) insert = `${insert} `;
  if (el.maxLength > 0) {
    insert = insert.slice(0, Math.max(0, el.maxLength - before.length - after.length));
  }

  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(el, before + insert + after);
  el.dispatchEvent(new Event("input", { bubbles: true }));

  const caret = before.length + insert.length;
  el.focus({ preventScroll: true });
  try {
    el.setSelectionRange(caret, caret);
  } catch {
    // Selection is not supported for this input type.
  }
  target = { el, start: caret, end: caret };
  return true;
}
