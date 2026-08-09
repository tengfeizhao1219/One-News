#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fs08.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-08「AI摘要长度控制一屏可容纳 + 标题完整展示」广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fs08.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'

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

const children = [
  { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '[FS-08] 22:20 AI摘要长度控制 + 标题完整展示（commit 444d2f9）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '问题：AI摘要prompt允许100-300字(max_tokens 600)，部分冲到300字撑爆一屏单卡高度；内容超高时卡片justify-content:center上下两端同时被裁，标题顶部可能被切掉' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '容量计算：iPhone SE最坏(5行标题+窄屏)摘要区约11.5行×19字≈200字，主流机型约300字。summaryMaxChars=150定义在config但代码从未引用，形同虚设' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '三道防线：(1)后端contentFetcher prompt改100-150字+AI摘要统一截断150；(2)前端home.js buildCard兜底slice(0,150)；(3)home.wxss .summary-p加-webkit-line-clamp:4省略 + .card-body改justify-content:flex-start(超高只裁底部摘要区，标题永远完整)' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '测试：b10新增「AI摘要超150字截断」用例，41/41全过。commit 444d2f9已推(SSH)' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '下游动作：owner重新部署refreshNews云函数+前端即生效（改云函数代码，需重部署）。无DB回扫需求（前端兜底兼容老数据）' } }] } },
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
