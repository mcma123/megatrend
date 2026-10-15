# Voice dictation and voice assistant

Two floating buttons sit at the bottom right of the app (they can be dragged up or down):

- **Mic (everyone, staff and client portal):** dictates into the last text field you tapped.
- **Sparkle (staff only):** opens the voice assistant. It navigates, opens records, switches tabs and filters, searches and fills forms right away. Anything that changes data (saving a form, starting a renewal, approving fields, generating sourcing options...) appears as a **Confirm** card in the panel and runs only when you tap it. Destructive actions (delete, archive, reject, remove, revoke) are never available by voice.

## Architecture

```
Browser                                Portal server (TanStack routes)       Backends
VoiceRecorderProvider (one recorder) -> POST /api/transcribe --------------> OpenRouter /audio/transcriptions
  ├ dictation mic -> last focused field   auth + Convex voice.consume quota
  └ assistant panel ------------------> POST /api/assistant (staff) -------> Mastra POST /voice/assist (service token)
form registry (useVoiceForm)  <-------- { reply, actions[] }                  voice-assistant-agent + action tools
executeVoiceActions: navigate -> wait for form -> fill -> highlight
```

| Piece | Path |
|---|---|
| Shared recorder (MediaRecorder, 60 s cap, silence check, one recording at a time) | `src/lib/voice/voice-recorder.tsx` |
| Last-focused-field tracking and text insertion | `src/lib/voice/focused-field.ts` |
| Floating dock and assistant panel | `src/components/voice/` |
| Form registry and `useVoiceForm` | `src/lib/voice/form-registry.ts` |
| Voice field schemas and openable forms | `src/lib/voice/forms.ts` |
| Page command catalog and live registry (`useVoiceCommands`) | `src/lib/voice/commands.ts`, `src/lib/voice/command-registry.ts` |
| Action executor and confirmations | `src/lib/voice/assistant-actions.ts` |
| Transcription and quota (server only) | `src/lib/server/voice.ts`, `src/routes/api.transcribe.ts` |
| Assistant proxy (staff only) | `src/routes/api.assistant.ts` |
| Usage limits (counts only, no content) | `convex/voice.ts` (`voiceUsage` table) |
| Agent, tools, contract, route | `src/mastra/agents/voice-assistant-agent.ts`, `tools/voice-assistant-tools.ts`, `ports/voice-assistant.ts`, `application/voice-assistant/`, `routes/voice-assistant.ts` |

Rules the design enforces:

- **Keys stay on the server.** OpenRouter is called from the portal server and Mastra, never from the browser.
- **The agent only records client actions.** These are `navigate`, `fill_form`, `run_command`, `submit_form` and `ask_user`. Data changes run in the browser through the page's own handlers and mutations (so normal permission checks apply), only after a Confirm tap, and only on the page they were prepared for. There is no delete, archive, reject, pay or send action.
- **Values are validated twice.** Mastra checks them against the form's field schema (field exists, type, allowed options), and the browser checks them again before filling.
- **Nothing sensitive is logged.** Audio and transcripts are never logged or stored. The server logs only status, size, format and timing.

## Dictation in any text field

Every `Input` and `Textarea` from `components/ui` works automatically. A document-level `focusin` tracker remembers the last text field and its cursor, and the mic inserts text there; React `onChange` still fires. To exclude a field, pass `dictation={false}` (or add `data-no-dictation` to a raw element). Password, date, number and file inputs are never targets.

Presses on the dock do not close open dialogs: `components/ui/dialog.tsx` and `sheet.tsx` ignore outside-clicks on `[data-voice-dock]`.

## Making a form voice-fillable

1. Describe its fields in `src/lib/voice/forms.ts`. Each field's `name` must match the form's state key, and `inputId` must match the input's DOM id so it can be highlighted.
2. Register the form while it is open:

```tsx
import { toFormStrings, useVoiceForm } from "@/lib/voice/form-registry";
import { propertyVoiceFields } from "@/lib/voice/forms";

useVoiceForm({
  formId: "property.create",
  title: "New property",
  enabled: open, // register only while the dialog is open
  fields: propertyVoiceFields({ clients: clientOptions }),
  values,
  setValues: (patch) => setValues((current) => ({ ...current, ...toFormStrings(patch) })),
});
```

3. Optional: to let the assistant open the form from anywhere, add it to `openableVoiceForms()` with a route. Then make that route open the dialog on `?new=1` (`validateSearch: validateNewFormSearch` from `src/lib/voice/new-form-search.ts`). `/properties`, `/leases` and `/tasks` show the pattern.

**Connected forms** (Save/Generate always needs Confirm):

| Form | Opens from anywhere | Confirmed save |
|---|---|---|
| `property.create` / `property.edit` | `/properties?new=1` / Edit on the property | yes |
| `lease.create` / `lease.edit` | `/leases?new=1` / Edit on the lease | yes |
| `action.create` / `action.edit` | `/tasks?new=1` | yes |
| `client.create` / `client.edit` | `/clients?new=1` (platform admins) / Edit on the client | yes |
| `document.upload` | `/documents?new=1` | no: a person picks the files |
| `sourcing.brief` | `/sourcing` | yes (Generate options pack) |

The Property form is for commercial property and has no bedrooms or price fields. Facts without a matching field go into Notes as `Label: value` lines (for example `Bedrooms: 3`, `Price: USD 150000`), and follow-ups rewrite only that line.

## Page commands and records

Each request also sends:

- **`commandCatalog`** (`src/lib/voice/commands.ts`): every command the assistant knows, with its page, effect (`view` runs now, `change` needs Confirm) and parameters.
- **`pageCommands`**: the commands the current page has registered right now, with live choices (e.g. the document's pending fields, the client's leases).
- **`records`**: clients, properties, leases and documents (up to 300 each) so the agent can `find_records` and `open_record`, e.g. "open the DHL Sandton lease and start the renewal".

| Page | Commands |
|---|---|
| `/clients` | `clients.search` |
| `/clients/$id` | `client.tab`, `client.openEdit`, `client.openAddProperty`, `client.openAddLease`, `client.openUpload`, `client.openPortal` |
| `/properties`, `/properties/$id` | `properties.search`, `property.openEdit`, `property.openAddLease` |
| `/leases` | `leases.filter` |
| `/leases/$id` | `lease.openEdit`, `lease.draftInsight`; confirm: `lease.startRenewal`, `lease.addClause` |
| `/documents` | `documents.tab`, `documents.search` |
| `/documents/$id` | confirm: `document.reprocess`, `document.approveHighConfidence`, `document.approveField`, `document.correctField`, `document.completeReview`, `document.linkProperty`, `document.applyToLease`, `document.retryStage`, `document.acknowledgeIncomplete` |
| `/sourcing` | `sourcing.openBrief`; confirm: Generate (submit of `sourcing.brief`) |

### Adding a command

1. Add its definition to `COMMAND_CATALOG` (`src/lib/voice/commands.ts`). Never add destructive commands.
2. Register a handler on the page, enabled only when the matching button is usable. Throw to report an error; return a short message on success:

```tsx
import { useVoiceCommands } from "@/lib/voice/command-registry";

useVoiceCommands("leases.detail", {
  "lease.startRenewal": {
    run: async () => {
      await renew(); // the same function the button uses
      return "Renewal started.";
    },
    enabled: lease?.canEdit === true && lease.status === "active",
  },
});
```

Call the hook before any early return in the component. For selects known only on the page, pass live `params` (see `field-review-table.tsx`).

## Environment variables

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `OPENROUTER_API_KEY` | portal server, Mastra | — | Existing OpenRouter key |
| `OPENROUTER_TRANSCRIPTION_MODEL` | portal server | `openai/whisper-large-v3-turbo` | Speech-to-text model |
| `VOICE_MAX_AUDIO_BYTES` | portal server | 8 MB | Upload size cap |
| `VITE_VOICE_MAX_RECORDING_SECONDS` | browser (build time) | 60 | Auto-stop limit |
| `MASTRA_VOICE_SERVICE_TOKEN` | portal server **and** Mastra | — | Shared secret for `/voice/assist`; the assistant returns 503 without it |
| `VOICE_ASSISTANT_MODEL` | Mastra | `OPENROUTER_MODEL` or `openai/gpt-4.1-mini` | Assistant LLM |
| `VOICE_RATE_LIMIT_PER_MINUTE` | Convex deployment | 10 | Per-user requests per minute (dictation + assistant) |
| `VOICE_DAILY_CAP` | Convex deployment | 200 | Per-user requests per UTC day |

In the combined Docker container, set `MASTRA_VOICE_SERVICE_TOKEN` once in Dokploy: the portal and Mastra share the environment.

## Testing

- **Automated tests:** `npm test` covers the Convex quota tests (`convex/voice.test.ts`), form-value validation (`form-values.test.ts`) and the session rules for records, commands and confirmed submits (`voice-session.test.ts`, both in `src/mastra/application/voice-assistant/`).
- **Agent only:** run Mastra with a token (`MASTRA_VOICE_SERVICE_TOKEN=dev npm run dev:mastra`). Then POST a request shaped like `VoiceAssistantRequest` to `http://localhost:4111/voice/assist` with `Authorization: Bearer dev`.
- **Full app:** `npm run dev`, signed in as staff. This needs the `convex/voice.ts` functions deployed to the Convex deployment the app uses. Then:
  1. Dictate into a property name inside the New property dialog, a task description, and the sourcing notes.
  2. Say "Create a new property called Sunset Villas, a three-bedroom house in Harare, priced at 150,000 dollars, with a garden and garage." `/properties?new=1` opens with name, city, features and notes filled, nothing is saved, and the assistant asks for the client and address.
  3. Say "Change the price to 140,000". Only the price line in Notes changes.
  4. Block the microphone in site settings. A message explains how to allow it.
  5. Record silence. You see "Didn't catch that, try again."
