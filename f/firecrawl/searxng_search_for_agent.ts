import * as wmill from "windmill-client";

const SEARXNG_BASE_URL_VAR_PATH = "f/firecrawl/SEARXNG_BASE_URL";
const DEFAULT_SEARXNG_BASE_URL =
  "http://automation-searxng-242e78-84-8-132-135.sslip.io/";

type SearxngResult = {
  url: string;
  title?: string | null;
  description?: string | null;
};

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7",
  "Accept-Language": "en-US,en;q=0.9",
};

async function getVariableOrFallback(path: string, fallback: string): Promise<string> {
  try {
    const value = await wmill.getVariable(path);
    return typeof value === "string" && value.length > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
}

function extractHtmlResults(html: string): SearxngResult[] {
  const results: SearxngResult[] = [];
  const articleMatches = html.match(/<article[\s\S]*?class="[^"]*result[^"]*"[\s\S]*?<\/article>/gi) ?? [];

  for (const article of articleMatches) {
    const urlMatch = article.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!urlMatch) {
      continue;
    }

    const descriptionMatch =
      article.match(/<p[^>]*class="[^"]*(?:content|description)[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ??
      article.match(/<div[^>]*class="[^"]*(?:content|description)[^"]*"[^>]*>([\s\S]*?)<\/div>/i);

    const url = decodeHtml(urlMatch[1]);
    if (!url) {
      continue;
    }

    results.push({
      url,
      title: stripTags(urlMatch[2]) || null,
      description: descriptionMatch ? stripTags(descriptionMatch[1]) : null,
    });
  }

  return results;
}

export async function main(
  query: string,
  limit: number = 50,
  categories: string = "general",
  maxPages: number = 5
) {
  const searxngBaseUrl = await getVariableOrFallback(
    SEARXNG_BASE_URL_VAR_PATH,
    DEFAULT_SEARXNG_BASE_URL
  );
  const normalizedBaseUrl = searxngBaseUrl.replace(/\/$/, "");
  const safeLimit = Math.max(1, Math.min(limit, 100));
  const safeMaxPages = Math.max(1, Math.min(maxPages, 10));
  const uniqueResults = new Map<string, SearxngResult>();
  const pages: Array<{ page: number; count: number }> = [];

  try {
    for (let page = 1; page <= safeMaxPages; page += 1) {
      const jsonParams = new URLSearchParams({
        q: query,
        format: "json",
        pageno: String(page),
        categories,
      });

      let pageResults: any[] = [];
      let statusCode: number | null = null;
      let mode: "json" | "html" = "json";
      let rawResponse: any = null;

      const jsonResponse = await fetch(`${normalizedBaseUrl}/search?${jsonParams.toString()}`, {
        headers: DEFAULT_HEADERS,
      });
      statusCode = jsonResponse.status;
      const jsonText = await jsonResponse.text();

      if (jsonResponse.ok) {
        try {
          const data = JSON.parse(jsonText);
          pageResults = Array.isArray(data?.results) ? data.results : [];
          rawResponse = data;
        } catch {
          rawResponse = { rawText: jsonText };
        }
      }

      if (!jsonResponse.ok || pageResults.length === 0) {
        const htmlParams = new URLSearchParams({
          q: query,
          pageno: String(page),
          categories,
        });
        const htmlResponse = await fetch(`${normalizedBaseUrl}/search?${htmlParams.toString()}`, {
          headers: DEFAULT_HEADERS,
        });
        statusCode = htmlResponse.status;
        const htmlText = await htmlResponse.text();

        if (!htmlResponse.ok) {
          return {
            success: false,
            query,
            searxngBaseUrl,
            statusCode,
            requestedLimit: safeLimit,
            resultCount: uniqueResults.size,
            results: Array.from(uniqueResults.values()),
            pages,
            error: "SearXNG returned a non-success status code",
            rawResponse: { rawText: htmlText },
          };
        }

        pageResults = extractHtmlResults(htmlText);
        mode = "html";
        rawResponse = { rawText: htmlText };
      }

      pages.push({ page, count: pageResults.length });

      for (const item of pageResults) {
        const url = item?.url ?? "";
        if (!url || uniqueResults.has(url)) {
          continue;
        }

        uniqueResults.set(url, {
          url,
          title: item?.title ?? null,
          description: item?.content ?? item?.description ?? null,
        });

        if (uniqueResults.size >= safeLimit) {
          break;
        }
      }

      if (uniqueResults.size >= safeLimit || pageResults.length === 0) {
        break;
      }
    }

    return {
      success: true,
      query,
      searxngBaseUrl,
      requestedLimit: safeLimit,
      resultCount: uniqueResults.size,
      results: Array.from(uniqueResults.values()).slice(0, safeLimit),
      pages,
      error: null,
    };
  } catch (error: any) {
    return {
      success: false,
      query,
      searxngBaseUrl,
      requestedLimit: safeLimit,
      resultCount: uniqueResults.size,
      results: Array.from(uniqueResults.values()),
      pages,
      error: error?.message || String(error),
    };
  }
}
