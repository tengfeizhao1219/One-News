// 获取新闻详情云函数 v5.3 — 兼容 news_cache 集合（v5 只写 news_cache）
// ============================================================
// v5.3 改造（2026-08-03）：
//   v5.1 后 refreshNews 为适配 3 秒超时，只写 news_cache，不再双写 news 集合。
//   详情页点击时必须支持从 news_cache 读取（否则报"新闻不存在"）。
//   查询顺序：news 集合（历史 AI 版本遗留）→ news_cache 集合（v5 当前数据源）。
//
// v5.0 原逻辑：
//   refreshNews 只缓存标题列表（不含正文），详情页用户点击时调用本函数：
//     1. 先从集合查缓存（如果有 content 则直接返回）
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
 * 按 newsId 查找新闻文档（v5.3：news 集合 → news_cache 集合兜底）
 * @param {string} newsId  - 前端传入的 id（juhe_xxx）或数据库 _id
 * @returns {Promise<{doc: Object, collection: string}|null>}
 */
async function findNewsDoc(newsId) {
  // 1. news 集合（历史 AI 版本遗留数据）
  try {
    const res = await db.collection('news').where({ id: newsId }).get()
    if (res.data && res.data.length > 0) {
      return { doc: res.data[0], collection: 'news' }
    }
  } catch (e) {
    console.warn('[getNewsDetail] news 集合按 id 查询失败:', e && e.message)
  }

  // 2. news_cache 集合按 id（v5 当前数据源）
  try {
    const res = await db.collection('news_cache').where({ id: newsId }).get()
    if (res.data && res.data.length > 0) {
      return { doc: res.data[0], collection: 'news_cache' }
    }
  } catch (e) {
    console.warn('[getNewsDetail] news_cache 按 id 查询失败:', e && e.message)
  }

  // 3. news_cache 集合按 _id（前端可能直接传数据库 _id）
  try {
    const res = await db.collection('news_cache').doc(newsId).get()
    if (res.data && res.data._id) {
      return { doc: res.data, collection: 'news_cache' }
    }
  } catch (e) {
    // 忽略：可能不是合法 _id
  }

  return null
}

/**
 * 补写来源集合中的 content 字段（缓存正文，下次不再抓取）
 * @param {string} collection - 'news' 或 'news_cache'
 * @param {string} newsId
 * @param {string} content
 */
async function cacheContent(collection, newsId, content) {
  try {
    const res = await db.collection(collection).where({ id: newsId }).get()
    if (res.data && res.data.length > 0) {
      await db.collection(collection).doc(res.data[0]._id).update({
        data: { content, updatedAt: Date.now() },
      })
    }
  } catch (err) {
    console.warn(`[getNewsDetail] 缓存 content 失败 [${newsId}] @${collection}:`, err.message)
  }
}

/**
 * 阅读数 +1（非阻塞）
 * @param {string} collection
 * @param {string} realId  - 数据库 _id
 */
function bumpViewCount(collection, realId) {
  try {
    db.collection(collection).doc(realId).update({
      data: { viewCount: _.inc(1) },
    }).catch(() => {})
  } catch (_) {}
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  console.log(`[getNewsDetail] v5.3 查询 newsId=${newsId}`)

  // ── 第 1 步：查集合（news → news_cache）──
  let found
  try {
    found = await findNewsDoc(newsId)
  } catch (e) {
    console.warn('[getNewsDetail] 查询失败:', e && e.message)
  }

  if (!found) {
    console.warn(`[getNewsDetail] 新闻不存在: ${newsId}`)
    return { code: -1, message: '新闻不存在或已过期', errorCode: 'NO_DATA' }
  }

  const { doc, collection } = found
  console.log(`[getNewsDetail] 命中集合: ${collection}, id=${doc._id}`)

  // ── 第 2 步：如果已有 content（已抓取过），直接返回 ──
  if (doc.content && doc.content.trim().length > 30) {
    console.log(`[getNewsDetail] 命中缓存 content (${doc.content.length} 字符)`)

    // 阅读数+1（非阻塞）
    bumpViewCount(collection, doc._id)

    return {
      code: 0,
      data: doc,
      meta: { source: collection, contentSource: 'cached', engine: 'juhe' },
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

  // ── 第 5 步：补写 content 到来源集合（下次直接命中缓存）──
  if (finalContent && contentSource !== 'fallback') {
    cacheContent(collection, newsId, finalContent)
  }

  // ── 第 6 步：阅读数+1 + 返回 ──
  bumpViewCount(collection, doc._id)

  const result = {
    ...doc,
    content: finalContent,
  }

  return {
    code: 0,
    data: result,
    meta: { source: collection, contentSource, engine: 'juhe' },
  }
}
