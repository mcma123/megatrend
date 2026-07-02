import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type {
  FacebookMarketplaceGateway,
  MarketplaceDoctorInput,
  MarketplaceDraftInput,
  MarketplaceGetListingInput,
  MarketplaceMatchesInput,
  MarketplaceSearchInput,
  MarketplaceWatchAddInput,
} from "../../ports/facebook-marketplace-gateway";

const execFileAsync = promisify(execFile);

const defaultCliPath =
  "C:\\Users\\HP22\\AppData\\Local\\Programs\\PrintingPress\\bin\\facebook-marketplace-pp-cli.exe";
const defaultPrintingPressBinDir = "C:\\Users\\HP22\\AppData\\Local\\Programs\\PrintingPress\\bin";
const defaultPythonUserScriptsDir = "C:\\Users\\HP22\\AppData\\Roaming\\Python\\Python312\\Scripts";

const cliPath = process.env.PRINTING_PRESS_FACEBOOK_MARKETPLACE_CLI_PATH || defaultCliPath;

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

function buildMarketplaceSearchVariables(input: MarketplaceSearchInput) {
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

class PrintingPressFacebookMarketplaceGateway implements FacebookMarketplaceGateway {
  doctor(input: MarketplaceDoctorInput) {
    const args = ["doctor"];
    if (input.failOn) {
      args.push("--fail-on", input.failOn);
    }

    return runFacebookMarketplaceCli(args);
  }

  search(input: MarketplaceSearchInput) {
    const variables = buildMarketplaceSearchVariables(input);

    return runFacebookMarketplaceCli(["marketplace-search", "--variables", JSON.stringify(variables)]);
  }

  getListing(input: MarketplaceGetListingInput) {
    const variables = buildListingGetVariables(input.listingId);

    return runFacebookMarketplaceCli(["listing", "get", "--variables", JSON.stringify(variables)]);
  }

  draft(input: MarketplaceDraftInput) {
    const args = ["draft", "--notes", input.notes];

    if (input.photoPaths.length > 0) {
      args.push("--photos", input.photoPaths.join(","));
    }

    if (typeof input.targetPrice === "number") {
      args.push("--target-price", String(input.targetPrice));
    }

    return runFacebookMarketplaceCli(args);
  }

  addWatch(input: MarketplaceWatchAddInput) {
    const args = ["watch", "add", "--name", input.name, "--query", input.query];

    if (typeof input.minPrice === "number") {
      args.push("--min-price", String(input.minPrice));
    }

    if (typeof input.maxPrice === "number") {
      args.push("--max-price", String(input.maxPrice));
    }

    if (typeof input.radiusMiles === "number") {
      args.push("--radius", String(input.radiusMiles));
    }

    if (input.mustHaveKeywords.length > 0) {
      args.push("--must-have-keywords", input.mustHaveKeywords.join(","));
    }

    if (input.rejectKeywords.length > 0) {
      args.push("--reject-keywords", input.rejectKeywords.join(","));
    }

    return runFacebookMarketplaceCli(args);
  }

  getMatches(input: MarketplaceMatchesInput) {
    const args = ["matches"];
    if (input.onlyNew) {
      args.push("--new");
    }

    return runFacebookMarketplaceCli(args);
  }
}

export const printingPressFacebookMarketplaceGateway = new PrintingPressFacebookMarketplaceGateway();
