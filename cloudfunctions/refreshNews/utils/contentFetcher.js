/**
 * 正文抓取 + AI 摘要模块（refreshNews v6 专用）
 * ============================================================
 * 60 秒超时下，refreshNews 可直接为每条新闻抓取正文并生成 AI 摘要，
 * 写入 news_cache.content + news_cache.summary，详情页直接读缓存。
 *
 * 功能：
 *   1. fetchJuheContent —— 聚合官方内容接口（/toutiao/content）
 *   2. fetchWebPage     —— 带浏览器 UA 抓网页（兜底）
 *   3. extractContentFromHtml —— 定位正文容器 + <p> 段落提取
 *   4. summarizeWithDashscope —— 阿里百炼 DeepSeek AI 摘要
 *   5. enrichNewsItem   —— 单条新闻完整补充（抓正文 + AI 摘要）
 *
 * 环境变量：JUHE_API_KEY（正文接口）、DASHSCOPE_API_KEY（AI 摘要，可选）
 * ============================================================
 */

const { cleanNewsContent, validateCleanedContent } = require('./newsCleaner')
const config = require('../config')

// 抓取超时（每条抓取需预留，整体 60s 内并行完成）
const FETCH_TIMEOUT_MS = 5000
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // 2MB

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * 从 juhe id 解析 uniquekey（id 格式：juhe_${category}_${uniquekey}）
 * @param {string} id
 * @returns {string|null}
 */
function parseJuheKey(id) {
  if (!id || typeof id !== 'string') return null
  const prefix = 'juhe_'
  if (!id.startsWith(prefix)) return null
  const first = id.indexOf('_', prefix.length)
  if (first === -1) return null
  return id.slice(first + 1) || null
}

/**
 * 调用聚合官方内容接口获取正文（POST form-urlencoded）
 * @param {string} uniquekey
 * @param {Object} [options] - { title, source } 用于清洗去重
 * @returns {Promise<string|null>}
 */
function fetchJuheContent(uniquekey, options = {}) {
  if (!config.juhe.apiKey || !uniquekey) return Promise.resolve(null)

  return new Promise((resolve) => {
    const https = require('https')
    const querystring = require('querystring')
    const postData = querystring.stringify({
      key: config.juhe.apiKey,
      uniquekey,
    })

    const req = https.request(config.juhe.contentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: FETCH_TIMEOUT_MS,
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          if (result.error_code !== 0 || !result.result || !result.result.content) {
            console.warn(`[contentFetcher] 聚合内容接口异常: error_code=${result.error_code} reason=${result.reason}`)
            resolve(null)
            return
          }
          const cleaned = cleanNewsContent(result.result.content, {
            maxLength: 3000,
            title: options.title,
            source: options.source,
          })
          const validation = validateCleanedContent(cleaned)
          if (!validation.valid) {
            console.warn(`[contentFetcher] 聚合内容清洗后无效: ${validation.reason}`)
            resolve(null)
            return
          }
          resolve(cleaned)
        } catch (e) {
          console.warn('[contentFetcher] 聚合内容接口 JSON 解析失败:', e.message)
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.write(postData)
    req.end()
  })
}

/**
 * 从 URL 抓取网页 HTML（带浏览器 UA + 跟随重定向 + 2MB 上限）
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
      // 跟随一次重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const { URL } = require('url')
        const nextUrl = new URL(res.headers.location, url).toString()
        return resolve(fetchWebPage(nextUrl))
      }
      const contentType = res.headers['content-type'] || ''
      if (res.statusCode !== 200 || (!contentType.includes('html') && !contentType.includes('text'))) {
        res.resume()
        resolve(null)
        return
      }
      const chunks = []
      let total = 0
      res.on('data', chunk => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          req.destroy()
          resolve(Buffer.concat(chunks).toString('utf8'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.end()
  })
}

/**
 * 定位正文容器
 */
function locateBodyHtml(html) {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*id=["']paragraph["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}

/**
 * 提取 <p> 段落（过滤过短噪音段）
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
 * 从 HTML 提取正文（容器 + <p> 段落，容器失败全页退化）
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
  if (paras.length < 2) {
    paras = extractParagraphs(cleaned)
  }
  if (paras.length === 0) return null
  return paras.join('\n')
}

/**
 * 网页抓取 + 清洗正文
 * @param {string} url
 * @param {Object} [options] - { title, source }
 * @returns {Promise<string|null>}
 */
async function fetchWebContent(url, options = {}) {
  try {
    const html = await fetchWebPage(url)
    if (!html) return null
    const extracted = extractContentFromHtml(html)
    if (!extracted) return null
    const cleaned = cleanNewsContent(extracted, {
      maxLength: 3000,
      title: options.title,
      source: options.source,
    })
    const validation = validateCleanedContent(cleaned)
    if (!validation.valid) return null
    return cleaned
  } catch (e) {
    console.warn('[contentFetcher] 网页抓取异常:', e.message)
    return null
  }
}

/**
 * 调用阿里百炼 DeepSeek 生成 AI 摘要
 * @param {string} content
 * @param {string} title
 * @returns {Promise<string|null>}
 */
function summarizeWithDashscope(content, title) {
  const apiKey = config.dashscope.apiKey
  if (!apiKey) {
    console.warn('[contentFetcher] DASHSCOPE_API_KEY 未配置，跳过 AI 摘要')
    return Promise.resolve(null)
  }
  if (!content || content.trim().length < 30) return Promise.resolve(null)

  const input = content.slice(0, config.dashscope.maxInputChars || 2000)
  const body = JSON.stringify({
    model: config.dashscope.model || 'deepseek-v3',
    messages: [
      {
        role: 'system',
        content: '你是新闻摘要助手。基于用户提供的新闻正文，生成 100-150 字的中文简洁摘要。要求：突出核心事件与关键信息，不重复标题，不使用"本文""据报道"等套话，直接输出摘要正文。',
      },
      {
        role: 'user',
        content: `新闻标题：${title || ''}\n\n新闻正文：\n${input}`,
      },
    ],
    max_tokens: 300,
    temperature: 0.3,
  })

  return new Promise((resolve) => {
    const https = require('https')
    const req = https.request(config.dashscope.baseUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: config.dashscope.timeout || 6000,
    }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          const r = JSON.parse(data)
          const summary = r.choices && r.choices[0] && r.choices[0].message
            ? r.choices[0].message.content.trim()
            : null
          if (!summary) {
            console.warn('[contentFetcher] AI 摘要返回空:', r.error ? r.error.message : 'unknown')
          }
          resolve(summary)
        } catch (e) {
          console.warn('[contentFetcher] AI 摘要 JSON 解析失败:', e.message)
          resolve(null)
        }
      })
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.write(body)
    req.end()
  })
}

/**
 * 单条新闻完整补充：抓正文（聚合接口 → 网页兜底）+ AI 摘要
 * @param {Object} item - 新闻列表项（含 id/title/summary/source/sourceUrl）
 * @returns {Promise<Object>} 补充后的 item（含 content、summary）
 */
async function enrichNewsItem(item) {
  let content = ''
  let contentSource = ''

  // 1. 优先聚合官方内容接口
  const juheKey = parseJuheKey(item.id)
  if (juheKey) {
    content = await fetchJuheContent(juheKey, { title: item.title, source: item.source })
    if (content) contentSource = 'juhe_content_api'
  }

  // 2. 聚合接口失败 → 网页抓取兜底
  if (!content && item.sourceUrl) {
    content = await fetchWebContent(item.sourceUrl, { title: item.title, source: item.source })
    if (content) contentSource = 'fetched_and_cleaned'
  }

  // 3. AI 摘要（有正文才生成）
  let summary = item.summary
  if (content) {
    const aiSummary = await summarizeWithDashscope(content, item.title)
    if (aiSummary) summary = aiSummary
  }

  return { ...item, content, contentSource, summary }
}

/**
 * 批量补充正文 + AI 摘要（控制并发，避免打爆外部 API）
 * @param {Array<Object>} items
 * @param {number} [concurrency=8]
 * @returns {Promise<Array<Object>>}
 */
async function enrichNewsList(items, concurrency = 8) {
  const results = []
  const queue = [...items]

  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift()
      try {
        const enriched = await enrichNewsItem(item)
        results.push(enriched)
      } catch (e) {
        console.warn(`[contentFetcher] enrich 失败 [${item.id}]:`, e.message)
        results.push(item) // 保底：保留未 enrich 的 item
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

module.exports = {
  parseJuheKey,
  fetchJuheContent,
  fetchWebPage,
  extractContentFromHtml,
  fetchWebContent,
  summarizeWithDashscope,
  enrichNewsItem,
  enrichNewsList,
}
