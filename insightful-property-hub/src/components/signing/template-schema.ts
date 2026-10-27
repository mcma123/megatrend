import { Node, mergeAttributes } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TableKit } from "@tiptap/extension-table";

/**
 * Only nodes the server schema accepts (`convex/lib/signingTemplates.ts`). Links, code, images
 * and any other StarterKit extras are disabled so the editor cannot produce rejected content.
 */
const chip =
  "mx-0.5 inline-block rounded border border-sky-400 bg-sky-50 px-1 text-xs font-medium text-sky-900";
const MergeField = Node.create({
  name: "mergeField",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({ key: { default: "" } }),
  parseHTML: () => [{ tag: "span[data-merge-field]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, { "data-merge-field": "", class: chip }),
    `{${node.attrs.key}}`,
  ],
});
function blockAtom(name: string, label: (attrs: Record<string, string>) => string) {
  return Node.create({
    name,
    group: "block",
    atom: true,
    selectable: true,
    addAttributes: () => (name === "clauseRef" ? { clauseId: { default: "" } } : {}),
    parseHTML: () => [{ tag: `div[data-${name}]` }],
    renderHTML: ({ node, HTMLAttributes }) => [
      "div",
      mergeAttributes(HTMLAttributes, {
        [`data-${name}`]: "",
        class:
          "my-2 rounded border border-dashed border-slate-400 bg-slate-50 p-2 text-xs text-slate-700",
      }),
      label(node.attrs as Record<string, string>),
    ],
  });
}
const PageBreak = blockAtom("pageBreak", () => "— Page break —");
const ScheduleTable = blockAtom(
  "scheduleTable",
  () => "Payment schedule table (generated from the rent schedule)",
);
const Conditional = Node.create({
  name: "conditional",
  group: "block",
  content: "block+",
  addAttributes: () => ({ condition: { default: "" } }),
  parseHTML: () => [{ tag: "div[data-conditional]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, {
      "data-conditional": node.attrs.condition,
      class:
        "my-2 border-l-4 border-amber-400 pl-3 before:mb-1 before:block before:text-xs before:font-medium before:text-amber-800 before:content-['Only_when:_'_attr(data-conditional)]",
    }),
    0,
  ],
});

/** The complete editor schema; shared with the schema-compatibility test (no React). */
export function signingExtensions(allowClauses: boolean, titles: Record<string, string> = {}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      code: false,
      codeBlock: false,
      blockquote: false,
      strike: false,
      link: false,
    }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    TableKit.configure({ table: { resizable: false } }),
    MergeField,
    Conditional,
    PageBreak,
    ScheduleTable,
    ...(allowClauses
      ? [blockAtom("clauseRef", (attrs) => `Clause: ${titles[attrs.clauseId] ?? attrs.clauseId}`)]
      : []),
  ];
}
