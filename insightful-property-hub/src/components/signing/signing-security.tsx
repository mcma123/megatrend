import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "../../../../convex/_generated/api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError } from "@/components/portfolio/form-fields";

export type SigningSecurityStatus = {
  configured: boolean;
  enrolled: boolean;
  recent: boolean;
  expiresAt: number | null;
  recoveryCodesRemaining: number;
};
export function SigningSecurity({ status }: { status: SigningSecurityStatus | undefined }) {
  const begin = useAction(api.signingMfa.beginEnrollment);
  const verify = useAction(api.signingMfa.verify);
  const reset = useAction(api.signingMfa.reset);
  const [setup, setSetup] = useState<{ secret: string; recoveryCodes: string[] } | null>(null);
  const [code, setCode] = useState("");
  const [savedCodes, setSavedCodes] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(
        err instanceof ConvexError && typeof err.data === "string"
          ? err.data
          : "Signing security could not be updated",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="mb-6 space-y-3 p-4">
      <h2 className="font-medium">Signing security</h2>
      {!status ? (
        <p className="text-sm text-muted-foreground">Checking authenticator…</p>
      ) : !status.configured ? (
        <p className="text-sm text-muted-foreground">
          Signing MFA needs its server encryption keys configured before administrators can prepare
          agreements.
        </p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {status.recent
              ? "Authenticator verified for this signed-in session. Verification lasts five minutes."
              : status.enrolled
                ? "Verify your authenticator or use a recovery code before changing agreements."
                : "Add Cyphersoft Signing to your authenticator to protect agreement changes."}
          </p>
          {!status.enrolled && !setup && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const enrollment = await begin({});
                  setSetup(enrollment);
                  setSavedCodes(false);
                })
              }
            >
              Set up authenticator
            </Button>
          )}
          {setup && !status.enrolled && (
            <div className="space-y-3 rounded-lg border p-3 text-sm">
              <p>
                In your authenticator, add a time-based account named Cyphersoft Signing with this
                setup key:
              </p>
              <code className="block select-all break-all rounded bg-muted p-2">
                {setup.secret}
              </code>
              <p>Save these one-time recovery codes privately. They are shown only during setup.</p>
              <pre className="select-all overflow-x-auto rounded bg-muted p-2 text-xs">
                {setup.recoveryCodes.join("\n")}
              </pre>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={savedCodes}
                  onChange={(e) => setSavedCodes(e.target.checked)}
                />
                I saved my recovery codes
              </label>
            </div>
          )}
          {(status.enrolled || setup) && (
            <form
              className="flex flex-wrap items-end gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  const result = await verify({ code });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setCode("");
                  setSetup(null);
                });
              }}
            >
              <Field
                label={
                  status.enrolled
                    ? "Authenticator or recovery code"
                    : "Six-digit authenticator code"
                }
                htmlFor="signing-mfa-code"
              >
                <Input
                  id="signing-mfa-code"
                  dictation={false}
                  type="password"
                  autoComplete="one-time-code"
                  required
                  maxLength={128}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </Field>
              <Button type="submit" disabled={busy || Boolean(setup && !savedCodes)}>
                Verify
              </Button>
            </form>
          )}
          {status.enrolled && (
            <p className="text-xs text-muted-foreground">
              {status.recoveryCodesRemaining} recovery codes remaining.
            </p>
          )}
          {status.enrolled && status.recent && (
            <div>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setReplacing(!replacing)}
              >
                Replace authenticator
              </Button>
              {replacing && (
                <div className="mt-2 space-y-2 rounded-lg border p-3 text-sm">
                  <p>
                    This invalidates the current authenticator, recovery codes and signing
                    verification. Complete a new enrollment before making further agreement changes.
                  </p>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await reset({});
                        setSetup(null);
                        setReplacing(false);
                        setCode("");
                      })
                    }
                  >
                    Confirm replacement
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <FormError message={error} />
    </Card>
  );
}
