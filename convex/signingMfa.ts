"use node";
import { randomUUID } from "node:crypto";
import { ConvexError, v } from "convex/values";
import { action, env } from "./_generated/server";
import { internal } from "./_generated/api";
import { signingHash } from "./lib/signing";
import {
  decryptMfa,
  encryptMfa,
  mfaKey,
  recoveryCode,
  signingTotp,
} from "./lib/signingMfaCrypto";
import type { Doc } from "./_generated/dataModel";

export const beginEnrollment = action({
  args: {},
  handler: async (
    ctx,
  ): Promise<{ secret: string; uri: string; recoveryCodes: string[] }> => {
    const data = await ctx.runQuery(internal.signingMfaState.forAction, {});
    if (data.credential?.enabled)
      throw new ConvexError(
        "Verify and reset the current authenticator before enrolling another",
      );
    const keyId = env.SIGNING_MFA_ACTIVE_KEY_ID;
    const key = mfaKey(env.SIGNING_MFA_KEYS_JSON, keyId);
    const credentialVersion = randomUUID();
    const totp = signingTotp(undefined, data.email);
    const recoveryCodes = Array.from({ length: 8 }, recoveryCode);
    const recoveryHashes = await Promise.all(
      recoveryCodes.map((code) =>
        signingHash({
          purpose: "mfa-recovery",
          userId: data.userId,
          credentialVersion,
          code,
        }),
      ),
    );
    await ctx.runMutation(internal.signingMfaState.storeEnrollment, {
      expectedVersion: data.credential?.credentialVersion ?? null,
      credentialVersion,
      keyId: keyId!,
      recoveryHashes,
      encryptedSecret: encryptMfa(
        totp.secret.base32,
        key,
        `signing-mfa:${data.userId}:${credentialVersion}`,
      ),
    });
    return { secret: totp.secret.base32, uri: totp.toString(), recoveryCodes };
  },
});

export const verify = action({
  args: { code: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: boolean; error: string | null }> => {
    if (args.code.length > 128)
      throw new ConvexError("Invalid authenticator code");
    const claimId = randomUUID();
    const result:
      | { ok: false; error: string }
      | { ok: true; credential: Doc<"signingMfa"> } = await ctx.runMutation(
      internal.signingMfaState.claimVerification,
      { claimId },
    );
    if (!result.ok) return { ok: false, error: result.error };
    const row = result.credential;
    let acceptedStep: number | undefined;
    let recoveryHash: string | undefined;
    const code = args.code.trim().toLowerCase().replaceAll("-", "");
    if (/^\d{6}$/.test(code)) {
      const key = mfaKey(env.SIGNING_MFA_KEYS_JSON, row.keyId);
      const totp = signingTotp(
        decryptMfa(
          row.encryptedSecret,
          key,
          `signing-mfa:${row.userId}:${row.credentialVersion}`,
        ),
      );
      const timestamp = Date.now();
      const delta = totp.validate({ token: code, window: 1, timestamp });
      if (delta !== null) acceptedStep = Math.floor(timestamp / 30_000) + delta;
    } else if (/^[a-f0-9]{32}$/.test(code)) {
      recoveryHash = await signingHash({
        purpose: "mfa-recovery",
        userId: row.userId,
        credentialVersion: row.credentialVersion,
        code,
      });
    }
    return await ctx.runMutation(internal.signingMfaState.finishVerification, {
      claimId,
      credentialVersion: row.credentialVersion,
      ...(acceptedStep !== undefined ? { acceptedStep } : {}),
      ...(recoveryHash ? { recoveryHash } : {}),
    });
  },
});

export const reset = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.signingMfaState.resetEnrollment, {});
    return null;
  },
});
