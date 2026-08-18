// T2.4 web 抓取源实测：对 5 个 scrape 源抓列表页，
// 用 worker 通用启发式 extractListLinks 提取卡片，评估提取质量。
// 不写库，只打日志。
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { fetchWebPage, extractContentFromHtml } = require('../backend/common/contentFetcher.js')

// —— 内联 worker extractListLinks（zero-dep 复制自 backend/intelRssPoll/index.js:434）——
import { createHash } from 'crypto'
function sha256(s) { return createHash('sha256').update(String(s)).digest('hex') }

function extractListLinks(html) {
  const items = []
  const seen = new Set()
  const re = /<h([1-4])[^>]*>\s*<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h\1>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const title = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    let url = m[2].trim()
    if (!title || title.length < 4) continue
    if (!/^https?:\/\//i.test(url)) url = new URL(url, 'https://x').toString()
    const fp = sha256(url)
    if (seen.has(fp)) continue
    seen.add(fp)
    items.push({ title, url, pubDate: '', guid: url })
    if (items.length >= 15) break
  }
  return items
}

const SOURCES = [
  { id: 'anthropic_news', name: 'Anthropic News', url: 'https://www.anthropic.com/news' },
  { id: 'meta_ai_blog', name: 'Meta AI Blog', url: 'https://ai.meta.com/blog/' },
  { id: 'the_batch', name: 'The Batch', url: 'https://www.deeplearning.ai/the-batch/' },
  { id: 'the_neuron', name: 'The Neuron', url: 'https://www.theneurondaily.com/' },
  { id: 'jiqizhixin', name: '机器之心', url: 'https://www.jiqizhixin.com/' },
]

const out = {}
for (const s of SOURCES) {
  out[s.id] = { status: 'pending' }
  try {
    const html = await fetchWebPage(s.url)
    if (!html) { out[s.id] = { status: 'HTML_FAIL' }; continue }
    const len = html.length
    const cards = extractListLinks(html)
    out[s.id] = {
      status: 'OK',
      htmlLen: len,
      cardCount: cards.length,
      sample: cards.slice(0, 6).map((c) => ({ title: c.title.slice(0, 60), url: c.url.slice(0, 80) })),
      bodyPreview: extractContentFromHtml(html)?.slice(0, 120) || '(无正文)',
    }
  } catch (e) {
    out[s.id] = { status: 'ERR', err: e.message }
  }
  console.log(`\n===== ${s.id} (${s.name}) =====`)
  const o = out[s.id]
  for (const k of Object.keys(o)) console.log(`  ${k}:`, JSON.stringify(o[k], null, 1).slice(0, 500))
}
