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
  h('heading_2', '更新记录 · 全源 AI 摘要+解读覆盖 + 处理后删原文 + 统一源抓取模块（已落地 commit a750aa3）'),
  para('owner 2026-08-13 三项指令：①不管哪个源都抓取完整原文、做 AI 摘要、做 AI 解读 ②完成 AI 摘要+解读之后删除抓取的原文数据 ③tianxing/juhe 与其它 RSS 源处理逻辑完全一致、合并为源数据抓取模块统一处理。已推送生产仓库。'),

  h('heading_3', '一、全源 AI 加工覆盖（修复覆盖低根因）'),
  bullet('interpretNews 门槛 minAccept 由 max(70, tMin*0.6) 改为 max(90, tMin*0.35)：长文 tMin=520 旧门槛 312 字，混元通常只回 200-280 字被误杀（实测 news_cache 66 条仅 1 条 ai_interpretation 且恰为短文）；低地板后 >=90 字真实解读即接受，速览/深一度/冷思考均可通过'),
  bullet('enrichNewsList AI 摘要去掉 ratio<0.2 比例门槛（长文 AI 摘要 100-150 字占比常 <20% 被误杀），改 >=60 字即采用（60 字下限已滤 30 字假摘要），AI 摘要覆盖率提升'),

  h('heading_3', '二、处理后删原文（合规删除）'),
  bullet('非官方源解读失败时 content 不再存 raw fetched 全文：回退 AI 摘要（contentSource=ai_summary）或清空，绝不落库原文'),
  bullet('官方源解读失败维持清空（仅 summary+出处↗）；getNewsDetail R1 放行列表增加 ai_summary，AI 摘要兜底 content 正常展示'),
  bullet('官方 RSS 源原文在 news_ingest 瞬时暂存，处理成功即消费删除（A.5 处理即删），天然实现「删源数据」'),

  h('heading_3', '三、统一源抓取模块'),
  bullet('新增 sources/index.js：SOURCE_ADAPTERS 注册表 + collectAggregateSources，tianxing/juhe 经统一接口抓取，下游零分支；后续接入其它 RSS 源只改注册表一项、业务代码零改动'),
  bullet('index.js collectCategoryItems 改为调用 collectAggregateSources，删除硬编码 juheFetch/tianxing 分支；官方 RSS 经 rssFetcher 写入 news_ingest 暂存后由 refreshNews 统一消费（下游处理与聚合源完全一致）'),

  h('heading_3', '四、验证 + 真机观察'),
  bullet('node --check 四个文件全过；既有 interpretLens / aiOpinion 单测 12+8 全过'),
  quote('真机覆盖率需重传 refreshNews + getNewsDetail 云函数后观察 news_cache 的 ai_interpretation 占比是否从 1/66 爬升；字段契约不变（contentSource 取值新增 ai_summary）')
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
