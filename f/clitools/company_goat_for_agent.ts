import * as wmill from "windmill-client";

type Operation =
  | "resolve"
  | "funding"
  | "funding_trend"
  | "engineering"
  | "legal"
  | "domain"
  | "yc"
  | "wiki"
  | "mentions"
  | "launches"
  | "snapshot"
  | "signal"
  | "search"
  | "compare"
  | "filings_list"
  | "doctor"
  | "custom";

type DataSource = "auto" | "live" | "local";
type LegalRegion = "auto" | "us" | "uk";

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

function pushFlag(args: string[], name: string, value?: string | number | null) {
  if (value === undefined || value === null || value === "") {
    return;
  }

  args.push(name, String(value));
}

function buildTargetArgs(company?: string, domain?: string, pick?: number): string[] {
  const args: string[] = [];

  if (company && company.trim().length > 0) {
    args.push(company.trim());
  }

  if (domain && domain.trim().length > 0) {
    args.push("--domain", domain.trim());
  }

  if (typeof pick === "number" && Number.isFinite(pick) && pick > 0) {
    args.push("--pick", String(Math.trunc(pick)));
  }

  return args;
}

function addSharedFlags(
  args: string[],
  options: {
    select?: string | null;
    dataSource: DataSource;
    dryRun: boolean;
    compact: boolean;
    timeoutSeconds: number;
  },
): string[] {
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

function buildCommandArgs(input: {
  operation: Operation;
  company?: string;
  otherCompany?: string;
  domain?: string;
  query?: string;
  person?: string;
  cik?: string;
  region: LegalRegion;
  pick?: number;
  since?: number;
  max?: number;
  skip?: string;
  batch?: string;
  industry?: string;
  rawArgs?: string[];
}): string[] {
  const targetArgs = buildTargetArgs(input.company, input.domain, input.pick);

  switch (input.operation) {
    case "resolve":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for resolve");
      }
      return ["resolve", ...targetArgs];
    case "funding": {
      const args = ["funding"];
      if (input.person?.trim()) {
        args.push("--who", input.person.trim());
      } else {
        args.push(...targetArgs);
      }
      pushFlag(args, "--since", input.since);
      pushFlag(args, "--max", input.max);
      pushFlag(args, "--cik", input.cik?.trim());
      return args;
    }
    case "funding_trend": {
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for funding_trend");
      }
      const args = ["funding-trend", ...targetArgs];
      pushFlag(args, "--since", input.since);
      return args;
    }
    case "engineering":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for engineering");
      }
      return ["engineering", ...targetArgs];
    case "legal": {
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for legal");
      }
      const args = ["legal", ...targetArgs];
      if (input.region !== "auto") {
        args.push("--region", input.region);
      }
      return args;
    }
    case "domain":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for domain");
      }
      return ["domain", ...targetArgs];
    case "yc":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for yc");
      }
      return ["yc", ...targetArgs];
    case "wiki":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for wiki");
      }
      return ["wiki", ...targetArgs];
    case "mentions":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for mentions");
      }
      return ["mentions", ...targetArgs];
    case "launches":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for launches");
      }
      return ["launches", ...targetArgs];
    case "snapshot": {
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for snapshot");
      }
      const args = ["snapshot", ...targetArgs];
      pushFlag(args, "--skip", input.skip?.trim());
      return args;
    }
    case "signal":
      if (!input.company?.trim() && !input.domain?.trim()) {
        throw new Error("company or domain is required for signal");
      }
      return ["signal", ...targetArgs];
    case "search": {
      if (!input.query?.trim()) {
        throw new Error("query is required for search");
      }
      const args = ["search", input.query.trim()];
      pushFlag(args, "--batch", input.batch?.trim());
      pushFlag(args, "--industry", input.industry?.trim());
      pushFlag(args, "--max", input.max);
      return args;
    }
    case "compare":
      if (!input.company?.trim() || !input.otherCompany?.trim()) {
        throw new Error("company and otherCompany are required for compare");
      }
      return ["compare", input.company.trim(), input.otherCompany.trim()];
    case "filings_list":
      if (!input.cik?.trim()) {
        throw new Error("cik is required for filings_list");
      }
      return ["filings", "list", input.cik.trim()];
    case "doctor":
      return ["doctor"];
    case "custom":
      if (!input.rawArgs || input.rawArgs.length === 0) {
        throw new Error("rawArgs is required when operation is custom");
      }
      return [...input.rawArgs];
  }
}

async function runCompanyGoatCli(baseUrl: string, args: string[]): Promise<CliRunResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tool: "company-goat",
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
  operation: Operation = "snapshot",
  company?: string,
  domain?: string,
  otherCompany?: string,
  query?: string,
  person?: string,
  cik?: string,
  region: LegalRegion = "auto",
  pick?: number,
  since?: number,
  max?: number,
  skip?: string,
  batch?: string,
  industry?: string,
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

  const baseArgs = buildCommandArgs({
    operation,
    company,
    otherCompany,
    domain,
    query,
    person,
    cik,
    region,
    pick,
    since,
    max,
    skip,
    batch,
    industry,
    rawArgs,
  });

  const executedArgs = addSharedFlags(baseArgs, {
    select,
    dataSource,
    dryRun,
    compact,
    timeoutSeconds,
  });

  const result = await runCompanyGoatCli(cliServerBaseUrl, executedArgs);
  const parsedStdout = parseStdout(result.stdout);

  return {
    success: result.ok,
    operation,
    cliServerBaseUrl,
    executedArgs,
    result: parsedStdout,
    stderr: result.stderr ?? null,
    error: result.error ?? null,
  };
}

