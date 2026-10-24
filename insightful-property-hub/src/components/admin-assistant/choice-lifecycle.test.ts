// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { of, type Observable } from "rxjs";
import { choiceSchema } from "./advanced-interaction-data";
import { isIntentionalChoiceAbort } from "./interaction-data";

const choices = {
  title: "Pick a document",
  question: "Which document?",
  options: [
    { id: "lease-a", label: "Lease A" },
    { id: "lease-b", label: "Lease B" },
  ],
};
class ChoiceAgent extends AbstractAgent {
  calls = 0;
  constructor() {
    super({
      agentId: "synthetic",
      initialMessages: [{ id: "user", role: "user", content: "Show me a choice" }],
    });
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.calls++;
    const start = { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId };
    const finish = { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId };
    return this.calls === 1
      ? of(
          start,
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: "choice-1",
            toolCallName: "ask_choice",
            parentMessageId: "assistant",
          },
          {
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: "choice-1",
            delta: JSON.stringify(choices),
          },
          { type: EventType.TOOL_CALL_END, toolCallId: "choice-1" },
          finish,
        )
      : of(start, finish);
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup() {
  const agent = new ChoiceAgent();
  const entered = deferred<void>();
  const answer = deferred<unknown>();
  let aborted = false;
  const core = new CopilotKitCore({
    agents__unsafe_dev_only: { synthetic: agent },
    tools: [
      {
        name: "ask_choice",
        agentId: "synthetic",
        type: "human-in-the-loop",
        parameters: choiceSchema,
        followUp: true,
        handler: async (_args, { signal }) => {
          entered.resolve();
          return new Promise((resolve, reject) => {
            const onAbort = () => {
              aborted = true;
              reject(new Error("Human-in-the-loop interaction aborted"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });
            void answer.promise.then((value) => {
              signal?.removeEventListener("abort", onAbort);
              resolve(value);
            });
          });
        },
      },
    ],
  });
  return { agent, core, entered, answer, wasAborted: () => aborted };
}
describe("CopilotKit choice continuation lifecycle", () => {
  it("keeps the logical run pending after the backend stream finishes, then resumes the selected choice", async () => {
    const { core, agent, entered, answer } = setup();
    let finished = false;
    const run = core.runAgent({ agent }).then(() => {
      finished = true;
    });
    await entered.promise;
    expect(agent.isRunning).toBe(false);
    expect(finished).toBe(false);
    expect(agent.calls).toBe(1);
    answer.resolve({ choiceId: "lease-b" });
    await run;
    expect(agent.calls).toBe(2);
    expect(agent.messages.find((message) => message.role === "tool")?.content).toContain("lease-b");
  });
  it("aborts a pending human choice through Stop without starting a follow-up run", async () => {
    const { core, agent, entered, answer, wasAborted } = setup();
    const unexpectedErrors: string[] = [];
    core.subscribe({
      onError: (event) => {
        if (!isIntentionalChoiceAbort(event)) unexpectedErrors.push(event.error.message);
      },
    });
    const run = core.runAgent({ agent });
    await entered.promise;
    await core.stopAgent({ agent });
    await run;
    expect(wasAborted()).toBe(true);
    answer.resolve({ choiceId: "lease-a" });
    await Promise.resolve();
    expect(agent.calls).toBe(1);
    expect(agent.messages.find((message) => message.role === "tool")?.content).toContain(
      "interaction aborted",
    );
    expect(unexpectedErrors).toEqual([]);
  });
});
