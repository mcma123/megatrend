import * as wmill from "windmill-client";

const BASE_URL_VAR_PATH = "f/firecrawl/FIRECRAWL_BASE_URL";
const API_KEY_VAR_PATH = "f/firecrawl/FIRECRAWL_API_KEY";
const DEFAULT_BASE_URL =
  "http://automation-firecrawl-5a435e-84-8-132-135.sslip.io/";
const SEARCH_LIMIT = 50;

type FirecrawlSearchResult = {
  url: string;
  title?: string | null;
  description?: string | null;
};

type ParsedResponse = {
  statusCode: number;
  data: any;
};

async function getVariableOrFallback(path: string, fallback: string): Promise<string> {
  try {
    const value = await wmill.getVariable(path);
    return typeof value === "string" && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

async function postJson(
  endpoint: string,
  headers: Record<string, string>,
  body: Record<string, any>
): Promise<ParsedResponse> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await response.text();

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = { rawText: text };
  }

  return {
    statusCode: response.status,
    data,
  };
}

function normalizeResults(data: any): FirecrawlSearchResult[] {
  const webResults = Array.isArray(data?.data?.web)
    ? data.data.web
    : Array.isArray(data?.web)
      ? data.web
      : Array.isArray(data?.data)
        ? data.data
        : [];

  return webResults.slice(0, SEARCH_LIMIT).map((item: any) => ({
    url: item?.url ?? "",
    title: item?.title ?? null,
    description: item?.description ?? item?.snippet ?? null,
  }));
}

export async function main(query: string) {
  const firecrawlBaseUrl = await getVariableOrFallback(
    BASE_URL_VAR_PATH,
    DEFAULT_BASE_URL
  );
  const firecrawlApiKey = await getVariableOrFallback(API_KEY_VAR_PATH, "");
  const normalizedBaseUrl = firecrawlBaseUrl.replace(/\/$/, "");
  const v2Endpoint = `${normalizedBaseUrl}/v2/search`;
  const v1Endpoint = `${normalizedBaseUrl}/v1/search`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (firecrawlApiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${firecrawlApiKey}`;
  }

  try {
    const v2Response = await postJson(v2Endpoint, headers, {
      query,
      limit: SEARCH_LIMIT,
      sources: ["web"],
    });

    let statusCode = v2Response.statusCode;
    let data = v2Response.data;

    if (statusCode === 404 || statusCode === 405) {
      const v1Response = await postJson(v1Endpoint, headers, {
        query,
        limit: SEARCH_LIMIT,
      });
      statusCode = v1Response.statusCode;
      data = v1Response.data;
    }

    if (statusCode < 200 || statusCode >= 300) {
      return {
        success: false,
        query,
        firecrawlBaseUrl,
        statusCode,
        resultCount: 0,
        results: [],
        error: "Firecrawl returned a non-success status code",
        rawResponse: data,
      };
    }

    const results = normalizeResults(data);

    return {
      success: true,
      query,
      firecrawlBaseUrl,
      statusCode,
      requestedLimit: SEARCH_LIMIT,
      resultCount: results.length,
      results,
      error: null,
      warning: data?.warning ?? null,
    };
  } catch (error: any) {
    return {
      success: false,
      query,
      firecrawlBaseUrl,
      statusCode: null,
      requestedLimit: SEARCH_LIMIT,
      resultCount: 0,
      results: [],
      error: error?.message || String(error),
    };
  }
}
