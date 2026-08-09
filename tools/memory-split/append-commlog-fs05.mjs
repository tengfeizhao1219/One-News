#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fs05.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-05「假 desc 展示日期」BUG 修复广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fs05.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'
const COMMIT = '0f91955'

// 1. 抓 token（沿用 append-commlog.mjs 的正则抓 ntn_ 串）
if (!existsSync(SECRETS)) {
  console.error(`❌ 缺密钥: ${SECRETS}`)
  process.exit(1)
}
const secretsText = readFileSync(SECRETS, 'utf-8')
const TOKEN = secretsText.match(/ntn_[A-Za-z0-9]+/)?.[0] || ''
if (!TOKEN) {
  console.error('❌ SECRETS.md 里没找到 ntn_ 开头的 token')
  process.exit(1)
}

// 2. blocks（每行一段 quote,FS-05 修复广播）
const blocks = [
  {
    object: 'block', type: 'quote',
    quote: { rich_text: [{ type: 'text', text: { content: '2026-08-09 17:43 — FS 窗口 sid 20260809-JZDP1NQJ0TA6' }}]}
  },
  {
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: '修复：「首页列表假 desc 展示日期」BUG（FS-05）' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '症状（owner 17:28 反馈）：首页列表里部分新闻有正文但无 AI 摘要时，没有展示正文第一段也没有展示标题，直接展示了一个日期/来源名。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '根因：contentFetcher.js L479 判「rawSummary === item.title」来定 summarySource=\'title\'，但聚合接口常返回「2026-08-09 14:23」或「澎湃新闻」等假 desc（短到 < 20 字、纯日期、等于来源名），原判定对假 desc 无效 → summarySource=\'desc\' → L508 兜底不执行 → 前端直接展示假 desc。' }}]}
  },
  { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: `修复（commit ${COMMIT}）` }}]}},
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'L477-493 新增 isInvalidDesc()：长度<20 / 纯日期 / 仅标点 / 等于来源 → 视为无效 → summarySource=\'title\'' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'L518-547 兜底条件扩展：任何 summarySource !== \'ai\' 且有 content → 走首段（不再要求是 title 档）' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '首段二次校验 isValidParagraph()：不能等于日期/标点/标题，长度>=20 才算合格；首段也不合格（极端 case）→ 退到 title 档' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '测试：加 5 项 FS-05 单元测试到 b10 §5.6（纯日期/来源名/短 desc/有效 desc/首段是日期），38/38 全过。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '影响范围：所有 enrichment 流程（v1.1.0 跑批 + 未来新摘要失败场景）。已 SSH push，owner 真机验收后生效。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '待办（owner）：① 真机验收首页列表 ② 老 DB 数据需重跑 enrichment 才会更新（5 min 内新跑的会带正确 summary，旧数据仍是假 desc）。' }}]}
  },
  { object: 'block', type: 'divider', divider: {} }
]

// 3. PATCH 到 Notion
const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ children: blocks })
})
const data = await res.json()
if (data.object === 'error') {
  console.error('❌ Notion API error:', JSON.stringify(data, null, 2))
  process.exit(1)
}
console.log(`✅ Notion COMMLOG 追加 ${data.results.length} blocks`)
console.log(`   首块 id: ${data.results[0]?.id}`)
