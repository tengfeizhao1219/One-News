import { readFileSync } from 'fs'

const SECRETS = readFileSync('.workbuddy/keys/SECRETS.md', 'utf-8')
const tokens = SECRETS.match(/ntn_[A-Za-z0-9]+/g) || []
const TOKEN = tokens[tokens.length - 1]
if (!TOKEN) { console.error('NO NOTION TOKEN FOUND in SECRETS.md'); process.exit(1) }
const API = 'https://api.notion.com/v1'
const H = { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': '2022-06-28', 'Content-Type': 'application/json' }
const PAGE_ID = '3b96b5eb-1dd8-8180-85ba-e3ad347aa0af' // AI 解读风格优化方案 页
const MAX = 1900

function richText(text) {
  const out = []
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: { content: text.slice(last, m.index) } })
    if (m[1]) out.push({ type: 'text', text: { content: m[2] }, annotations: { bold: true } })
    else if (m[3]) out.push({ type: 'text', text: { content: m[4] }, annotations: { code: true } })
    else if (m[5]) out.push({ type: 'text', text: { content: m[6] }, annotations: { italic: true } })
    else if (m[7]) out.push({ type: 'text', text: { content: m[8] }, annotations: { italic: true } })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ type: 'text', text: { content: text.slice(last) } })
  const chunked = []
  for (const r of out) {
    const c = r.text.content
    if (c.length <= MAX) chunked.push(r)
    else for (let i = 0; i < c.length; i += MAX)
      chunked.push({ ...r, text: { ...r.text, content: c.slice(i, i + MAX) } })
  }
  return chunked.length ? chunked : [{ type: 'text', text: { content: '' } }]
}
const para = (t) => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: richText(t) } })
const h = (lvl, t) => ({ object: 'block', type: lvl, [lvl]: { rich_text: richText(t) } })
const quote = (t) => ({ object: 'block', type: 'quote', quote: { rich_text: richText(t) } })
const bullet = (t) => ({ object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: richText(t) } })

const blocks = [
  h('heading_2', '更新记录 · 后端返回【一页说】独立字段 aiOpinion（已落地 commit 4bdcfe9）'),
  para('owner 2026-08-12 拍板：【一页说】需作为「AI 独立观点见解」的**独立小卡片/胶囊**呈现，不要混在正文里当普通段落。前端（PD+FE 窗口）据此请求后端把观点拆成独立字段返回。已推送生产仓库。'),

  h('heading_3', '一、字段契约（前后端对齐）'),
  bullet('字段名：**`aiOpinion`**（字符串）。空串（空字符串）或不存 → 前端不渲染观点卡；非空 → 渲染独立【一页说】卡片/胶囊（标签由前端加，后端只给纯观点文本）'),
  bullet('配套字段：`content`（解读正文，已**剥离**【一页说】内联标记，前端无需再从正文解析标记）、`contentSource=\'ai_interpretation\'`'),
  bullet('范围：先覆盖聚合/天行降级源的 AI 独立解读通道；官方 RSS 源是否加观点待另议'),

  h('heading_3', '二、后端实现要点'),
  bullet('`interpretLens.splitOpinionFromText(text)`：从模型全文切出【一页说】段 → 返回 `{ body, opinion }`；body 已去内联标记，opinion 不含标签前缀；兼容有无括号两种写法、清理「——/：」等前导分隔符'),
  bullet('`contentFetcher.interpretNews` 两处返回（引擎链 + 混元兜底）都加 `aiOpinion`；`withOpinion=false`（敏感题材/低分）时强制空串，且正文仍剥离残留标记（合规双保险）'),
  bullet('`refreshNews/index.js` `batchInsert` 的 `docData` 显式加 `aiOpinion: item.aiOpinion || 空串` → 落库 news_cache 集合'),
  bullet('`getNewsDetail` 经 `...doc` 透传，读侧零改动'),

  h('heading_3', '三、合规边界'),
  quote('敏感题材（withOpinion=false）→ aiOpinion 天然为空，观点卡不渲染，与现有门禁一致；观点必须建立在原文事实/公认常识之上，禁编造。'),

  h('heading_3', '四、验证'),
  bullet('新增 `test/ai-opinion-extract-test.mjs`：12 用例全过（标准/无标记/无括号/分隔符清理/禁观点不暴露 5 类）'),
  bullet('下游：PD+FE 拿到 `aiOpinion` 字段即可落地【一页说】观点卡（detail.wxml/wxss + reading-engine.js 透传），无需再等后端')
]

async function append(pageId, blocks) {
  const res = await fetch(`${API}/blocks/${pageId}/children`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ children: blocks })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`append ${res.status}: ${JSON.stringify(json).slice(0, 600)}`)
  return json
}

let i = 0
for (; i < blocks.length; i += 5) {
  const chunk = blocks.slice(i, i + 5)
  const r = await append(PAGE_ID, chunk)
  console.log(`APPEND ${i}..${i + chunk.length - 1} OK (${r.results ? r.results.length : chunk.length} blocks)`)
}
console.log(`DONE | https://www.notion.so/${PAGE_ID.replace(/-/g, '')}`)
