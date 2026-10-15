/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { email: "staff@cyphersoft.test" }));
  return { t, user: t.withIdentity({ subject: `${userId}|session` }) };
}

describe("voice usage limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
    process.env.VOICE_RATE_LIMIT_PER_MINUTE = "3";
    process.env.VOICE_DAILY_CAP = "5";
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.VOICE_RATE_LIMIT_PER_MINUTE;
    delete process.env.VOICE_DAILY_CAP;
  });

  test("rejects unauthenticated callers", async () => {
    const { t } = await setup();
    await expect(t.mutation(api.voice.consume, { kind: "transcribe" })).rejects.toThrow(
      /Sign in/,
    );
  });

  test("enforces the per-minute limit and resets in the next minute", async () => {
    const { user } = await setup();
    for (let i = 0; i < 3; i++) {
      await user.mutation(api.voice.consume, { kind: "transcribe" });
    }
    await expect(user.mutation(api.voice.consume, { kind: "assistant" })).rejects.toThrow(
      /Too many voice requests/,
    );
    vi.setSystemTime(new Date("2026-10-15T10:01:05Z"));
    const result = await user.mutation(api.voice.consume, { kind: "assistant" });
    expect(result.remainingToday).toBe(1);
  });

  test("enforces the daily cap and resets the next day", async () => {
    const { user } = await setup();
    for (let i = 0; i < 5; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 15, 10, i * 2)));
      await user.mutation(api.voice.consume, { kind: "transcribe" });
    }
    vi.setSystemTime(new Date("2026-10-15T11:00:00Z"));
    await expect(user.mutation(api.voice.consume, { kind: "transcribe" })).rejects.toThrow(
      /Daily voice limit/,
    );
    vi.setSystemTime(new Date("2026-10-16T08:00:00Z"));
    await expect(user.mutation(api.voice.consume, { kind: "transcribe" })).resolves.toEqual({
      remainingToday: 4,
    });
  });
});
