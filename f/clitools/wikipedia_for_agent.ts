import * as wmill from "windmill-client";

type Operation =
  | "page_get_random"
  | "page_get_summary"
  | "page_get_html"
  | "page_get_media"
  | "feed_get_on_this_day"
  | "custom";

type FeedType = "events" | "births" | "deaths" | "holidays";
type DataSource = "auto" | "live" | "local";

type CliRunResponse = {
  ok: boolean;
  tool?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

const CLI_SERVER_BASE_URL_VAR_PATH = "f/clitools/CLI_SERVER_BASE_URL";
const DEFAULT_CLI_SERVER_BASE_URL =
  "http://automation-cli-server-zr3888-ec4a46-84-8-132-135.sslip.io";

async function getVariableOrFallback(path: string, fallback: string): Promise<string> {
  try {
    const value = await wmill.getVariable(path);
    return typeof value === "string" && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function hasOutputFlag(args: string[]): boolean {
  return args.some(arg => ["--agent", "--json", "--csv", "--plain", "--quiet"].includes(arg));
}

function addSharedFlags(args: string[], options: {
  select?: string | null;
  dataSource: DataSource;
  dryRun: boolean;
  compact: boolean;
  timeoutSeconds: number;
}): string[] {
  const next = [...args];

  if (!hasOutputFlag(next)) {
    next.push("--agent");
  }

  if (options.compact) {
    next.push("--compact");
  }

  if (options.select && options.select.trim().length > 0) {
    next.push("--select", options.select.trim());
  }

  if (options.dataSource !== "auto") {
    next.push("--data-source", options.dataSource);
  }

  if (options.dryRun) {
    next.push("--dry-run");
  }

  if (options.timeoutSeconds > 0) {
    next.push("--timeout", `${options.timeoutSeconds}s`);
  }

  return next;
}

function buildPrimaryArgs(operation: Operation, input: {
  title?: string | null;
  month?: number | null;
  day?: number | null;
  feedType: FeedType;
  rawArgs?: string[] | null;
}): string[] {
  switch (operation) {
    case "page_get_random":
      return ["page", "get-random"];
    case "page_get_summary":
      if (!input.title?.trim()) {
        throw new Error("title is required for page_get_summary");
      }
      return ["page", "get-summary", input.title.trim()];
    case "page_get_html":
      if (!input.title?.trim()) {
        throw new Error("title is required for page_get_html");
      }
      return ["page", "get-html", input.title.trim()];
    case "page_get_media":
      if (!input.title?.trim()) {
        throw new Error("title is required for page_get_media");
      }
      return ["page", "get-media", input.title.trim()];
    case "feed_get_on_this_day":
      if (!input.month || input.month < 1 || input.month > 12) {
        throw new Error("month must be between 1 and 12 for feed_get_on_this_day");
      }
      if (!input.day || input.day < 1 || input.day > 31) {
        throw new Error("day must be between 1 and 31 for feed_get_on_this_day");
      }
      return ["feed", String(input.day), "--month", String(input.month), "--type", input.feedType];
    case "custom":
      if (!input.rawArgs || input.rawArgs.length === 0) {
        throw new Error("rawArgs is required when operation is custom");
      }
      return [...input.rawArgs];
  }
}

function buildFallbackArgs(operation: Operation, input: {
  month?: number | null;
  day?: number | null;
  feedType: FeedType;
}): string[][] {
  if (operation !== "feed_get_on_this_day" || !input.month || !input.day) {
    return [];
  }

  return [
    ["feed", "get-on-this-day", "--month", String(input.month), "--type", input.feedType, String(input.day)],
    ["feed", "get-on-this-day", String(input.day), "--month", String(input.month), "--type", input.feedType],
    ["feed", "get-on-this-day", "--month", String(input.month), String(input.day), "--type", input.feedType],
  ];
}

async function runWikipediaCli(baseUrl: string, args: string[]): Promise<CliRunResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: "wikipedia",
      args,
    }),
  });

  const text = await response.text();

  let parsed: CliRunResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = {
      ok: response.ok,
      stdout: text,
    };
  }

  return parsed;
}

function parseStdout(stdout?: string | null): any {
  if (!stdout) {
    return null;
  }

  try {
    return JSON.parse(stdout);
  } catch {
    return stdout;
  }
}

export async function main(
  operation: Operation = "page_get_summary",
  title?: string,
  month?: number,
  day?: number,
  feedType: FeedType = "events",
  rawArgs?: string[],
  select?: string,
  dataSource: DataSource = "auto",
  dryRun = false,
  compact = false,
  timeoutSeconds = 30,
) {
  const cliServerBaseUrl = await getVariableOrFallback(
    CLI_SERVER_BASE_URL_VAR_PATH,
    DEFAULT_CLI_SERVER_BASE_URL,
  );

  const baseArgs = buildPrimaryArgs(operation, {
    title,
    month,
    day,
    feedType,
    rawArgs,
  });

  const candidateArgs = [
    baseArgs,
    ...buildFallbackArgs(operation, { month, day, feedType }),
  ].map(args =>
    addSharedFlags(args, {
      select,
      dataSource,
      dryRun,
      compact,
      timeoutSeconds,
    }),
  );

  const attempts: Array<{
    args: string[];
    ok: boolean;
    stdout: any;
    stderr: string | null;
    error: string | null;
  }> = [];

  for (const args of candidateArgs) {
    const result = await runWikipediaCli(cliServerBaseUrl, args);
    const parsedStdout = parseStdout(result.stdout);
    const attempt = {
      args,
      ok: result.ok,
      stdout: parsedStdout,
      stderr: result.stderr ?? null,
      error: result.error ?? null,
    };

    attempts.push(attempt);

    if (result.ok) {
      return {
        success: true,
        operation,
        cliServerBaseUrl,
        executedArgs: args,
        result: parsedStdout,
        stderr: result.stderr ?? null,
        attempts,
      };
    }
  }

  return {
    success: false,
    operation,
    cliServerBaseUrl,
    executedArgs: candidateArgs[0] ?? [],
    result: null,
    attempts,
    error: attempts[attempts.length - 1]?.error ?? "Wikipedia CLI call failed",
  };
}

