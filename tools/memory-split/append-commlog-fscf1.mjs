#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fscf1.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-CF1「摘要引擎混元降级到最后一位（外部Key链→混元兜底）」广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fscf1.mjs
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
  { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: '[FS-CF1] 10:30 摘要引擎混元降级到最后一位（外部Key链→混元兜底，commit b82d76e）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: 'owner 指示：把混元从 AI 摘要降级链最前置挪到最后一位（兜底才用），省 10亿 免费额度' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '改动：contentFetcher.js summarizeWithZhipu 主逻辑由"混元优先→外部链"反转为"外部链优先（智谱→Qwen→DeepSeek）→全部失败后混元兜底"；无外部 Key 时直接走混元' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '测试：b10 42/42 全过（沙箱无 wx-server-sdk 时混元跳过、外部链兜底路径不受影响）。commit b82d76e 已推（SSH）' } }] } },
  { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: '下游动作：owner 重新部署 refreshNews 云函数即生效。注意：当前 Qwen 403 配额耗尽 + DeepSeek 402 余额不足，外部链可能全挂，届时会落到混元兜底（免费额度）' } }] } },
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
