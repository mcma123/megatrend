import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const defaultCliPath =
  "C:\\Users\\HP22\\AppData\\Local\\Programs\\PrintingPress\\bin\\facebook-marketplace-pp-cli.exe";
const defaultPrintingPressBinDir = "C:\\Users\\HP22\\AppData\\Local\\Programs\\PrintingPress\\bin";
const defaultPythonUserScriptsDir = "C:\\Users\\HP22\\AppData\\Roaming\\Python\\Python312\\Scripts";

const cliPath = process.env.PRINTING_PRESS_FACEBOOK_MARKETPLACE_CLI_PATH || defaultCliPath;

function buildCliEnv() {
  const pathEntries = (process.env.PATH || "").split(";");

  for (const extraDir of [defaultPrintingPressBinDir, defaultPythonUserScriptsDir]) {
    if (!pathEntries.includes(extraDir)) {
      pathEntries.push(extraDir);
    }
  }

  return {
    ...process.env,
    PATH: pathEntries.join(";"),
  };
}

const searchVariablesTemplate = {
  __relay_internal__pv__GHLShouldChangeMarketplaceSponsoredDataFieldNamerelayprovider: false,
  count: 24,
  cursor: null,
  params: {
    bqf: {
      callsite: "COMMERCE_MKTPLACE_WWW",
      query: "couch",
    },
    browse_request_params: {
      commerce_enable_local_pickup: true,
      commerce_enable_shipping: true,
      commerce_search_and_rp_available: true,
      commerce_search_and_rp_category_id: [] as string[],
      commerce_search_and_rp_condition: null as string | null,
      commerce_search_and_rp_ctime_days: null as number | null,
      filter_location_latitude: 30.27544,
      filter_location_longitude: -97.68786,
      filter_price_lower_bound: 0,
      filter_price_upper_bound: 214748364700,
      filter_radius_km: 65,
    },
    custom_request_params: {
      browse_context: null,
      contextual_filters: [] as string[],
      referral_code: null,
      referral_ui_component: null,
      saved_search_strid: null,
      search_vertical: "C2C",
      seo_url: null,
      serp_landing_settings: {
        virtual_category_id: "",
      },
      surface: "SEARCH",
      virtual_contextual_filters: [] as string[],
    },
  },
  scale: 2,
};

const listingVariablesTemplate = {
  enableJobEmployerActionBar: true,
  enableJobSeekerActionBar: true,
  feedLocation: "MARKETPLACE_MEGAMALL",
  feedbackSource: 56,
  referralCode: "null",
  referralSurfaceString: "search",
  scale: 2,
  targetId: "",
  useDefaultActor: false,
};

function tryParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function runFacebookMarketplaceCli(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(cliPath, [...args, "--agent"], {
      env: buildCliEnv(),
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024,
    });

    const trimmedStdout = stdout.trim();
    const trimmedStderr = stderr.trim();
    const parsed = trimmedStdout ? tryParseJson(trimmedStdout) : null;

    return parsed ?? {
      ok: true,
      stdout: trimmedStdout,
      stderr: trimmedStderr || null,
    };
  } catch (error: any) {
    const stdout = error?.stdout?.trim?.() ?? "";
    const stderr = error?.stderr?.trim?.() ?? "";
    const parsedStdout = stdout ? tryParseJson(stdout) : null;

    return {
      ok: false,
      cliPath,
      exitCode: typeof error?.code === "number" ? error.code : null,
      error: error?.message || String(error),
      stdout: parsedStdout ?? (stdout || null),
      stderr: stderr || null,
    };
  }
}

function buildMarketplaceSearchVariables(input: {
  query: string;
  count: number;
  minPrice?: number | null;
  maxPrice?: number | null;
  radiusMiles?: number | null;
  condition?: string | null;
  daysListedWithin?: number | null;
  cursor?: string | null;
}) {
  const variables = structuredClone(searchVariablesTemplate);

  variables.count = input.count;
  variables.cursor = input.cursor ?? null;
  variables.params.bqf.query = input.query;
  variables.params.browse_request_params.commerce_search_and_rp_condition = input.condition ?? null;
  variables.params.browse_request_params.commerce_search_and_rp_ctime_days =
    input.daysListedWithin ?? null;

  if (typeof input.minPrice === "number") {
    variables.params.browse_request_params.filter_price_lower_bound = Math.round(input.minPrice * 100);
  }

  if (typeof input.maxPrice === "number") {
    variables.params.browse_request_params.filter_price_upper_bound = Math.round(input.maxPrice * 100);
  }

  if (typeof input.radiusMiles === "number") {
    variables.params.browse_request_params.filter_radius_km = Math.round(input.radiusMiles * 1.60934);
  }

  return variables;
}

function buildListingGetVariables(listingId: string) {
  const variables = structuredClone(listingVariablesTemplate);
  variables.targetId = listingId;
  return variables;
}

export const facebookMarketplaceTools = {
  facebook_marketplace_doctor: createTool({
    id: "facebook_marketplace_doctor",
    description:
      "Check whether the Facebook Marketplace Printing Press CLI is configured correctly, including auth state, config path, and missing prerequisites.",
    inputSchema: z.object({
      failOn: z.enum(["stale", "error"]).optional().describe("Optionally return a failing exit code when this health level is reached."),
    }),
    outputSchema: z.any(),
    execute: async ({ failOn }) => {
      const args = ["doctor"];
      if (failOn) {
        args.push("--fail-on", failOn);
      }

      return runFacebookMarketplaceCli(args);
    },
  }),
  facebook_marketplace_search: createTool({
    id: "facebook_marketplace_search",
    description:
      "Search Facebook Marketplace listings through the Printing Press CLI. Use this for live Marketplace discovery after auth is configured.",
    inputSchema: z.object({
      query: z.string().min(1).describe("The Marketplace search query."),
      count: z.number().int().min(1).max(100).default(24).describe("How many results to request."),
      minPrice: z.number().nonnegative().optional().describe("Minimum price in dollars."),
      maxPrice: z.number().nonnegative().optional().describe("Maximum price in dollars."),
      radiusMiles: z.number().int().positive().optional().describe("Search radius in miles."),
      condition: z.string().optional().describe("Optional Marketplace condition filter value."),
      daysListedWithin: z.number().int().positive().optional().describe("Only show listings newer than this many days."),
      cursor: z.string().optional().describe("Optional pagination cursor."),
    }),
    outputSchema: z.any(),
    execute: async input => {
      const variables = buildMarketplaceSearchVariables(input);

      return runFacebookMarketplaceCli([
        "marketplace-search",
        "--variables",
        JSON.stringify(variables),
      ]);
    },
  }),
  facebook_marketplace_get_listing: createTool({
    id: "facebook_marketplace_get_listing",
    description:
      "Fetch the detail payload for a specific Facebook Marketplace listing by listing id.",
    inputSchema: z.object({
      listingId: z.string().min(1).describe("The Marketplace listing id."),
    }),
    outputSchema: z.any(),
    execute: async ({ listingId }) => {
      const variables = buildListingGetVariables(listingId);

      return runFacebookMarketplaceCli([
        "listing",
        "get",
        "--variables",
        JSON.stringify(variables),
      ]);
    },
  }),
  facebook_marketplace_draft: createTool({
    id: "facebook_marketplace_draft",
    description:
      "Draft Marketplace listing copy from notes and optional photo paths. This does not publish anything to Facebook.",
    inputSchema: z.object({
      notes: z.string().min(1).describe("Seller notes about the item."),
      photoPaths: z.array(z.string()).default([]).describe("Optional local photo paths to include."),
      targetPrice: z.number().nonnegative().optional().describe("Optional target listing price in dollars."),
    }),
    outputSchema: z.any(),
    execute: async ({ notes, photoPaths, targetPrice }) => {
      const args = ["draft", "--notes", notes];

      if (photoPaths.length > 0) {
        args.push("--photos", photoPaths.join(","));
      }

      if (typeof targetPrice === "number") {
        args.push("--target-price", String(targetPrice));
      }

      return runFacebookMarketplaceCli(args);
    },
  }),
  facebook_marketplace_watch_add: createTool({
    id: "facebook_marketplace_watch_add",
    description:
      "Create a local Facebook Marketplace watch in the Printing Press CLI so future matches can be monitored automatically.",
    requireApproval: true,
    inputSchema: z.object({
      name: z.string().min(1).describe("Short name for the saved watch."),
      query: z.string().min(1).describe("Marketplace search query to monitor."),
      minPrice: z.number().nonnegative().optional().describe("Minimum price in dollars."),
      maxPrice: z.number().nonnegative().optional().describe("Maximum price in dollars."),
      radiusMiles: z.number().int().positive().optional().describe("Maximum search radius in miles."),
      mustHaveKeywords: z.array(z.string()).default([]).describe("Keywords that must appear in the title."),
      rejectKeywords: z.array(z.string()).default([]).describe("Keywords that should exclude a listing."),
    }),
    outputSchema: z.any(),
    execute: async ({
      name,
      query,
      minPrice,
      maxPrice,
      radiusMiles,
      mustHaveKeywords,
      rejectKeywords,
    }) => {
      const args = ["watch", "add", "--name", name, "--query", query];

      if (typeof minPrice === "number") {
        args.push("--min-price", String(minPrice));
      }

      if (typeof maxPrice === "number") {
        args.push("--max-price", String(maxPrice));
      }

      if (typeof radiusMiles === "number") {
        args.push("--radius", String(radiusMiles));
      }

      if (mustHaveKeywords.length > 0) {
        args.push("--must-have-keywords", mustHaveKeywords.join(","));
      }

      if (rejectKeywords.length > 0) {
        args.push("--reject-keywords", rejectKeywords.join(","));
      }

      return runFacebookMarketplaceCli(args);
    },
  }),
  facebook_marketplace_matches: createTool({
    id: "facebook_marketplace_matches",
    description:
      "Read locally stored Marketplace watch matches from the Printing Press CLI.",
    inputSchema: z.object({
      onlyNew: z.boolean().default(true).describe("Whether to only show new matches."),
    }),
    outputSchema: z.any(),
    execute: async ({ onlyNew }) => {
      const args = ["matches"];
      if (onlyNew) {
        args.push("--new");
      }

      return runFacebookMarketplaceCli(args);
    },
  }),
};
