import { describe, expect, test } from "vitest";
import {
  adjustDisplayRect,
  fieldToPdfRect,
  fromDisplayRect,
  initialField,
  layoutBlockers,
  normalizeFields,
  parsePageSelection,
  toDisplayRect,
} from "./lib/signingFields";
import type { SigningField } from "./lib/signingFields";
import type { PageGeometry } from "./lib/signingPreparation";

const page: PageGeometry = {
  pageIndex: 0,
  sourceFileId: "source",
  sourcePageIndex: 0,
  mediaBox: [-30, -20, 650, 850],
  cropBox: [10, 20, 610, 820],
  rotation: 0,
  userUnit: 1,
  widthPt: 600,
  heightPt: 800,
};
const signers = [
  {
    key: "tenant",
    name: "Tenant Example",
    email: "tenant@example.test",
    role: "Tenant",
    responsibility: "signer" as const,
    stage: 1,
  },
];
const field = initialField("signature", "tenant", page, "signature-tenant");
describe("crop-relative field coordinates", () => {
  test("PDF rectangles preserve crop offsets, bottom-left origin and unscaled PDF units", () => {
    expect(
      fieldToPdfRect({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, page),
    ).toEqual([70, 580, 250, 660]);
    expect(fieldToPdfRect({ x: 0, y: 0, width: 1, height: 1 }, page)).toEqual(
      page.cropBox,
    );
  });
  test.each([0, 90, 180, 270])(
    "rotation %s preserves placement through display round trips and zoom",
    (rotation) => {
      const boxes = [
        { x: 0.1, y: 0.2, width: 0.3, height: 0.15 },
        { x: 0, y: 0, width: 1, height: 1 },
        { x: 0.8, y: 0.9, width: 0.2, height: 0.1 },
      ];
      for (const box of boxes) {
        const display = toDisplayRect(box, rotation);
        const restored = fromDisplayRect(display, rotation);
        for (const key of ["x", "y", "width", "height"] as const)
          expect(restored[key]).toBeCloseTo(box[key], 12);
        for (const viewWidth of [280, 640, 1280, 1920]) {
          const pixels = {
            x: display.x * viewWidth,
            y: display.y * viewWidth,
            width: display.width * viewWidth,
            height: display.height * viewWidth,
          };
          const normalized = {
            x: pixels.x / viewWidth,
            y: pixels.y / viewWidth,
            width: pixels.width / viewWidth,
            height: pixels.height / viewWidth,
          };
          for (const key of ["x", "y", "width", "height"] as const)
            expect(fromDisplayRect(normalized, rotation)[key]).toBeCloseTo(
              box[key],
              12,
            );
        }
      }
    },
  );
  test("90/270 degree transforms rotate the rectangle clockwise around the cropped page", () => {
    const rect = { x: 0.1, y: 0.2, width: 0.3, height: 0.15 };
    expect(toDisplayRect(rect, 90)).toEqual({
      x: 0.65,
      y: 0.1,
      width: 0.15,
      height: 0.3,
    });
    const rotated = toDisplayRect(rect, 270);
    expect(rotated.x).toBe(0.2);
    expect(rotated.y).toBeCloseTo(0.6);
    expect(rotated.width).toBe(0.15);
    expect(rotated.height).toBe(0.3);
  });
  test("pointer and keyboard deltas clamp movement/resize to the visible page", () => {
    const rect = { x: 0.8, y: 0.8, width: 0.1, height: 0.1 };
    expect(adjustDisplayRect(rect, 1, 1, false)).toEqual({
      ...rect,
      x: 0.9,
      y: 0.9,
    });
    const resize = adjustDisplayRect(rect, 1, 1, true);
    expect(resize.width).toBeCloseTo(0.2);
    expect(resize.height).toBeCloseTo(0.2);
    expect(adjustDisplayRect(rect, -10, -10, true, 0.02, 0.03)).toEqual({
      ...rect,
      width: 0.02,
      height: 0.03,
    });
    for (const rotation of [0, 90, 180, 270]) {
      const screen = toDisplayRect(field, rotation);
      const moved = fromDisplayRect(
        adjustDisplayRect(screen, 0.01, 0.02, false),
        rotation,
      );
      expect(() =>
        normalizeFields([{ ...field, ...moved }], [page], signers),
      ).not.toThrow();
      for (const dx of [-10, 10])
        for (const dy of [-10, 10]) {
          const clamped = fromDisplayRect(
            adjustDisplayRect(screen, dx, dy, false),
            rotation,
          );
          expect(() =>
            normalizeFields([{ ...field, ...clamped }], [page], signers),
          ).not.toThrow();
        }
    }
  });
});
describe("field validation and ownership", () => {
  test("all seven initial field types validate and dates stay server-owned", () => {
    for (const type of [
      "signature",
      "initials",
      "full_name",
      "signing_date",
      "text",
      "number",
      "checkbox",
    ] as const)
      expect(
        normalizeFields(
          [initialField(type, "tenant", page, type)],
          [page],
          signers,
        ),
      ).toHaveLength(1);
    expect(() =>
      normalizeFields(
        [
          {
            ...initialField("signing_date", "tenant", page, "date"),
            readOnly: false,
          },
        ],
        [page],
        signers,
      ),
    ).toThrow(/server/);
    expect(() =>
      normalizeFields([{ ...field, readOnly: true }], [page], signers),
    ).toThrow(/assigned signer/);
  });
  test.each([
    { x: -0.01 },
    { x: 0.99 },
    { width: 0.001 },
    { pageIndex: 1 },
    { participantKey: "other-company-person" },
    { maxLength: 2 },
    { label: "" },
  ])("invalid geometry/ownership/type rules reject %j", (patch) => {
    expect(() =>
      normalizeFields([{ ...field, ...patch }], [page], signers),
    ).toThrow();
  });
  test("viewer/approver/copy responsibility cannot own a signing field", () => {
    for (const responsibility of ["viewer", "approver", "copy"] as const)
      expect(() =>
        normalizeFields([field], [page], [{ ...signers[0], responsibility }]),
      ).toThrow(/signer/);
  });
  test("locked numeric values enforce range and precision and cannot be participant-editable", () => {
    const number = {
      ...initialField("number", "tenant", page, "rent"),
      readOnly: true,
      fixedValue: "12500.50",
      min: 0,
      max: 20000,
      decimals: 2,
    };
    expect(normalizeFields([number], [page], signers)).toHaveLength(1);
    for (const patch of [
      { fixedValue: "25000" },
      { fixedValue: "1.234" },
      { fixedValue: "Infinity" },
      { readOnly: false },
    ])
      expect(() =>
        normalizeFields([{ ...number, ...patch }], [page], signers),
      ).toThrow();
  });
  test("duplicate keys, contradictory constraints and oversized evidence are rejected", () => {
    expect(() => normalizeFields([field, field], [page], signers)).toThrow(
      /unique/,
    );
    expect(() =>
      normalizeFields(
        [
          {
            ...initialField("text", "tenant", page, "text"),
            minLength: 10,
            maxLength: 2,
          },
        ],
        [page],
        signers,
      ),
    ).toThrow(/Minimum/);
    const locked = {
      ...initialField("text", "tenant", page, "text"),
      readOnly: true,
      maxLength: 2000,
      fixedValue: "x".repeat(2000),
    };
    expect(() =>
      normalizeFields(
        Array.from({ length: 100 }, (_, i) => ({
          ...locked,
          key: `text-${i}`,
        })),
        [page],
        signers,
      ),
    ).toThrow(/200 KB/);
  });
  test("initials do not replace explicit required signatures for every signer", () => {
    expect(
      layoutBlockers(
        [initialField("initials", "tenant", page, "initial")],
        signers,
      ),
    ).toHaveLength(1);
    expect(layoutBlockers([field], signers)).toEqual([]);
    expect(
      layoutBlockers([{ ...field, required: false }], signers),
    ).toHaveLength(1);
  });
  test("repeat-initials page ranges are bounded, deduplicated and deliberate", () => {
    expect(parsePageSelection("1, 3-5, 4", 8)).toEqual([0, 2, 3, 4]);
    for (const value of ["0", "2-1", "1,999", "1,,2", "all", "-1", ""])
      expect(() => parsePageSelection(value, 8)).toThrow();
  });
  test("page sizes and user units set physical minimum field sizes", () => {
    const tiny: PageGeometry = { ...page, widthPt: 20, heightPt: 20 };
    expect(() =>
      normalizeFields([{ ...field, width: 0.1, height: 0.1 }], [tiny], signers),
    ).toThrow(/8 points/);
    const rotated: PageGeometry = {
      ...page,
      rotation: 90,
      userUnit: 2,
      widthPt: 1200,
      heightPt: 1600,
    };
    const sample: SigningField = initialField(
      "checkbox",
      "tenant",
      rotated,
      "check",
    );
    expect(sample.width * rotated.widthPt).toBe(18);
    expect(sample.height * rotated.heightPt).toBe(18);
  });
});
