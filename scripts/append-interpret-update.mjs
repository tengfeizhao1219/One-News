import { readFileSync } from 'fs'

const SECRETS = readFileSync('.workbuddy/keys/SECRETS.md', 'utf-8')
const tokens = SECRETS.match(/ntn_[A-Za-z0-9]+/g) || []
const TOKEN = tokens[tokens.length - 1]
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
function codeBlock(text, lang) {
  const blocks = []
  for (let i = 0; i < text.length; i += MAX)
    blocks.push({ object: 'block', type: 'code', code: { language: lang || 'plain text', rich_text: [{ type: 'text', text: { content: text.slice(i, i + MAX) } }] } })
  return blocks
}
function buildTable(header, rows) {
  const width = header.length
  const cells = (arr) => arr.slice(0, width).map((c) => [{ type: 'text', text: { content: c.trim() } }])
  const children = [{ table_row: { cells: cells(header) } }, ...rows.map((r) => ({ table_row: { cells: cells(r) } }))]
  return { object: 'block', type: 'table', table: { table_width: width, has_column_header: true, has_row_header: false, children } }
}

const blocks = [
  h('heading_2', '更新记录 · 2026-08-11 19:20（已落地 commit ba087f8）'),
  para('owner 要求：解读字数随原文长度适度增加（上限约 600 字），并精修详情页解读区排版（字号 / 段距 / 行距 / 美观）。以下为最终落地版，已推送生产仓库，重新上传 refreshNews 云函数 + 编译 detail 页即生效。'),

  h('heading_3', '一、解读长度随原文伸缩'),
  para('`interpretNews` 按 `content.length` 动态定字数区间（中文约 2.3 token/字，max_tokens 跟随上限，封顶 1600）：'),
  buildTable(
    ['原文长度', '解读字数区间', '说明'],
    [
      ['< 300 字', '180 – 280', '短讯，点到为止'],
      ['< 800 字', '300 – 430', '常规新闻'],
      ['< 1600 字', '450 – 580', '中长篇'],
      ['≥ 1600 字', '520 – 600', '长文封顶 600 字']
    ]
  ),

  h('heading_3', '二、最终版解读 Prompt（contentFetcher.js · INTERPRET_PROMPT）'),
  para('风格从「专业四段式复述」改为「一页解读人」——有观点、不注水、金句收尾，不再像总结。'),
  ...codeBlock(
`你是「一页」的新闻解读人，不是复读机。基于用户给的新闻原文，写一篇有观点、读着不累的独立解读。
写法：
1. 开场用一句话点出"这事和读者有什么关系"，别端着；
2. 中间讲清来龙去脉与关键事实，挑读者最该知道的讲，不注水、不堆砌；
3. 可有克制的个人视角或轻类比，但绝不编造原文没有的事实；
4. 结尾来一句让人记得住的话（金句/反差/小提醒均可）；
5. 分段用空行分隔，段间自然过渡；
6. 禁止"据报道""据悉""记者从…获悉"等套话，禁止逐字复述或高度相似改写原文。
原文约 N 字，你的解读控制在 tMin-tMax 字（随原文长度增减，最多不超过 600 字），以句号自然收尾。
// 调用参数：max_tokens = min(1600, ceil(tMax * 2.3))，temperature = 0.7`,
    'javascript'
  ),

  h('heading_3', '三、详情页解读区排版精修（pages/detail/detail.wxss · .text-p）'),
  bullet('行高 2.0 → **1.9**：600 字长文更紧凑透气'),
  bullet('新增 **text-align: justify + text-align-last: left**（两端对齐）：右侧不再犬牙交错'),
  bullet('保留段距 36rpx、首行缩进 2em、字间距 1rpx：段落划分清晰'),
  bullet('解读按 `paragraphs` 数组逐段渲染（text.split(\'\\n\')），长文自动分多个 `.text-p` 段落'),

  quote('验证方式：挑一篇 >1000 字的政策稿走一遍，应拿到约 500 字解读；排版请在开发者工具 / 真机预览确认（沙箱无法真机渲染）。')
]

async function append(pageId, blocks) {
  const res = await fetch(`${API}/blocks/${pageId}/children`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ children: blocks })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`append ${res.status}: ${JSON.stringify(json).slice(0, 600)}`)
  return json
}

// 分批 ≤5 块，降低 401 风险；index 0..4 已成功，从 5 续传
for (let i = 5; i < blocks.length; i += 5) {
  const chunk = blocks.slice(i, i + 5)
  const r = await append(PAGE_ID, chunk)
  console.log(`APPEND ${i}..${i + chunk.length - 1} OK (${r.results ? r.results.length : chunk.length} blocks)`)
}
console.log(`DONE | https://www.notion.so/${PAGE_ID.replace(/-/g, '')}`)
