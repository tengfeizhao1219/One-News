#!/usr/bin/env node
/**
 * tools/memory-split/append-commlog-fs06.mjs
 *
 * 在 Notion COMMLOG 页面追加 FS-06「混元引擎接入」广播
 *
 * 用法:
 *   node tools/memory-split/append-commlog-fs06.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const ROOT = resolve(__dirname, '../..')
const SECRETS = join(ROOT, '.workbuddy/keys/SECRETS.md')
const PAGE_ID = '3b66b5eb-1dd8-814d-ae02-e2b35cf15dcc'
const COMMIT = '38bbed8'

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

// 2. blocks（FS-06 广播）
const blocks = [
  {
    object: 'block', type: 'quote',
    quote: { rich_text: [{ type: 'text', text: { content: '2026-08-09 20:45 — FS 窗口 sid 20260809-JZDP1NQJ0TA6' }}]}
  },
  {
    object: 'block', type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: '混元引擎接入摘要降级链（FS-06）' }}]}
  },
  {
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: '背景：微信 AI 小程序成长计划赠 10 亿 Token 免费文生文，绑定云开发环境，经 cloud.ai() 内置调用、平台托管鉴权、无需 API Key。符合"不依赖 owner 操作"的接入要求。' }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `config.js 新增 hunyuan 配置块（enabled/model=hy3/timeout/maxInputChars/concurrency=5）` }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `contentFetcher.js summarizeWithZhipu：降级链前置混元引擎，优先用免费额度，失败才回退 智谱→Qwen→DeepSeek。动态 require('wx-server-sdk')，本地沙箱 try/catch 静默跳过，零影响。` }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `测试 b10 新增 FS-06 项（沙箱无 wx-server-sdk → 混元跳过并降级 DeepSeek），40/40 全过。` }}]}
  },
  {
    object: 'block', type: 'bulleted_list_item',
    bulleted_list_item: { rich_text: [{ type: 'text', text: { content: `commit ${COMMIT} 已推远程（5ee0003..38bbed8）。` }}]}
  },
  {
    object: 'block', type: 'heading_3',
    heading_3: { rich_text: [{ type: 'text', text: { content: '⚠️ 待 owner 平台侧两步（代码已就绪，无需再改）' }}]}
  },
  {
    object: 'block', type: 'numbered_list_item',
    numbered_list_item: { rich_text: [{ type: 'text', text: { content: 'CloudBase 控制台 AI+ → 生文模型 勾选 hy3（体验模型）' }}]}
  },
  {
    object: 'block', type: 'numbered_list_item',
    numbered_list_item: { rich_text: [{ type: 'text', text: { content: '微信公众平台 → 行业能力 → 小程序成长计划 报名（10 亿 Token 到账，6 个月有效）' }}]}
  },
  {
    object: 'block', type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: '完成后重新部署 refreshNews 云函数即可生效。混元额度绑定生产环境 cloud1-1g9313w0bb791de0，与「测试/生产未隔离」待决策项相关（若后续拆测试环境，测试环境 AI 调用不吃此免费包）。' }}]}
  },
  {
    object: 'block', type: 'divider', divider: {}
  },
]

// 3. 调用 Notion API 追加到 COMMLOG
const res = await fetch(`https://api.notion.com/v1/blocks/${PAGE_ID}/children`, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28',
  },
  body: JSON.stringify({ children: blocks }),
})
const data = await res.json()
if (!res.ok) {
  console.error(`❌ COMMLOG 追加失败 ${res.status}:`, JSON.stringify(data).slice(0, 400))
  process.exit(1)
}
console.log(`✅ COMMLOG 追加成功（${data.results?.length || 0} blocks），首块 id ${data.results?.[0]?.id}`)
