#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fs05v2.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-05 v2「老假 desc 写库二次过滤 + 前端老数据兜底」广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fs05v2.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'
const COMMIT = '5ee0003'

// 1. 抓 token
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

// 2. blocks（FS-05 v2 广播）
const blocks = [
  {
    object: 'block', type: 'quote',
    quote: { rich_text: [{ type: 'text', text: { content: '2026-08-09 19:40 — FS 窗口 sid 20260809-JZDP1NQJ0TA6' }}]}
  },
  {
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: '修复补发：「老假 desc 仍展示」根因（FS-05 v2）' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '症状（owner 19:00 反馈）：FS-05 部署后首页摘要仍不对。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '新根因①：index.js 写库逻辑「老 summary 长度 > 新 → 保留老」，老假 desc（20-50字日期/来源名）比新首段还长 → 赢过新首段 → 前端仍展示垃圾。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '新根因②：老 DB 记录无 summarySource 字段，被标 \'desc\'，前端走 displaySummary 原样展示假 desc。' }}]}
  },
  { object: 'block', type: 'heading_3', heading_3: { rich_text: [{ type: 'text', text: { content: `修复（commit ${COMMIT}）` }}]}},
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'contentFetcher.js：isInvalidDesc/isValidParagraph 提为顶层并导出（供 index.js 复用）。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'index.js：写库时老 summary 必须先过 isInvalidDesc 校验才允许保留，老假 desc 不再赢；保留判定=长度比较 + 质量校验双重把关。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'home.js：前端兜底 —— summarySource 非 ai 且 summary 被判假 desc 且有正文 → 一律取正文首段；首段也不合格 → 退 title 档（兼容老 DB summarySource 缺失）。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '测试：b10 加 1 项（isInvalidDesc 导出 + 假/有效 desc 判定），39/39 全过。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '待办（owner）：① 重新部署 refreshNews + 小程序端更新 ② 老 DB 存量数据需重跑 enrichment 才会回写正确 summary（新跑会带正确值）。' }}]}
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
