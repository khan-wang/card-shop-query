---
name: card-shop-query
description: Query public card-shop storefront listings from a URL-only source pool and summarize visible products, prices, descriptions, stock signals, source links, and source failures. Use when Codex needs to refresh card-shop inventory snapshots, filter listings by keywords, compare public offers across shops, or maintain a reusable card-shop query workflow without storing stale product metadata.
---

# Card Shop Query

Use the bundled script for deterministic storefront reads. Keep the source pool URL-only unless the user explicitly wants extra metadata.

## Workflow

1. Locate the source pool. Prefer a user-provided `--sources` file, then `sources.json` in the current project, then `sources.example.json` only as a schema example.
2. Run `scripts/query-card-shops.mjs` with `--keyword` when the user asks for a product family or term.
3. Return current visible rows with product name, visible price, description summary, stock signal, shop/source, and order URL.
4. Keep source failures, maintenance pages, and unsupported source shapes in a separate status section.
5. Treat prices, stock, and seller descriptions as a time-sensitive public storefront snapshot.

## Commands

Query the default pool:

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs
```

Filter by keyword:

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --keyword codex
```

Return JSON:

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --format json
```

## Reporting Rules

- Do not invent products, stock, or prices when a source fails.
- Preserve the order URL for each normalized listing.
- Prefer the seller's visible product name over inferred naming.
- Summarize long HTML descriptions instead of dumping full storefront markup.
- Say `unknown` when the platform hides or omits a decisive stock count.
- Do not store purchased card contents, credentials, or order secrets in reports.
- When adding a new adapter, keep unsupported sources visible until that adapter is tested against current public pages.

## Script Scope

The bundled script currently handles public JingShop-style `/shop/<token>` pages and Dimosky-style `/cat/<categoryId>` pages. Read the script before extending source detection or parsing logic.
