import * as wmill from "windmill-client";

const BASE_URL_VAR_PATH = "f/firecrawl/FIRECRAWL_BASE_URL";
const API_KEY_VAR_PATH = "f/firecrawl/FIRECRAWL_API_KEY";
const DEFAULT_BASE_URL =
  "http://automation-firecrawl-5a435e-84-8-132-135.sslip.io/";

async function getVariableOrFallback(path: string, fallback: string): Promise<string> {
  try {
    const value = await wmill.getVariable(path);
    return typeof value === "string" && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

export async function main(
  url: string,
  formats: string[] = ["markdown"],
  onlyMainContent: boolean = true
) {
  const firecrawlBaseUrl = await getVariableOrFallback(
    BASE_URL_VAR_PATH,
    DEFAULT_BASE_URL
  );
  const firecrawlApiKey = await getVariableOrFallback(API_KEY_VAR_PATH, "");
  const endpoint = `${firecrawlBaseUrl.replace(/\/$/, "")}/v1/scrape`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (firecrawlApiKey.trim().length > 0) {
    headers.Authorization = `Bearer ${firecrawlApiKey}`;
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url,
        formats,
        onlyMainContent,
      }),
    });

    const text = await response.text();

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      data = { rawText: text };
    }

    if (!response.ok) {
      return {
        success: false,
        url,
        error: "Firecrawl returned a non-success status code",
        statusCode: response.status,
        rawResponse: data,
      };
    }

    const payload = data?.data ?? data ?? {};
    const metadata = payload?.metadata ?? data?.metadata ?? null;
    const title = metadata?.title ?? payload?.title ?? null;
    const description = metadata?.description ?? payload?.description ?? null;
    const markdown = payload?.markdown ?? data?.markdown ?? null;
    const links = payload?.links ?? data?.links ?? null;

    return {
      success: true,
      url,
      title,
      description,
      markdown,
      metadata,
      links,
      error: null,
    };
  } catch (error: any) {
    return {
      success: false,
      url,
      title: null,
      description: null,
      markdown: null,
      metadata: null,
      links: null,
      error: error?.message || String(error),
    };
  }
}
