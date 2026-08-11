/**
 * rssParser.js — XML/RSS/Atom → 结构化新闻项 解析器
 * ============================================================
 * 基于 fast-xml-parser（纯 JS 无原生依赖，微信云函数可直接安装）。
 * 兼容 RSS 2.0（<item>）与 Atom（<entry>）。
 * 输出统一：{ title, url, pubDate, desc, sourceName? }
 * 版权红线：只保留标题/链接/摘要信息，不存正文全文。
 * ============================================================
 */

const { XMLParser } = require('fast-xml-parser')

// 解析选项：跳过非属性字段冗余，只留实际元素；自动按需转数组
const PARSE_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,          // 保留原始字符串，避免数字/布尔误转
  parseAttributeValue: false,
  arrayMode: false,
  cdataPropName: '__cdata',      // 保留 CDATA 文本，方便提取
}

/**
 * 解析 RSS/Atom XML 文本，返回规范化新闻项数组。
 * @param {string} xmlText
 * @returns {{items: Array<{title:string,url:string,pubDate:string,desc:string}>,
 *            channelTitle:string|null, encoding:string|null}}
 */
function parse(xmlText) {
  const out = { items: [], channelTitle: null, encoding: null }
  if (!xmlText || typeof xmlText !== 'string') return out

  // 提取 XML 声明编码（提供给调用方做转码参考，但 apiFetch 已自行处理）
  const enc = /<\?xml[^>]*\sencoding\s*=\s*["']([^"']+)["']/i.exec(xmlText)
  if (enc) out.encoding = enc[1]

  let doc
  try {
    const parser = new XMLParser(PARSE_OPTIONS)
    doc = parser.parse(xmlText)
  } catch (err) {
    throw new Error(`RSS 解析失败: ${err.message}`)
  }

  const root = doc && (doc.rss || doc.feed)
  if (!root) return out

  // ── RSS 2.0 ──
  if (doc.rss) {
    const channel = doc.rss.channel
    if (!channel) return out
    out.channelTitle = channel.title ? channel.title.trim() : null
    const rawItems = toArray(channel.item)
    out.items = rawItems
      .map((it) => ({
        title: cleanStr(it.title),
        url: cleanStr(it.link),
        pubDate: cleanStr(it.pubDate || it['dc:date'] || it.date),
        desc: cleanSummary(it.description || it.summary || it['content:encoded'] || ''),
      }))
      .filter((it) => it.title && it.url)
    return out
  }

  // ── Atom ──
  if (doc.feed) {
    out.channelTitle = (doc.feed.title && doc.feed.title['#text']) || cleanStr(doc.feed.title) || null
    const rawEntries = toArray(doc.feed.entry)
    out.items = rawEntries.map((it) => {
      // Atom 的 link 是 <link href="..."/>，可能多个，取 rel=alternate 或第一个
      let url = ''
      const links = toArray(it.link)
      for (const l of links) {
        const href = (l && (l['@_href'] || l.href)) || ''
        const rel = (l && (l['@_rel'] || l.rel)) || ''
        if (!rel || rel === 'alternate') { url = href; break }
      }
      if (!url && links.length) url = (links[0]['@_href'] || links[0].href) || ''
      return {
        title: cleanStr((it.title && it.title['#text']) || it.title),
        url: cleanStr(url),
        pubDate: cleanStr(it.published || it.updated || ''),
        desc: cleanSummary((it.summary && it.summary['#text']) || it.summary || ''),
      }
    }).filter((it) => it.title && it.url)
    return out
  }

  return out
}

/** 字段可能是对象/字符串/数组，统一取首个可读字符串 */
function cleanStr(v) {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  // 对象形态（如 { '#text': '...' }）
  if (typeof v === 'object') {
    const txt = v['#text'] !== undefined ? v['#text'] : v.__cdata
    if (txt != null) return String(txt).trim()
    // 数值/其他
    for (const k of Object.keys(v)) {
      if (k.startsWith('@_')) continue
      const r = cleanStr(v[k])
      if (r) return r
    }
    return ''
  }
  return String(v).trim()
}

/** 摘要：RSS 的 description 可能带 HTML，简单去标签截断（版权红线：不作为正文） */
function cleanSummary(v) {
  const s = cleanStr(v)
  if (!s) return ''
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** 值强制转数组（元素可能单值时是对象，多值时是数组） */
function toArray(v) {
  if (v == null) return []
  return Array.isArray(v) ? v : [v]
}

module.exports = { parse, toArray, cleanStr, cleanSummary }
