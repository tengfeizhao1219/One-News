import { readFileSync } from 'fs'

const SECRETS = readFileSync('.workbuddy/keys/SECRETS.md', 'utf-8')
const tokens = SECRETS.match(/ntn_[A-Za-z0-9]+/g) || []
const TOKEN = tokens[tokens.length - 1]
const PARENT = '3b66b5eb-1dd8-812a-91fd-f04ab916ac4b'
const API = 'https://api.notion.com/v1'
const H = {
  Authorization: `Bearer ${TOKEN}`,
  'Notion-Version': '2022-06-28',
  'Content-Type': 'application/json'
}
const MAX = 1900

function richText(text) {
  const out = []
  const re = /(\*\*([^*]+)\*\*)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))|(\*([^*]+)\*)|(_([^_]+)_)/g
  let last = 0, m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: { content: text.slice(last, m.index) } })
    if (m[1]) out.push({ type: 'text', text: { content: m[2] }, annotations: { bold: true } })
    else if (m[3]) out.push({ type: 'text', text: { content: m[4] }, annotations: { code: true } })
    else if (m[5]) out.push({ type: 'text', text: { content: m[6], link: { url: m[7] } } })
    else if (m[8]) out.push({ type: 'text', text: { content: m[9] }, annotations: { italic: true } })
    else if (m[10]) out.push({ type: 'text', text: { content: m[11] }, annotations: { italic: true } })
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
const numbered = (t) => ({ object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: richText(t) } })
function codeBlock(text, lang) {
  const blocks = []
  for (let i = 0; i < text.length; i += MAX)
    blocks.push({ object: 'block', type: 'code', code: { language: lang || 'plain text', rich_text: [{ type: 'text', text: { content: text.slice(i, i + MAX) } }] } })
  return blocks
}
function splitRow(line) {
  return line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
}
function buildTable(header, rows) {
  const width = header.length
  const cells = (arr) => arr.slice(0, width).map((c) => [{ type: 'text', text: { content: c.trim() } }])
  const children = [{ table_row: { cells: cells(header) } }, ...rows.map((r) => ({ table_row: { cells: cells(r) } }))]
  return { object: 'block', type: 'table', table: { table_width: width, has_column_header: true, has_row_header: false, children } }
}
function mdToBlocks(md) {
  const lines = md.split(/\r?\n/)
  const blocks = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (/^```/.test(line)) {
      const lang = line.slice(3).trim() || 'plain text'
      const buf = []
      i++
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      blocks.push(...codeBlock(buf.join('\n'), lang))
      continue
    }
    if (/^\|/.test(line) && i + 1 < lines.length && /^\|?[\s:|-]+\|/.test(lines[i + 1])) {
      const header = splitRow(line)
      const rows = []
      i += 2
      while (i < lines.length && /^\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++ }
      blocks.push(buildTable(header, rows))
      continue
    }
    const hm = line.match(/^(#{1,4})\s+(.*)$/)
    if (hm) {
      const lvl = hm[1].length
      const txt = hm[2]
      const type = lvl === 1 ? 'heading_1' : lvl === 2 ? 'heading_2' : 'heading_3'
      blocks.push(h(type, txt)); i++; continue
    }
    if (/^>\s?/.test(line)) {
      const buf = []
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++ }
      blocks.push(quote(buf.join('\n'))); continue
    }
    const bm = line.match(/^[-*]\s+(.*)$/)
    if (bm) { blocks.push(bullet(bm[1])); i++; continue }
    const nm = line.match(/^\d+\.\s+(.*)$/)
    if (nm) { blocks.push(numbered(nm[1])); i++; continue }
    if (!line.trim()) { i++; continue }
    const buf = [line]; i++
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|^>|[-*]\s|\d+\.\s|\|)/.test(lines[i])) { buf.push(lines[i]); i++ }
    blocks.push(para(buf.join(' ')))
  }
  return blocks
}
async function createPage(title, blocks) {
  const res = await fetch(`${API}/pages`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ parent: { type: 'page_id', page_id: PARENT }, properties: { title: { title: [{ type: 'text', text: { content: title } }] } }, children: blocks })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`createPage ${res.status}: ${JSON.stringify(json).slice(0, 500)}`)
  return json
}
async function append(pageId, blocks) {
  const res = await fetch(`${API}/blocks/${pageId}/children`, {
    method: 'PATCH', headers: H, body: JSON.stringify({ children: blocks })
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`append ${res.status}: ${JSON.stringify(json).slice(0, 500)}`)
  return json
}
const files = [
  { path: '.workbuddy/reports/FS-数据清洗方案与实现-2026-08-11.md', title: '数据清洗方案与实现（FS · 2026-08-11）' },
  { path: '.workbuddy/reports/FS-数据质量多维过滤方案-2026-08-11.md', title: '数据质量多维过滤方案（含热度融合）（FS · 2026-08-11）' },
  { path: '.workbuddy/reports/FS-AI解读风格优化方案-2026-08-11.md', title: 'AI 解读风格优化方案 + 演示（FS · 2026-08-11）' }
]
for (const f of files) {
  const md = readFileSync(f.path, 'utf-8')
  let blocks = mdToBlocks(md)
  // 用首行 # 作标题，移除重复 H1
  const firstH1 = md.match(/^#\s+(.*)$/m)
  if (firstH1) blocks = blocks.filter((b) => !(b.type === 'heading_1' && b.heading_1.rich_text[0]?.text?.content === firstH1[1]))
  const page = await createPage(f.title, blocks.slice(0, 100))
  for (let k = 100; k < blocks.length; k += 100) await append(page.id, blocks.slice(k, k + 100))
  console.log(`CREATED | ${f.title} | https://www.notion.so/${page.id.replace(/-/g, '')}`)
}
console.log('ALL_DONE')
