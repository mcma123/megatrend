import { useEffect } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import type { JSONContent } from "@tiptap/core";
import { signingExtensions } from "./template-schema";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/portfolio/form-fields";

export type EditorOptions = {
  mergeKeys: { key: string; label: string }[];
  conditions: { key: string; label: string }[];
  clauses: { id: string; title: string }[];
};
export function TemplateEditor({
  content,
  editable,
  onChange,
  options,
  allowClauses,
}: {
  content: JSONContent;
  editable: boolean;
  onChange: (doc: JSONContent) => void;
  options: EditorOptions;
  allowClauses: boolean;
}) {
  const titles = Object.fromEntries(options.clauses.map((c) => [c.id, c.title]));
  const editor = useEditor({
    immediatelyRender: false,
    editable,
    content,
    extensions: signingExtensions(allowClauses, titles),
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none min-h-72 rounded-b-md border p-4 focus:outline-none [&_table]:w-full [&_td]:border [&_th]:border [&_td]:p-1 [&_th]:p-1",
        "aria-label": "Document editor",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
  });
  useEffect(() => {
    editor?.setEditable(editable);
  }, [editor, editable]);
  if (!editor) return <p className="text-sm text-muted-foreground">Loading editor…</p>;
  return (
    <div>
      {editable && <Toolbar editor={editor} options={options} allowClauses={allowClauses} />}
      <EditorContent editor={editor} />
    </div>
  );
}

function Toolbar({
  editor,
  options,
  allowClauses,
}: {
  editor: Editor;
  options: EditorOptions;
  allowClauses: boolean;
}) {
  const chain = () => editor.chain().focus();
  const button = (label: string, run: () => void, active = false) => (
    <Button
      key={label}
      type="button"
      size="sm"
      variant={active ? "secondary" : "ghost"}
      className="h-7 px-2 text-xs"
      aria-pressed={active}
      onClick={run}
    >
      {label}
    </Button>
  );
  return (
    <div
      className="flex flex-wrap items-center gap-1 rounded-t-md border border-b-0 bg-muted/30 p-1"
      role="toolbar"
      aria-label="Formatting"
    >
      {[1, 2, 3].map((level) =>
        button(
          `H${level}`,
          () =>
            chain()
              .toggleHeading({ level: level as 1 | 2 | 3 })
              .run(),
          editor.isActive("heading", { level }),
        ),
      )}
      {button("Text", () => chain().setParagraph().run(), editor.isActive("paragraph"))}
      {button("Bold", () => chain().toggleBold().run(), editor.isActive("bold"))}
      {button("Italic", () => chain().toggleItalic().run(), editor.isActive("italic"))}
      {button("Underline", () => chain().toggleUnderline().run(), editor.isActive("underline"))}
      {button("• List", () => chain().toggleBulletList().run(), editor.isActive("bulletList"))}
      {button("1. List", () => chain().toggleOrderedList().run(), editor.isActive("orderedList"))}
      {(["left", "center", "right", "justify"] as const).map((align) =>
        button(
          `Align ${align}`,
          () => chain().setTextAlign(align).run(),
          editor.isActive({ textAlign: align }),
        ),
      )}
      {button("Table", () => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}
      {editor.isActive("table") && (
        <>
          {button("+ Row", () => chain().addRowAfter().run())}
          {button("+ Column", () => chain().addColumnAfter().run())}
          {button("− Row", () => chain().deleteRow().run())}
          {button("− Column", () => chain().deleteColumn().run())}
          {button("Delete table", () => chain().deleteTable().run())}
        </>
      )}
      {button("Rule", () => chain().setHorizontalRule().run())}
      {button("Page break", () => chain().insertContent({ type: "pageBreak" }).run())}
      {button("Schedule table", () => chain().insertContent({ type: "scheduleTable" }).run())}
      <NativeSelect
        aria-label="Insert merge field"
        className="h-7 w-44 text-xs"
        value=""
        onChange={(event) => {
          if (event.target.value)
            chain()
              .insertContent({ type: "mergeField", attrs: { key: event.target.value } })
              .run();
        }}
      >
        <option value="">Insert field…</option>
        {options.mergeKeys.map((field) => (
          <option key={field.key} value={field.key}>
            {field.label} ({field.key})
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label="Insert conditional section"
        className="h-7 w-44 text-xs"
        value=""
        onChange={(event) => {
          if (event.target.value)
            chain()
              .insertContent({
                type: "conditional",
                attrs: { condition: event.target.value },
                content: [{ type: "paragraph" }],
              })
              .run();
        }}
      >
        <option value="">Insert condition…</option>
        {options.conditions.map((condition) => (
          <option key={condition.key} value={condition.key}>
            {condition.label}
          </option>
        ))}
      </NativeSelect>
      {allowClauses && (
        <NativeSelect
          aria-label="Insert clause"
          className="h-7 w-44 text-xs"
          value=""
          onChange={(event) => {
            if (event.target.value)
              chain()
                .insertContent({ type: "clauseRef", attrs: { clauseId: event.target.value } })
                .run();
          }}
        >
          <option value="">Insert clause…</option>
          {options.clauses.map((clause) => (
            <option key={clause.id} value={clause.id}>
              {clause.title}
            </option>
          ))}
        </NativeSelect>
      )}
      {button("Undo", () => chain().undo().run())}
      {button("Redo", () => chain().redo().run())}
    </div>
  );
}
