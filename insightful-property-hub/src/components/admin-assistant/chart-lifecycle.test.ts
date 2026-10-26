// @vitest-environment node
import { describe, expect, it } from "vitest";
import { CopilotKitCore } from "@copilotkit/core";
import { AbstractAgent, EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/client";
import { of, type Observable } from "rxjs";
import { chartSchema, chartToolFeedback, chartFailures } from "./assistant-chart-data";

type Mode = "nullable" | "repair" | "unavailable";
class ChartAgent extends AbstractAgent {
  calls = 0;
  constructor(private mode: Mode) {
    super({
      agentId: "chart-test",
      initialMessages: [
        {
          id: "u",
          role: "user",
          content:
            "Use the supplied synthetic fact: January warehouse rent 100 ZAR, source https://example.com/jan. Create the requested charts.",
        },
      ],
    });
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    this.calls++;
    const events: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId },
    ];
    const shouldCall = this.calls === 1 || (this.mode !== "nullable" && this.calls === 2);
    if (shouldCall) {
      for (const type of this.mode === "nullable" ? ["pie", "line", "donut"] : ["pie"]) {
        const args = {
          title: "Warehouse rent",
          type,
          unit: "ZAR",
          xLabel: null,
          points: [
            {
              label: "January",
              value:
                this.mode === "nullable" || (this.mode === "repair" && this.calls === 2)
                  ? 100
                  : null,
              source: "https://example.com/jan",
              group: null,
              x: null,
            },
          ],
        };
        const id = `${type}-${this.calls}`;
        events.push(
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: id,
            toolCallName: "show_chart",
            parentMessageId: `assistant-${this.calls}`,
          },
          { type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: JSON.stringify(args) },
          { type: EventType.TOOL_CALL_END, toolCallId: id },
        );
      }
    }
    events.push({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId });
    return of(...events);
  }
}
async function run(mode: Mode) {
  const agent = new ChartAgent(mode);
  const core = new CopilotKitCore({
    agents__unsafe_dev_only: { "chart-test": agent },
    tools: [
      {
        name: "show_chart",
        agentId: "chart-test",
        parameters: chartSchema,
        followUp: true,
        handler: async (args, context) => chartToolFeedback(args, context.agent?.messages ?? []),
      },
    ],
  });
  await core.runAgent({ agent });
  return {
    agent,
    results: agent.messages.flatMap((message) =>
      message.role === "tool" ? [JSON.parse(message.content as string)] : [],
    ),
  };
}
describe("chart tool validation and automatic correction", () => {
  it("passes all three Mastra-style nullable charts through the real CopilotKit tool loop", async () => {
    const { agent, results } = await run("nullable");
    expect(results.map((result) => result.status)).toEqual(["rendered", "rendered", "rendered"]);
    expect(agent.calls).toBe(2);
    expect(chartFailures(agent.messages)).toEqual([]);
  });
  it("returns field validation errors to the agent and clears the failure after a valid repair", async () => {
    const { agent, results } = await run("repair");
    expect(results[0]).toMatchObject({ status: "invalid_chart", retryAllowed: true });
    expect(results[0].issues).toContainEqual(
      expect.objectContaining({ field: "points.0.value", expected: "number" }),
    );
    expect(results[1]).toMatchObject({ status: "rendered" });
    expect(agent.calls).toBe(3);
    expect(chartFailures(agent.messages)).toEqual([]);
  });
  it("limits failed repair and leaves one actionable notice without fabricating missing values", async () => {
    const { agent, results } = await run("unavailable");
    expect(results[1]).toMatchObject({ status: "unavailable", retryAllowed: false });
    expect(agent.calls).toBe(3);
    expect(chartFailures(agent.messages)).toEqual([
      "Some chart values are missing or are not numeric.",
    ]);
  });
});
