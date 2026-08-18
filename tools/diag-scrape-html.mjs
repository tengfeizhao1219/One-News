// 诊断 5 个 scrape 源的真实 HTML 结构：提取所有 <a href> 候选链接 + 就近标题文本，打印前 N 个
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { fetchWebPage } = require('../backend/common/contentFetcher.js')

const SOURCES = [
  { id: 'anthropic_news', name: 'Anthropic News', url: 'https://www.anthropic.com/news' },
  { id: 'the_batch', name: 'The Batch', url: 'https://www.deeplearning.ai/the-batch/' },
  { id: 'jiqizhixin', name: '机器之心', url: 'https://www.jiqizhixin.com/' },
  { id: 'meta_ai_blog', name: 'Meta AI Blog', url: 'https://ai.meta.com/blog/' },
  { id: 'the_neuron', name: 'The Neuron', url: 'https://www.theneurondaily.com/' },
]

function stripTags(s) { return String(s||'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim() }

for (const s of SOURCES) {
  console.log(`\n========== ${s.id} (${s.name}) ${s.url} ==========`)
  let html = null
  try { html = await fetchWebPage(s.url) } catch(e) { console.log('  THREW', e.message); continue }
  if (!html) { console.log('  HTML NULL (抓取失败)'); continue }
  console.log(`  htmlLen=${html.length}`)
  // 提取所有 <a href="..."> 带锚文本的候选
  const links = []
  const re = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi
  let m
  while ((m = re.exec(html)) !== null) {
    let href = m[1]
    // 跳过纯锚点/脚本/外部杂项
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue
    if (href.startsWith('/')) href = new URL(href, s.url).toString()
    if (!/^https?:\/\//i.test(href)) continue
    const text = stripTags(m[2])
    if (text.length < 3) continue
    links.push({ text: text.slice(0, 80), href: href.slice(0, 100) })
  }
  // 去重按 href
  const seen = new Set(); const uniq = []
  for (const l of links) { const k=l.href; if(seen.has(k))continue; seen.add(k); uniq.push(l) }
  console.log(`  候选链接数=${uniq.length}`)
  console.log('  —— 链接URL特征（按路径分组统计）——')
  const pathStat = {}
  for (const l of uniq) {
    let p
    try { p = new URL(l.href).pathname } catch(e) { p = l.href }
    const seg = p.split('/').filter(Boolean).slice(0,3).join('/')
    pathStat[seg] = (pathStat[seg]||0)+1
  }
  console.log(Object.entries(pathStat).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`      ${v}x /${k}`).join('\n'))
  console.log('  —— 示例（前 12 条，含图片缩略图省略）——')
  for (const l of uniq.slice(0,12)) console.log(`    [${l.text}] -> ${l.href}`)
}
