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
  h('heading_2', '更新记录 · 读法路由「轻量路线」落地（已落地 commit 4791dc3）'),
  para('owner 拍板「先轻量路线跑起来」——不引 RAG，用「读法库 + 选择性【一页说】观点 + 合规硬门禁」破解此前两痛点：① 解读模式固化（千篇一律四段式、看多了疲劳）② 只复述别人、缺 AI 自身视角。已推送生产仓库，重新上传 refreshNews 云函数即生效。'),

  h('heading_3', '一、5 种读法（interpretLens.js · LENSES）'),
  buildTable(
    ['读法', 'name', '允许观点', '字数系数', '适用'],
    [
      ['brief', '速览', '否', '0.6', '低价值/软新闻/敏感题材（强制）'],
      ['depth', '深一度', '是', '1.0', '中等价值硬新闻'],
      ['cold', '冷思考', '是', '1.0', '高价值 + 安全硬新闻（观点最重）'],
      ['life', '生活家', '是', '0.85', '民生/社会类'],
      ['ask', '追问', '是', '0.85', '结论未定（或将/拟/传/研究中…）']
    ]
  ),
  para('同读法内确定性腔调轮换：stableHash(标题) 选定 opening/closing 变体 → 结果可复现（不刷新就变），不同新闻自然分散 → 破疲劳。'),

  h('heading_3', '二、路由优先级（越前越硬，cloudfunctions/refreshNews/utils/interpretLens.js · routeLens）'),
  bullet('敏感题材（总书记/主席/地震/爆炸/遇难/涉嫌/军演/疫情…）→ **速览 + 禁止任何观点评判**（合规硬约束，最高优先）'),
  bullet('结论未定（或将/拟/传/研究中/征求意见/试点…）→ **追问**（以问代论，不硬下结论）'),
  bullet('民生/社会类（life）→ **生活家**（换算成过日子的语言）'),
  bullet('高 FinalScore + 硬新闻类（tech/international/recommend）→ **冷思考**（讲权衡与盲点）'),
  bullet('中等 FinalScore → **深一度**（讲背景与影响）'),
  bullet('低分兜底 → **速览**（不加观点，省篇幅）'),

  h('heading_3', '三、门禁信号来源（复用 qualityScorer 已落库字段，不重复计算）'),
  para('`finalScore` / `qualityScore` / `heatScore` / `category` 由另一 FS 窗口落地的 `qualityScorer.js` 写入（commit 658f8d3 / 7cd5193）。`routeLens(item)` 直接消费这些字段做路由，零额外计算。'),

  h('heading_3', '四、选择性【一页说】观点段'),
  bullet('仅「读法允许 AND 题材安全」时才要求模型在结尾加【一页说】段（2-3 句自家看法/提醒）'),
  bullet('prompt 显式标注【一页说】与事实区隔；观点必须建立在原文事实或公认常识之上，禁编造无法核实的具体数据/时间/人名'),
  bullet('敏感题材即便高价值也强制禁观点 → 退化为纯速览'),
  bullet('老调用方（3 参，无 signals）降级为「中等价值」→ 深一度读法，行为不退化'),

  h('heading_3', '五、合规与成本边界'),
  bullet('合规硬约束延续详情页合规 v1.3：敏感题材强制速览且禁评判；观点必须显式框为【一页说】'),
  bullet('合格门槛随读法浮动：速览 120-180 字，原固定 150 会误杀合格速览；已改为 lens 感知 minAccept'),
  bullet('成本：速览天然短省 token；观点段仅高价值新闻出，控篇幅'),
  quote('模型训练数据有截止（约 2024），对极新/极专业事件观点可能偏泛 → 已用门禁限制范围，只在「值得且安全」的新闻开观点。RAG 未做（轻量优先）；若需时效/专业深度，再议 RAG 通道（需外部检索/联网搜索）。'),

  h('heading_3', '六、验证'),
  bullet('新增 `test/lens-route-smoke.mjs` 路由一致性冒烟测试：8 类新闻（敏感/未定/民生/硬高/硬中/低分/无信号）全过，读法+观点+prompt 一致性 100%'),
  bullet('owner 部署 refreshNews 后真机验收：重点看日志「读法=」分布是否多样（验证破固化目标）')
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
