// @vitest-environment node
import { getSchema } from "@tiptap/core";
import { expect, test } from "vitest";
import { signingExtensions } from "./template-schema";
import { normalizeDoc, renderHtml } from "../../../../convex/lib/signingTemplates";
import { STARTERS } from "../../../../convex/lib/signingTemplateStarters";

/** Documents built through Tiptap's real schema (with all its default attributes) must pass the server schema. */
const schema = getSchema(signingExtensions(true));
const t = (value: string, marks: string[] = []) =>
  schema.text(
    value,
    marks.map((mark) => schema.marks[mark].create()),
  );
const para = (...content: ReturnType<typeof t>[]) =>
  schema.nodes.paragraph.create({ textAlign: "justify" }, content);

test("every editor construct round-trips through the server schema", () => {
  const cell = (type: "tableHeader" | "tableCell", value: string) =>
    schema.nodes[type].create(null, schema.nodes.paragraph.create(null, t(value)));
  const doc = schema.nodes.doc.create(null, [
    schema.nodes.heading.create({ level: 2, textAlign: "center" }, t("Title")),
    para(
      t("Bold", ["bold"]),
      t(" italic", ["italic", "underline"]),
      schema.nodes.mergeField.create({ key: "input.unit" }),
      schema.nodes.hardBreak.create(),
    ),
    schema.nodes.orderedList.create({ start: 3 }, [
      schema.nodes.listItem.create(null, para(t("Item"))),
    ]),
    schema.nodes.bulletList.create(null, [schema.nodes.listItem.create(null, para(t("Point")))]),
    schema.nodes.table.create(null, [
      schema.nodes.tableRow.create(null, [cell("tableHeader", "H1"), cell("tableHeader", "H2")]),
      schema.nodes.tableRow.create(null, [cell("tableCell", "A"), cell("tableCell", "B")]),
    ]),
    schema.nodes.conditional.create({ condition: "schedule.deposit_required" }, [
      para(t("Deposit")),
    ]),
    schema.nodes.clauseRef.create({ clauseId: "k123" }),
    schema.nodes.horizontalRule.create(),
    schema.nodes.pageBreak.create(),
    schema.nodes.scheduleTable.create(),
  ]);
  const json = doc.toJSON();
  const normalized = normalizeDoc(json, { allowClauses: true });
  expect(normalized.content![0]).toEqual({
    type: "heading",
    attrs: { level: 2, textAlign: "center" },
    content: [{ type: "text", text: "Title" }],
  });
  expect(normalized.content![2]).toMatchObject({ type: "orderedList", attrs: { start: 3 } });
  const out = renderHtml(normalized, {
    title: "T",
    values: { "input.unit": "Unit 4B" },
    conditions: { "schedule.deposit_required": true },
    clauses: {
      k123: normalizeDoc(
        {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Clause body" }] }],
        },
        { allowClauses: false },
      ),
    },
    schedule: null,
  });
  for (const fragment of [
    '<h2 style="text-align:center">Title</h2>',
    "<strong>Bold</strong>",
    "<u><em> italic</em></u>",
    "Unit 4B",
    "<th>",
    "Deposit",
    "Clause body",
    "page-break",
  ])
    expect(out.html).toContain(fragment);
  expect(out.missing).toEqual(["schedule"]);
});

test("starter structures are valid editor documents and server documents", () => {
  for (const starter of STARTERS) {
    const node = schema.nodeFromJSON(starter.doc);
    node.check();
    expect(() => normalizeDoc(node.toJSON(), { allowClauses: true })).not.toThrow();
  }
});

test("the clause editor schema cannot nest clause references", () => {
  expect(getSchema(signingExtensions(false)).nodes.clauseRef).toBeUndefined();
});
