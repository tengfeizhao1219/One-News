/**
 * contentFetcher.js — 官网正文抓取（T1.3 / I 基础设施）
 * ============================================================
 * ⚠️ 复用 One News common/contentFetcher.js 的零依赖部分（非其业务），
 *    intel_ 命名空间隔离，可整体摘除。本文件仅为「官网正文抓取」能力，
 *    不含 LLM（Phase 3 intelProcess 负责）、不含聚合 key 依赖（fetchJuheContent 等）。
 *
 * 从 One News 复制的能力（函数体保持一致）：
 *   fetchWebPage（UA + 跟随重定向 + 2MB 上限 + GBK 解码）
 *   extractContentFromHtml / locateBodyHtml / trimExtraneousContent / extractParagraphs
 *   isInvalidDesc / isValidParagraph（假摘要检测）
 *
 * 用法：ScrapeAdapter（Anthropic/Meta/The Batch/The Neuron/机器之心）直接调用，
 *   fetchWebPage(url) → HTML → extractContentFromHtml(html) → 正文纯文本。
 * ============================================================
 */

// 抓取超时（intelRssPoll 单源预算 5–15s；单页抓取给 6s，适配 60s 硬超时）
const FETCH_TIMEOUT_MS = 6000
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // 2MB

// 浏览器 UA（避免反爬）
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * 从 Buffer 检测编码并转码为 UTF-8（修复 GBK/GB2312 旧站正文乱码，如央视网 www.cctv.com）。
 * HTML 不像 XML 有顶层 encoding 声明，故优先扫 <meta charset> / <meta http-equiv=content-type>，
 * 其次信任响应头 content-type 的 charset；均无声明时兜底 UTF-8。
 */
function decodeBuffer(buffer, declaredEncoding) {
  const buf = Buffer.from(buffer)
  // 1) BOM 优先
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8')
  }
  // 2) 从 HTML <head> 前 1024 字节探测 charset（meta 声明优先于响应头）
  const head = buf.slice(0, 1024).toString('latin1')
  let enc = declaredEncoding || ''
  if (!enc) {
    const m1 = /<meta[^>]+charset\s*=\s*["']?\s*([a-z0-9-]+)/i.exec(head)
    if (m1) enc = m1[1]
    else {
      const m2 = /<meta[^>]+http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([a-z0-9-]+)/i.exec(head)
      if (m2) enc = m2[1]
    }
  }
  const canonical = (enc || '').toLowerCase().replace(/[-_]/g, '')
  if (canonical && canonical !== 'utf8') {
    try {
      if (canonical === 'gbk' || canonical === 'gb2312' || canonical === 'gb18030') {
        if (typeof TextDecoder !== 'undefined') return new TextDecoder('gbk').decode(buf)
        try { const iconv = require('iconv-lite'); return iconv.decode(buf, 'gbk') } catch (e) { /* 回退 UTF-8 */ }
      }
      if (typeof TextDecoder !== 'undefined') {
        try { const td = new TextDecoder(canonical); if (td.encoding !== 'utf-8') return td.decode(buf) } catch (e) { /* 回退 UTF-8 */ }
      }
    } catch (e) { /* 回退 UTF-8 */ }
  }
  return buf.toString('utf8')
}

/**
 * 从 URL 抓取网页 HTML（带 UA / Accept 头 + 跟随重定向 + 2MB 上限）
 * @param {string} url
 * @returns {Promise<string|null>}
 */
function fetchWebPage(url) {
  if (!url) return Promise.resolve(null)

  const protocol = url.startsWith('https') ? require('https') : require('http')

  return new Promise((resolve) => {
    const req = protocol.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    }, (res) => {
      // 跟随一次重定向（301/302）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        return resolve(fetchWebPage(nextUrl))
      }

      const contentType = res.headers['content-type'] || ''
      if (res.statusCode !== 200 || (!contentType.includes('html') && !contentType.includes('text'))) {
        res.resume()
        resolve(null)
        return
      }

      // 提取响应头声明的 charset（GBK 等旧站常缺，decodeBuffer 会再扫 meta 兜底）
      const charsetMatch = /charset\s*=\s*([a-z0-9-]+)/i.exec(contentType)
      const declaredEncoding = charsetMatch ? charsetMatch[1] : ''

      const chunks = []
      let total = 0
      res.on('data', chunk => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          req.destroy()
          resolve(decodeBuffer(Buffer.concat(chunks), declaredEncoding))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(decodeBuffer(Buffer.concat(chunks), declaredEncoding)))
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })

    req.end()
  })
}

/**
 * 定位正文容器（严格限定，避免延伸阅读/相关推荐混入）
 */
function locateBodyHtml(html) {
  const patterns = [
    // 中新网（chinanews.com.cn）正文容器
    /<div[^>]*class=["'][^"']*content_maincontent_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 优先：严格语义标签
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    // IT之家 / 聚合数据 特定容器
    /<div[^>]*id=["']paragraph["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    // 更严格的 class 匹配：只取 article-content 而非 article-*
    /<div[^>]*class=["']article-content["'][^>]*>([\s\S]*?)<\/div>/i,
    // 兜底：更宽松的 article 类容器（排最后，仅在前述全部失败时使用）
    /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) {
      // 在容器内截断"延伸阅读/相关推荐"之后的全部内容
      return trimExtraneousContent(m[1])
    }
  }
  return null
}

/**
 * 截断正文容器内"延伸阅读/相关推荐"及之后的内容
 * 解决 IT之家等来源正文末尾混入其他新闻段落的问题
 */
function trimExtraneousContent(html) {
  if (!html) return null
  // 匹配"延伸阅读""相关推荐""推荐阅读"等区域标记（含 HTML 标签包裹形态）
  const cutoffPatterns = [
    /<[^>]*class=["'][^"']*(?:related|recommend|extend|extra)[^"']*["'][^>]*>/i,
    /(?:延伸阅读|相关推荐|推荐阅读|相关新闻|热门推荐|猜你喜欢|更多阅读)[：:]/i,
    /<h\d[^>]*>(?:延伸阅读|相关推荐|推荐阅读|相关新闻)[\s\S]*?<\/h\d>/i,
    // IT之家: "广告声明：文内含有的对外跳转链接..." 之后的内容
    /广告声明[：:][\s\S]*?(?:链接|二维码|口令)/i,
  ]
  for (const pattern of cutoffPatterns) {
    const idx = html.search(pattern)
    if (idx > 100) { // 只在正文足够长（>100字符）时才截断，避免误伤短正文
      return html.slice(0, idx).trim()
    }
  }
  return html
}

/**
 * 提取 <p> 段落（过滤过短噪音）
 */
function extractParagraphs(containerHtml) {
  if (!containerHtml) return []
  const paras = []
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = pRe.exec(containerHtml)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length >= 15) paras.push(text)
  }
  return paras
}

/**
 * 从 HTML 提取正文纯文本
 */
function extractContentFromHtml(html) {
  if (!html) return null
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
  let paras = extractParagraphs(locateBodyHtml(cleaned))
  if (paras.length < 2) paras = extractParagraphs(cleaned)
  if (paras.length === 0) return null
  return paras.join('\n')
}

/**
 * 判定"假 desc/摘要"（复用 One News FS-05 v2 规则，非其业务）
 * 聚合接口常返回日期/来源名/几个标点，长度可能 20-50 字符，原 `summary === title` 漏判。
 * 严格规则：空 / 等于标题 / 长度<20 / 剥数字标点后中文<5 / 等于来源名 → 一律视为无效。
 * @param {string} s
 * @param {object} ctx - { title, source }
 * @returns {boolean}
 */
function isInvalidDesc(s, ctx) {
  if (!s) return true
  if (ctx && ctx.title && s === ctx.title) return true
  if (s.length < 20) return true
  // 剥数字/标点/空白/常见日期字符后,剩余中文 < 5 → 视为日期/标点
  const stripped = s.replace(/[\d\s\-/:.\u3000,，。、年月日时分秒]+/g, '')
  if (stripped.length < 5) return true
  if (ctx && ctx.source && s === ctx.source) return true
  return false
}

/**
 * 首段二次校验（content 兜底用）= 假 desc 反义
 */
function isValidParagraph(s, ctx) {
  return !isInvalidDesc(s, ctx)
}

module.exports = {
  fetchWebPage,
  extractContentFromHtml,
  locateBodyHtml,
  decodeBuffer,
  isInvalidDesc,
  isValidParagraph,
}
