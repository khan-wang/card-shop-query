# Card Shop Query

`card-shop-query` 是一份 Codex skill 和一个小型 Node.js 查询脚本，用于从 URL 来源池读取公开卡网店铺的当前商品信息。

适合这些场景：

- 批量查看多个卡网当前公开在售商品
- 按 `codex`、`gpt`、`gemini` 等关键词筛选
- 对比商品名、可见描述、价格、库存信号和下单链接
- 把维护中、失败和暂不支持的来源单独列出

脚本只读取公开店铺数据，不会下单，不会绕过登录，也不会收集已购买卡密内容。

## 目录结构

```text
.
|-- README.md
|-- sources.example.json
|-- sources.json                         # 本地来源池，默认被 git 忽略
`-- skills/
    `-- card-shop-query/
        |-- SKILL.md
        |-- agents/openai.yaml
        `-- scripts/query-card-shops.mjs
```

## 来源池

在仓库根目录创建 `sources.json`：

```json
{
  "version": 1,
  "shops": [
    "https://pay.example.invalid/shop/demo",
    "https://store.example.invalid/cat/12"
  ]
}
```

默认建议只放 URL。店名、商品名、价格、描述和库存都可能随时变化，查询时实时抓取更稳。

## 运行脚本

要求：

- Node.js 18 或更高版本
- 当前机器能访问来源池中的公开店铺页面

列出当前未被明确标为售罄的商品：

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs
```

按关键词筛选：

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --keyword codex
```

包含明确售罄商品：

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --include-sold-out
```

只列出明确有货商品，适合查“当前最便宜且可买”的结果：

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --only-in-stock
```

输出 JSON：

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --format json
```

指定另一个来源池：

```powershell
node .\skills\card-shop-query\scripts\query-card-shops.mjs --sources D:\data\shops.json
```

## 使用 Skill

可以把 `skills/card-shop-query` 放进 Codex skill 目录，也可以保留在这个仓库中，让 Codex 按该路径使用。

示例请求：

- `使用 card-shop-query skill 查询来源池里当前 GPT 相关商品。`
- `查询这些卡网里 codex 相关商品，按价格和描述给我比较。`
- `刷新卡网结果，并把失败来源单独列出来。`

## 当前支持范围

脚本当前内置这些公开来源适配器：

- JingShop 风格的 `/shop/<token>` 店铺页
- Dimosky 风格的 `/cat/<categoryId>` 分类页

未知页面结构不会被脚本强行猜测。它们会进入来源状态表，后续可以针对新平台再补适配器。

## 输出解释

输出是一次实时店铺快照，不是结算保证：

- 价格和库存可能在查询后变化
- 描述来自卖家公开文案，购买前仍需自己复核
- `缺货` 或零库存表示当前不可用；隐藏库存但公开接口显示正库存时会显示为 `库存充足`
- 各平台库存字段并不统一，`unknown` 表示页面没有暴露可判定库存
- 失败、维护中和不支持来源应保留在结果中，不应静默丢弃
