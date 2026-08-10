#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fs09.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-09「有正文时首段不合格不直接退标题，扫描后续段落」广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fs09.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'

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

const children = [
  { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '[FS-09] 09:20 有正文时首段不合格不直接退标题，扫描后续段落（commit 5b8e4c0）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '问题（owner 2026-08-10 反馈）：首页摘要中，有足够正文的新闻仍直接展示标题而非正文，顺序为 A摘要→源摘要→正文第一段→标题' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '根因：contentFetcher.js 兜底只取"第一段"做校验，若第一段是日期/来源/导语（如"2026年8月10日"、"本报讯"、"（记者 XXX）"）被判无效，直接退 title 档，正文后面明明有足够内容' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '修复：contentFetcher.js + home.js 兜底改为遍历所有段落，取第一个合格段落作为 content 档；只有所有段落都不合格才退 title。同步保留 FE 已移除的 150 字硬截断（句子不中途断裂）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '测试：b10 原"首段日期→退title"用例反转 + 新增"全部不合格才退title"用例，42/42 全过。commit 5b8e4c0 已推（rebase 合并 FE-20260810-003 移除截断，无冲突残留）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '下游动作：owner 重新部署 refreshNews 云函数 + 前端即生效（老 DB 已标 title 但实际有正文的新闻，前端兜底也会扫描后续段落）' } }] } },
]

const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ children }),
})
const text = await res.text()
if (res.ok) {
  const j = JSON.parse(text)
  console.log(`COMMLOG 追加成功：${j.results.length} blocks`)
} else {
  console.log(`COMMLOG 追加失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
}
