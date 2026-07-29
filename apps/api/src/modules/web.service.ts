import { BadRequestException, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { WebReadUrlInput, WebSearchInput } from "@sp-agent/shared";

const FETCH_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const USER_AGENT = "SP-Agent/0.1 local-first web reader";

type FetchedText = {
  url: string;
  contentType: string;
  content: string;
  truncated: boolean;
};

@Injectable()
export class WebService {
  async read(input: WebReadUrlInput) {
    try {
      const fetched = await fetchPublicText(input.url, input.maxBytes);
      if (!isReadableContentType(fetched.contentType)) {
        return { degradedReason: `Unsupported content type: ${fetched.contentType || "unknown"}.` };
      }
      const content = isHtmlContentType(fetched.contentType) ? htmlToMarkdown(fetched.content) : fetched.content.trim();
      const retrievedAt = new Date().toISOString();
      return {
        source: {
          url: input.url,
          finalUrl: fetched.url,
          title: htmlTitle(fetched.content),
          contentType: fetched.contentType,
          retrievedAt,
          contentHash: sha256(content),
          truncated: fetched.truncated
        },
        content,
        degradedReason: content ? undefined : "The page returned no readable text."
      };
    } catch (error) {
      return { degradedReason: error instanceof Error ? `Web read failed: ${error.message}` : "Web read failed." };
    }
  }

  async search(input: WebSearchInput) {
    try {
      const preferred = process.env.SP_AGENT_WEB_SEARCH_PROVIDER ?? "bing_rss";
      const primary = preferred === "duckduckgo_html"
        ? await searchDuckDuckGo(input.query, input.maxResults)
        : await searchBingRss(input.query, input.maxResults);
      return {
        query: input.query,
        provider: primary.provider,
        retrievedAt: new Date().toISOString(),
        results: primary.results,
        degradedReason: primary.results.length === 0 ? "The search provider returned no parseable results." : undefined
      };
    } catch (error) {
      try {
        const fallback = await searchDuckDuckGo(input.query, input.maxResults);
        return {
          query: input.query,
          provider: fallback.provider,
          retrievedAt: new Date().toISOString(),
          results: fallback.results,
          degradedReason: fallback.results.length === 0 ? "The search provider returned no parseable results." : undefined
        };
      } catch {
        // Preserve the primary failure because it is usually the actionable provider/network diagnosis.
      }
      return {
        query: input.query,
        provider: process.env.SP_AGENT_WEB_SEARCH_PROVIDER ?? "bing_rss",
        retrievedAt: new Date().toISOString(),
        results: [],
        degradedReason: error instanceof Error ? `Web search failed: ${error.message}` : "Web search failed."
      };
    }
  }
}

async function searchBingRss(query: string, maxResults: number) {
  const url = new URL("https://www.bing.com/search");
  url.searchParams.set("format", "rss");
  url.searchParams.set("q", query);
  const fetched = await fetchPublicText(url.toString(), 800_000);
  return { provider: "bing_rss", results: parseBingRssResults(fetched.content).slice(0, maxResults) };
}

async function searchDuckDuckGo(query: string, maxResults: number) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const fetched = await fetchPublicText(url.toString(), 800_000);
  return { provider: "duckduckgo_html", results: parseDuckDuckGoResults(fetched.content).slice(0, maxResults) };
}

async function fetchPublicText(rawUrl: string, maxBytes: number): Promise<FetchedText> {
  let url = await assertPublicUrl(rawUrl);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.1" }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new Error(`Redirect ${response.status} did not include a location.`);
        url = await assertPublicUrl(new URL(location, url).toString());
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
      const body = await readBoundedBody(response, maxBytes);
      return {
        url,
        contentType: response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "",
        content: new TextDecoder().decode(body.bytes),
        truncated: body.truncated
      };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Too many redirects (maximum ${MAX_REDIRECTS}).`);
}

async function assertPublicUrl(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException("Web URL is invalid.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new BadRequestException("Web URL must use http or https.");
  if (url.username || url.password) throw new BadRequestException("Web URL must not include credentials.");
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local")) throw new BadRequestException("Local network targets are not allowed.");
  const literalKind = isIP(hostname);
  if (literalKind && isPrivateAddress(hostname, literalKind)) throw new BadRequestException("Private network targets are not allowed.");
  if (!literalKind) {
    const addresses = await lookup(hostname, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address.address, address.family))) {
      throw new BadRequestException("Web host does not resolve to a public address.");
    }
  }
  return url.toString();
}

function isPrivateAddress(address: string, family: number) {
  if (family === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19));
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80") || normalized.startsWith("::ffff:127.");
}

async function readBoundedBody(response: Response, maxBytes: number) {
  if (!response.body) return { bytes: new Uint8Array(), truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = maxBytes - size;
      if (next.value.byteLength > remaining) {
        chunks.push(next.value.subarray(0, Math.max(0, remaining)));
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(next.value);
      size += next.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { bytes, truncated };
}

function isReadableContentType(contentType: string) {
  return !contentType || /^(text\/|application\/(json|xml|javascript))/u.test(contentType);
}

function isHtmlContentType(contentType: string) { return /html|xhtml/u.test(contentType); }

function htmlToMarkdown(html: string) {
  const withoutUnsafeBlocks = html.replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/giu, " ");
  const structured = withoutUnsafeBlocks
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/giu, (_match, level: string, text: string) => `\n\n${"#".repeat(Number(level))} ${decodeHtml(stripTags(text)).trim()}\n\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/giu, (_match, text: string) => `\n- ${decodeHtml(stripTags(text)).trim()}`)
    .replace(/<(pre|code)[^>]*>([\s\S]*?)<\/\1>/giu, (_match, _tag: string, text: string) => `\n\n\`\`\`\n${decodeHtml(stripTags(text)).trim()}\n\`\`\`\n\n`)
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<\/(p|div|section|article|main|header|footer|table|tr)>/giu, "\n");
  return decodeHtml(stripTags(structured)).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/iu);
  return match ? decodeHtml(stripTags(match[1])).replace(/\s+/g, " ").trim().slice(0, 240) : undefined;
}

function stripTags(value: string) { return value.replace(/<[^>]+>/g, " "); }

function decodeHtml(value: string) {
  return value.replace(/&(nbsp|amp|lt|gt|quot|#39);/giu, (entity) => ({ "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" }[entity.toLowerCase()] ?? entity));
}

function sha256(value: string) { return createHash("sha256").update(value).digest("hex"); }

function parseDuckDuckGoResults(html: string) {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const anchor = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/giu;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) && results.length < 8) {
    const title = decodeHtml(stripTags(match[2])).replace(/\s+/g, " ").trim();
    const url = unwrapDuckDuckGoUrl(decodeHtml(match[1]));
    if (!title || !url) continue;
    const remainder = html.slice(anchor.lastIndex, anchor.lastIndex + 3_000);
    const snippetMatch = remainder.match(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\//iu);
    const snippet = snippetMatch ? decodeHtml(stripTags(snippetMatch[1])).replace(/\s+/g, " ").trim().slice(0, 600) : undefined;
    results.push({ title, url, snippet });
  }
  return results;
}

function parseBingRssResults(xml: string) {
  const results: Array<{ title: string; url: string; snippet?: string }> = [];
  const item = /<item>([\s\S]*?)<\/item>/giu;
  let match: RegExpExecArray | null;
  while ((match = item.exec(xml)) && results.length < 8) {
    const title = xmlTag(match[1], "title");
    const url = xmlTag(match[1], "link");
    const snippet = xmlTag(match[1], "description");
    if (!title || !url || !isHttpUrl(url)) continue;
    results.push({ title: normalizeXmlText(title), url: normalizeXmlText(url), snippet: snippet ? normalizeXmlText(snippet).slice(0, 600) : undefined });
  }
  return results;
}

function xmlTag(xml: string, tag: string) {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "iu"));
  return match?.[1];
}

function normalizeXmlText(value: string) {
  return decodeHtml(value.replace(/^<!\[CDATA\[|\]\]>$/gu, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function isHttpUrl(value: string) {
  try { return ["http:", "https:"].includes(new URL(normalizeXmlText(value)).protocol); } catch { return false; }
}

function unwrapDuckDuckGoUrl(value: string) {
  try {
    const url = new URL(value, "https://html.duckduckgo.com");
    return url.hostname.endsWith("duckduckgo.com") ? url.searchParams.get("uddg") ?? url.toString() : url.toString();
  } catch {
    return undefined;
  }
}
