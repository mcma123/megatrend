import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FormError, NativeSelect } from "@/components/portfolio/form-fields";

const DOCUMENTS = {
  sa_id: "South African ID",
  passport: "Passport",
  drivers_licence: "Driving licence",
  asylum_permit: "Asylum seeker permit",
} as const;
type DocumentType = keyof typeof DOCUMENTS;

/**
 * Staff check identity in person and open a single-use kiosk link on the participant's device.
 * The kiosk still sends the code to the participant's own mailbox, so staff never sign for them.
 */
export function InPersonSession({
  agreementId,
  participantKey,
  name,
}: {
  agreementId: Id<"signingAgreements">;
  participantKey: string;
  name: string;
}) {
  const start = useAction(api.signingInPerson.start);
  const [open, setOpen] = useState(false),
    [documentType, setDocumentType] = useState<DocumentType>("sa_id"),
    [ending, setEnding] = useState(""),
    [attested, setAttested] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Start in-person session
      </Button>
    );
  return (
    <div className="w-full space-y-3 rounded-md border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">
        Check {name}&apos;s identity document in person. Record only the type and its last
        characters. The participant still verifies with a code sent to their own email address.
      </p>
      {link ? (
        <div className="space-y-2 text-xs">
          <p>
            Open this single-use link on the participant&apos;s device before{" "}
            {new Date(link.expiresAt).toLocaleTimeString()}:
          </p>
          <Input readOnly dictation={false} value={link.url} aria-label="In-person session link" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(link.url)}>
              Copy link
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setLink(null);
                setOpen(false);
              }}
            >
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError(null);
            void start({
              agreementId,
              participantKey,
              documentType,
              documentEnding: ending,
              attested: true,
            })
              .then((result) =>
                setLink({
                  url: `${location.origin}/sign#in-person:${result.credential}`,
                  expiresAt: result.expiresAt,
                }),
              )
              .catch((err) =>
                setError(
                  err instanceof ConvexError && typeof err.data === "string"
                    ? err.data
                    : "The in-person session could not be prepared",
                ),
              )
              .finally(() => setBusy(false));
          }}
        >
          <Field label="Identity document" htmlFor={`${participantKey}-document`}>
            <NativeSelect
              id={`${participantKey}-document`}
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as DocumentType)}
            >
              {Object.entries(DOCUMENTS).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Last 2–4 characters" htmlFor={`${participantKey}-ending`}>
            <Input
              id={`${participantKey}-ending`}
              dictation={false}
              maxLength={4}
              value={ending}
              onChange={(e) => setEnding(e.target.value)}
            />
          </Field>
          <label className="flex gap-2 text-xs">
            <input
              type="checkbox"
              checked={attested}
              onChange={(e) => setAttested(e.target.checked)}
            />
            I checked the original document and the person present matches it.
          </label>
          {error && <FormError message={error} />}
          <div className="flex gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={busy || !attested || ending.trim().length < 2}
            >
              Prepare kiosk link
            </Button>
            <Button size="sm" type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
