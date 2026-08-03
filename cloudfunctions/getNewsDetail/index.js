// 获取新闻详情云函数 v5.0 — 按需抓取正文 + 多层清洗
// ============================================================
// v5.0 改造（2026-08-03）：
//   refreshNews 只缓存标题列表（不含正文），详情页用户点击时调用本函数：
//     1. 先从 news 集合查缓存（如果有 content 则直接返回）
//     2. 如果没有 content，从 sourceUrl 抓取原文 → 清洗 → 返回并缓存
//     3. 如果没有 sourceUrl，返回 title + summary
//
// 清洗流水线：newsCleaner.js（HTML 解码 → 标签移除 → 噪音过滤 → 段落规范化）
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { cleanNewsContent, validateCleanedContent } = require('./utils/newsCleaner')

// 抓取原文超时时间（需 < 3 秒云函数限制）
const FETCH_TIMEOUT_MS = 2500

/**
 * 从 URL 抓取网页 HTML
 * @param {string} url
 * @returns {Promise<string|null>}
 */
function fetchWebPage(url) {
  if (!url) return Promise.resolve(null)

  const protocol = url.startsWith('https') ? require('https') : require('http')

  return new Promise((resolve) => {
    const req = protocol.get(url, { timeout: FETCH_TIMEOUT_MS }, (res) => {
      // 只处理 200 且 HTML 类型
      const contentType = res.headers['content-type'] || ''
      if (res.statusCode !== 200 || (!contentType.includes('html') && !contentType.includes('text'))) {
        res.resume()
        resolve(null)
        return
      }

      let body = ''
      res.on('data', chunk => {
        body += chunk
        // 防止过大网页撑爆内存
        if (body.length > 500 * 1024) {
          req.destroy()
          resolve(body)
        }
      })
      res.on('end', () => resolve(body))
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
 * 从 HTML 中提取正文内容
 * 使用轻量正则 + 启发式方法（不依赖 jsdom/readability 以控制体积）
 *
 * 策略：
 *   1. 移除 script / style / iframe / nav / footer
 *   2. 找到最长文本块所在的容器
 *   3. 提取该容器内的所有文本段落
 */
function extractContentFromHtml(html) {
  if (!html) return null

  // 1. 移除不需要的标签块
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')

  // 2. 尝试提取 <article> 或常见文章容器
  const articleMatch = text.match(/<article[^>]*>([\s\S]*?)<\/article>/i)
    || text.match(/<div[^>]*class="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/<div[^>]*class="[^"]*post[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/<div[^>]*id="[^"]*article[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
    || text.match(/<div[^>]*id="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

  if (articleMatch) {
    text = articleMatch[1]
  }

  return text
}

/**
 * 补写 news 集合中的 content 字段（缓存正文，下次不再抓取）
 */
async function cacheContent(newsId, content) {
  try {
    const res = await db.collection('news').where({ id: newsId }).get()
    if (res.data && res.data.length > 0) {
      await db.collection('news').doc(res.data[0]._id).update({
        data: { content, updatedAt: Date.now() },
      })
    }
  } catch (err) {
    console.warn(`[getNewsDetail] 缓存 content 失败 [${newsId}]:`, err.message)
  }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  console.log(`[getNewsDetail] v5.0 查询 newsId=${newsId}`)

  // ── 第 1 步：查 news 集合 ──
  let doc
  try {
    const res = await db.collection('news').where({ id: newsId }).get()
    if (!res.data || res.data.length === 0) {
      return { code: -1, message: '新闻不存在或已过期', errorCode: 'NO_DATA' }
    }
    doc = res.data[0]
  } catch (e) {
    console.warn('[getNewsDetail] news 集合查询失败:', e && e.message)
    return { code: -1, message: '新闻不存在或已过期', errorCode: 'NO_DATA' }
  }

  // ── 第 2 步：如果已有 content（已抓取过），直接返回 ──
  if (doc.content && doc.content.trim().length > 30) {
    console.log(`[getNewsDetail] 命中缓存 content (${doc.content.length} 字符)`)

    // 阅读数+1（非阻塞）
    const realId = doc._id
    db.collection('news').doc(realId).update({
      data: { viewCount: _.inc(1) },
    }).catch(() => {})

    return {
      code: 0,
      data: doc,
      meta: { source: 'news_cache', engine: 'tianxing' },
    }
  }

  // ── 第 3 步：content 为空，从 sourceUrl 抓取 ──
  let finalContent = ''
  let contentSource = 'fallback'

  if (doc.sourceUrl) {
    console.log(`[getNewsDetail] 从原文抓取: ${doc.sourceUrl}`)
    try {
      const html = await fetchWebPage(doc.sourceUrl)

      if (html) {
        console.log(`[getNewsDetail] 抓取到 HTML (${html.length} 字符)`)
        const extracted = extractContentFromHtml(html)

        if (extracted) {
          const cleaned = cleanNewsContent(extracted, { maxLength: 3000 })
          const validation = validateCleanedContent(cleaned)

          if (validation.valid) {
            finalContent = cleaned
            contentSource = 'fetched_and_cleaned'
            console.log(`[getNewsDetail] 清洗完成: ${finalContent.length} 字符`)
          } else {
            console.warn(`[getNewsDetail] 清洗后内容无效: ${validation.reason}`)
          }
        } else {
          console.warn('[getNewsDetail] 未能从 HTML 提取正文')
        }
      } else {
        console.warn('[getNewsDetail] 原文抓取返回空')
      }
    } catch (err) {
      console.warn(`[getNewsDetail] 原文抓取异常:`, err.message)
    }
  }

  // ── 第 4 步：如果抓取失败，用 summary 兜底 ──
  if (!finalContent) {
    finalContent = doc.summary || doc.title || ''
    contentSource = 'summary_fallback'
    console.log('[getNewsDetail] 使用 summary 兜底')
  }

  // ── 第 5 步：补写 content 到 news 集合（下次直接命中缓存）──
  if (finalContent && contentSource !== 'fallback') {
    cacheContent(newsId, finalContent)
  }

  // ── 第 6 步：阅读数+1 + 返回 ──
  const realId = doc._id
  db.collection('news').doc(realId).update({
    data: { viewCount: _.inc(1) },
  }).catch(() => {})

  const result = {
    ...doc,
    content: finalContent,
  }

  return {
    code: 0,
    data: result,
    meta: { source: 'news', contentSource, engine: 'tianxing' },
  }
}
