#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_DESCRIPTION_LIMIT = 180;
const DEFAULT_PAGE_LIMIT = 100;
const SOURCE_DELAY_MS = 180;
const BROWSER_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/136.0 Safari/537.36";

function parseArgs(argv) {
  const options = {
    sources: null,
    keyword: "",
    format: "markdown",
    includeSoldOut: false,
    descriptionLimit: DEFAULT_DESCRIPTION_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sources") {
      options.sources = argv[index + 1];
      index += 1;
    } else if (arg === "--keyword") {
      options.keyword = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--format") {
      options.format = argv[index + 1] ?? "markdown";
      index += 1;
    } else if (arg === "--include-sold-out") {
      options.includeSoldOut = true;
    } else if (arg === "--description-limit") {
      options.descriptionLimit = Number(argv[index + 1] ?? DEFAULT_DESCRIPTION_LIMIT);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["markdown", "json"].includes(options.format)) {
    throw new Error(`Unsupported format: ${options.format}`);
  }

  if (!Number.isFinite(options.descriptionLimit) || options.descriptionLimit < 40) {
    throw new Error("--description-limit must be a number of at least 40");
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage: node query-card-shops.mjs [options]

Options:
  --sources <path>              Source pool JSON file
  --keyword <text>              Filter against name, description, shop, and source URL
  --format <markdown|json>      Output format, default markdown
  --include-sold-out            Include products explicitly marked sold out
  --description-limit <number>  Description summary length, default ${DEFAULT_DESCRIPTION_LIMIT}
  --help                        Show this help
`);
}

function chooseSourcesPath(explicitPath) {
  const candidates = [
    explicitPath,
    resolve(process.cwd(), "sources.json"),
    resolve(process.cwd(), "sources.example.json"),
  ].filter(Boolean);

  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) {
    throw new Error("No source pool found. Pass --sources or create sources.json.");
  }
  return path;
}

async function loadSources(path) {
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (!Array.isArray(parsed.shops)) {
    throw new Error(`${path} must contain a shops array`);
  }

  const shops = [...new Set(parsed.shops.map((shop) => String(shop).trim()).filter(Boolean))];
  return { version: parsed.version ?? 1, shops };
}

function decodeHtml(text) {
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };

  return text
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripHtml(value) {
  if (!value) {
    return "";
  }

  return decodeHtml(String(value))
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function summarize(value, limit) {
  const text = stripHtml(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function markdownCell(value) {
  return String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ")
    .trim();
}

function sortListings(left, right) {
  const leftPrice = Number.isFinite(left.price) ? left.price : Number.POSITIVE_INFINITY;
  const rightPrice = Number.isFinite(right.price) ? right.price : Number.POSITIVE_INFINITY;
  return leftPrice - rightPrice || left.name.localeCompare(right.name, "zh-Hans-CN");
}

function matchesKeyword(listing, keyword) {
  if (!keyword) {
    return true;
  }
  const haystack = [
    listing.name,
    listing.searchText,
    listing.description,
    listing.shop,
    listing.sourceUrl,
    listing.category,
  ].join("\n").toLowerCase();
  return haystack.includes(keyword.toLowerCase());
}

async function fetchJson(url, options = {}) {
  const headers = {
    accept: "application/json, text/plain, */*",
    "user-agent": BROWSER_USER_AGENT,
    ...options.headers,
  };

  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    const contentType = response.headers.get("content-type") || "unknown content type";
    throw new Error(`non-JSON response (${contentType}); source may be rate-limited or challenge-protected`);
  }
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": BROWSER_USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

function parseJingShopSource(sourceUrl) {
  const url = new URL(sourceUrl);
  const match = url.pathname.match(/^\/shop\/([^/?#]+)/i);
  if (!match) {
    return null;
  }
  return { origin: url.origin, token: match[1] };
}

function jingStock(item) {
  const count = Number(item.extend?.stock_count);
  const exactCountVisible = Number(item.extend?.show_stock_type) === 0;
  if (exactCountVisible && Number.isFinite(count)) {
    return {
      stock: count,
      stockState: count > 0 ? "in_stock" : "sold_out",
      stockLabel: String(count),
    };
  }
  return { stock: null, stockState: "unknown", stockLabel: "unknown" };
}

async function postJing(origin, endpoint, body, sourceUrl) {
  const payload = await fetchJson(`${origin}${endpoint}`, {
    method: "POST",
    headers: {
      origin,
      referer: sourceUrl,
    },
    body: JSON.stringify(body),
  });

  if (payload.code !== 1) {
    throw new Error(payload.msg || `Unexpected JingShop response code ${payload.code}`);
  }
  return payload.data;
}

async function queryJingShop(sourceUrl, descriptionLimit) {
  const source = parseJingShopSource(sourceUrl);
  const goods = [];
  let page = 1;
  let total = null;

  while (total === null || goods.length < total) {
    const data = await postJing(source.origin, "/shopApi/Shop/goodsList", {
      token: source.token,
      goods_type: "card",
      category_id: 0,
      page,
      limit: DEFAULT_PAGE_LIMIT,
    }, sourceUrl);
    const pageGoods = Array.isArray(data.list) ? data.list : [];
    total = Number.isFinite(Number(data.total)) ? Number(data.total) : pageGoods.length;
    goods.push(...pageGoods);

    if (pageGoods.length === 0 || pageGoods.length < DEFAULT_PAGE_LIMIT) {
      break;
    }
    page += 1;
  }

  const listings = goods.map((item) => {
    const stock = jingStock(item);
    const searchText = stripHtml(item.description);
    return {
      adapter: "jing-shop",
      sourceUrl,
      shop: item.user?.nickname || source.token,
      category: item.category?.name || "",
      name: stripHtml(item.name),
      price: Number(item.price),
      currency: "CNY",
      stock: stock.stock,
      stockState: stock.stockState,
      stockLabel: stock.stockLabel,
      searchText,
      description: summarize(item.description, descriptionLimit),
      orderUrl: item.link || `${source.origin}/item/${item.goods_key}`,
    };
  });

  return {
    sourceUrl,
    adapter: "jing-shop",
    status: "ok",
    shop: listings[0]?.shop || source.token,
    listings,
  };
}

function parseDimoskySource(sourceUrl) {
  const url = new URL(sourceUrl);
  const match = url.pathname.match(/^\/cat\/(\d+)/i);
  if (!match) {
    return null;
  }
  return { origin: url.origin, categoryId: match[1] };
}

function extractDimoskyDescription(html) {
  const detail = html.match(/item-detail[\s\S]*?<div class="panel-body">([\s\S]*?)<\/div>\s*<\/div>\s*<\/main>/i);
  return detail?.[1] ?? "";
}

async function queryDimosky(sourceUrl, descriptionLimit) {
  const source = parseDimoskySource(sourceUrl);
  const payload = await fetchJson(
    `${source.origin}/user/api/index/commodity?categoryId=${encodeURIComponent(source.categoryId)}`,
  );

  if (payload.code !== 200 || !Array.isArray(payload.data)) {
    throw new Error(payload.msg || "Unexpected Dimosky commodity response");
  }

  const listings = await Promise.all(payload.data.map(async (item) => {
    let description = "";
    try {
      description = extractDimoskyDescription(await fetchText(`${source.origin}/item/${item.id}`));
    } catch {
      description = "";
    }

    const stock = Number(item.stock);
    return {
      adapter: "dimosky",
      sourceUrl,
      shop: new URL(sourceUrl).hostname,
      category: item.category?.name || "",
      name: stripHtml(item.name),
      price: Number(item.user_price ?? item.price),
      currency: "CNY",
      stock: Number.isFinite(stock) ? stock : null,
      stockState: Number.isFinite(stock) && stock <= 0 ? "sold_out" : "in_stock",
      stockLabel: Number.isFinite(stock) ? String(stock) : "unknown",
      searchText: stripHtml(description),
      description: summarize(description, descriptionLimit),
      orderUrl: `${source.origin}/item/${item.id}`,
    };
  }));

  return {
    sourceUrl,
    adapter: "dimosky",
    status: "ok",
    shop: new URL(sourceUrl).hostname,
    listings,
  };
}

async function queryHtmlFallback(sourceUrl) {
  const html = await fetchText(sourceUrl);
  if (/店铺正在维护|正在升级/i.test(html)) {
    return {
      sourceUrl,
      adapter: "html-fallback",
      status: "unavailable",
      message: "maintenance page detected",
      listings: [],
    };
  }

  return {
    sourceUrl,
    adapter: "html-fallback",
    status: "unsupported",
    message: "no supported public storefront adapter matched",
    listings: [],
  };
}

async function querySource(sourceUrl, descriptionLimit) {
  try {
    if (parseJingShopSource(sourceUrl)) {
      return await queryJingShop(sourceUrl, descriptionLimit);
    }
    if (parseDimoskySource(sourceUrl)) {
      return await queryDimosky(sourceUrl, descriptionLimit);
    }
    return await queryHtmlFallback(sourceUrl);
  } catch (error) {
    return {
      sourceUrl,
      adapter: "unknown",
      status: "error",
      message: error.message,
      listings: [],
    };
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function querySources(sourceUrls, descriptionLimit) {
  const sources = [];
  for (const sourceUrl of sourceUrls) {
    sources.push(await querySource(sourceUrl, descriptionLimit));
    await sleep(SOURCE_DELAY_MS);
  }
  return sources;
}

function formatMarkdown(report) {
  const lines = [
    "# Card Shop Query",
    "",
    `- Generated: ${report.generatedAt}`,
    `- Source pool: ${report.sourcesPath}`,
    `- Sources checked: ${report.sourcesChecked}`,
    `- Listings shown: ${report.listings.length}`,
  ];

  if (report.keyword) {
    lines.push(`- Keyword: ${report.keyword}`);
  }

  lines.push(
    "",
    "## Listings",
    "",
    "| Product | Price | Stock | Shop | Description | Order | Source |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );

  if (report.listings.length === 0) {
    lines.push("| No matching listings |  |  |  |  |  |  |");
  } else {
    report.listings.forEach((listing) => {
      lines.push(`| ${markdownCell(listing.name)} | ${listing.currency} ${markdownCell(listing.price)} | ${markdownCell(listing.stockLabel)} | ${markdownCell(listing.shop)} | ${markdownCell(listing.description)} | [order](${listing.orderUrl}) | [source](${listing.sourceUrl}) |`);
    });
  }

  lines.push(
    "",
    "## Source Status",
    "",
    "| Source | Status | Adapter | Note |",
    "| --- | --- | --- | --- |",
  );

  report.sources.forEach((source) => {
    const note = source.message || `${source.listings.length} listings read`;
    lines.push(`| [source](${source.sourceUrl}) | ${markdownCell(source.status)} | ${markdownCell(source.adapter)} | ${markdownCell(note)} |`);
  });

  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourcesPath = chooseSourcesPath(options.sources);
  const sourcePool = await loadSources(sourcesPath);
  const sources = await querySources(sourcePool.shops, options.descriptionLimit);

  const listings = sources
    .flatMap((source) => source.listings)
    .filter((listing) => options.includeSoldOut || listing.stockState !== "sold_out")
    .filter((listing) => matchesKeyword(listing, options.keyword))
    .sort(sortListings)
    .map(({ searchText, ...listing }) => listing);

  const report = {
    generatedAt: new Date().toISOString(),
    sourcesPath,
    sourcesChecked: sourcePool.shops.length,
    keyword: options.keyword,
    includeSoldOut: options.includeSoldOut,
    listings,
    sources,
  };

  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(formatMarkdown(report));
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
