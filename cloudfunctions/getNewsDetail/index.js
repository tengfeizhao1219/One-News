// 获取新闻详情云函数 v6.2 — 聚合正文 + AI 摘要（智谱 GLM-4-Flash）+ 内容清洗
// ============================================================
// v5.6 改造（2026-08-03）：
//   抓取到正文后调用智谱 GLM-4-Flash 生成 100-150 字摘要，
//   写回 news_cache 的 summary 字段（下次列表刷新即展示高质量摘要）。
//   未配置 ZHIPU_API_KEY 或调用失败时保持原 summary，不影响主流程。
//
// v5.5 改造（2026-08-03）：
//   详情页正文清洗增强：去除标题重复段、元信息行（时间+来源）、仅含来源段落。
//   cleanNewsContent 新增 options.title / options.source。
//
// v5.4 改造（2026-08-03）：
//   详情页正文获取优先级：聚合官方内容接口（/toutiao/content，稳定无反爬）
//   → 网页抓取（带 UA + 重定向 + <p> 段落提取）→ summary 兜底。
//   解决：v5.3 网页裸抓被反爬拦截 → 详情页只显示标题兜底。
//
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

const { cleanNewsContent, validateCleanedContent, cleanTitle } = require('./utils/newsCleaner')

// 抓取原文超时时间（需 < 3 秒云函数限制）
const FETCH_TIMEOUT_MS = 2500
// 单次抓取最大字节数（防止异常大页面拖垮云函数）
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // 2MB

// 浏览器 UA（模拟真实浏览器，避免新闻站反爬拦截无 UA 的数据中心请求）
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * 从 URL 抓取网页 HTML（v5.4：加 UA / Accept 头 + 跟随重定向 + 2MB 上限）
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

      // 只处理 200 且 HTML 类型
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
        // 防止过大网页撑爆内存
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
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })

    req.end()
  })
}

/**
 * 从 HTML 中定位正文容器（优先语义标签，其次常见 class/id）
 * v6.3(V5-FS-02-⑥): 严格限定容器并截断延伸阅读/相关推荐
 * @param {string} html
 * @returns {string|null} 容器 HTML
 */
function locateBodyHtml(html) {
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*id=["']paragraph["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["']article-content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) return trimExtraneousContent(m[1])
  }
  return null
}

/**
 * v6.3(V5-FS-02-⑥): 截断正文容器内"延伸阅读/相关推荐"及之后的内容
 */
function trimExtraneousContent(html) {
  if (!html) return null
  const cutoffPatterns = [
    /<[^>]*class=["'][^"']*(?:related|recommend|extend|extra)[^"']*["'][^>]*>/i,
    /(?:延伸阅读|相关推荐|推荐阅读|相关新闻|热门推荐|猜你喜欢|更多阅读)[：:]/i,
    /<h\d[^>]*>(?:延伸阅读|相关推荐|推荐阅读|相关新闻)[\s\S]*?<\/h\d>/i,
    /广告声明[：:][\s\S]*?(?:链接|二维码|口令)/i,
  ]
  for (const pattern of cutoffPatterns) {
    const idx = html.search(pattern)
    if (idx > 100) {
      return html.slice(0, idx).trim()
    }
  }
  return html
}

/**
 * 从一段 HTML 中提取 <p> 文本段落（过滤过短噪音段落）
 * @param {string|null} containerHtml
 * @returns {string[]}
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
    // 过滤过短段落（导航/图片说明）
    if (text.length >= 15) paras.push(text)
  }
  return paras
}

/**
 * 从 HTML 中提取正文纯文本（v5.4：容器 + <p> 段落提取，兼容全页退化）
 * @param {string} html
 * @returns {string|null}
 */
function extractContentFromHtml(html) {
  if (!html) return null

  // 1. 移除噪音标签块
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

  // 2. 优先定位正文容器提取 <p>；容器提取不到 → 退化为全页 <p> 提取
  let paras = extractParagraphs(locateBodyHtml(cleaned))
  if (paras.length < 2) {
    paras = extractParagraphs(cleaned)
  }

  // 3. 合并成正文
  if (paras.length === 0) return null
  return paras.join('\n')
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
 * 通用缓存写入：补写任意字段到 news/news_cache 集合
 * @param {string} collection
 * @param {string} newsId
 * @param {Object} fields - 要写入的字段，如 { content, summary }
 */
async function cacheDoc(collection, newsId, fields) {
  try {
    const res = await db.collection(collection).where({ id: newsId }).get()
    if (res.data && res.data.length > 0) {
      await db.collection(collection).doc(res.data[0]._id).update({
        data: { ...fields, updatedAt: Date.now() },
      })
    }
  } catch (err) {
    console.warn(`[getNewsDetail] 缓存写入失败 [${newsId}] @${collection}:`, err.message)
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

// 聚合内容接口地址（v5.4：官方正文接口，比抓第三方网页稳定）
const JUHE_CONTENT_URL = 'https://v.juhe.cn/toutiao/content'

/**
 * 从 juhe id 解析 uniquekey
 * id 格式：juhe_${category}_${uniquekey}，例如 juhe_recommend_83d955608f4b0608abbfc1c1b785942a
 * @param {string} id
 * @returns {string|null}
 */
function parseJuheKey(id) {
  if (!id || typeof id !== 'string') return null
  const prefix = 'juhe_'
  if (!id.startsWith(prefix)) return null
  // 找到 category 后的第一个下划线
  const first = id.indexOf('_', prefix.length)
  if (first === -1) return null
  const key = id.slice(first + 1)
  return key || null
}

/**
 * 调用聚合官方内容接口获取正文（POST form-urlencoded）
 * @param {string} uniquekey
 * @returns {Promise<string|null>} 清洗后的正文纯文本
 */
function fetchJuheContent(uniquekey, options = {}) {
  const config = require('./config')
  if (!config.juhe.apiKey || !uniquekey) return Promise.resolve(null)

  return new Promise((resolve) => {
    const https = require('https')
    const querystring = require('querystring')
    const postData = querystring.stringify({
      key: config.juhe.apiKey,
      uniquekey,
    })

    const req = https.request(JUHE_CONTENT_URL, {
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
          // B-11: error_code 兼容字符串/数字（聚合接口偶发返回字符串 "0"）
          if (Number(result.error_code) !== 0 || !result.result || !result.result.content) {
            console.warn(`[getNewsDetail] 聚合内容接口异常: error_code=${result.error_code} reason=${result.reason}`)
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
            console.warn(`[getNewsDetail] 聚合内容清洗后无效: ${validation.reason}`)
            resolve(null)
            return
          }
          resolve(cleaned)
        } catch (e) {
          console.warn('[getNewsDetail] 聚合内容接口 JSON 解析失败:', e.message)
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
 * 调用智谱 GLM-4-Flash 生成新闻摘要（v6.2）
 * 未配置 ZHIPU_API_KEY 时返回 null，调用方保持原 summary。
 * @param {string} content - 清洗后的正文
 * @param {string} title   - 新闻标题
 * @returns {Promise<string|null>} 100-150 字中文摘要
 */
function summarizeWithZhipu(content, title) {
    const config = require('./config')
  // DG-03（2026-08-06）：双引擎摘要 —— 智谱（ZHIPU_API_KEY）优先，通义 Qwen（DASHSCOPE_API_KEY）兜底
  const engines = []
  const zhipuCfg = (config.zhipuSummary || {})
  if (zhipuCfg.apiKey) {
    engines.push({ name: '智谱', apiKey: zhipuCfg.apiKey, baseUrl: zhipuCfg.baseUrl, model: zhipuCfg.model || 'glm-4-flash', timeout: zhipuCfg.timeout || 8000 })
  }
  const dashKey = process.env.DASHSCOPE_API_KEY || (config.qwen && config.qwen.apiKey) || ''
  if (dashKey) {
    engines.push({ name: 'Qwen', apiKey: dashKey, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: (config.qwen && config.qwen.model) || 'qwen-turbo', timeout: 8000 })
  }
  if (engines.length === 0) {
    console.warn('[summarize] 未配置 AI 摘要 Key（ZHIPU/DASHSCOPE），跳过 AI 摘要')
    return Promise.resolve(null)
  }
  // 正文门槛 10 字（提高 AI 摘要覆盖率）
  if (!content || content.trim().length < 10) return Promise.resolve(null)
  const input = content.slice(0, (zhipuCfg.maxInputChars) || 2000)

  // 顺序尝试各引擎（智谱 → Qwen），每引擎最多 3 次尝试（指数退避 500ms/1500ms）
  function tryEngine(idx) {
    return new Promise((resolve) => {
      if (idx >= engines.length) { resolve(null); return }
      const eng = engines[idx]
      const body = JSON.stringify({
        model: eng.model,
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
      const doRequest = () => new Promise((r) => {
        const https = require('https')
        const url = new URL(eng.baseUrl)
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${eng.apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: eng.timeout,
        }, (res) => {
          let data = ''
          res.on('data', chunk => { data += chunk })
          res.on('end', () => {
            try {
              const resp = JSON.parse(data)
              const summary = resp.choices && resp.choices[0] && resp.choices[0].message
                ? resp.choices[0].message.content.trim()
                : null
              r(summary)
            } catch (e) { r(null) }
          })
        })
        req.on('error', () => r(null))
        req.on('timeout', () => { req.destroy(); r(null) })
        req.write(body)
        req.end()
      })
      ;(async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          const summary = await doRequest()
          if (summary && summary.length >= 20) { resolve(summary); return }
          if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt)))
        }
        console.warn(`[summarize] ${eng.name} 摘要失败，尝试下一引擎`)
        tryEngine(idx + 1).then(resolve)
      })()
    })
  }
  return tryEngine(0)
}

// v6.2：保留旧函数名兼容
function summarizeWithDashscope(content, title) {
  return summarizeWithZhipu(content, title)
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  console.log(`[getNewsDetail] v5.6 查询 newsId=${newsId}`)

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
  // 兜底清洗标题（防御数据库中历史脏数据含 HTML 实体）
  doc.title = cleanTitle(doc.title || '')
  console.log(`[getNewsDetail] 命中集合: ${collection}, id=${doc._id}`)

  // ── 第 2 步：如果已有足够长的 content，直接返回 ──
  // DG-03（owner 16:24 诉求「尽量返回原文」）：阈值 30 → 200 字——
  // content 过短（如旧数据/抓取失败回退的摘要）时继续第 3 步尝试抓 sourceUrl 原文
  if (doc.content && doc.content.trim().length > 200) {
    console.log(`[getNewsDetail] 命中缓存 content (${doc.content.length} 字符)`)

    // 阅读数+1（非阻塞）
    bumpViewCount(collection, doc._id)

    return {
      code: 0,
      data: doc,
      meta: { source: collection, contentSource: 'cached', engine: 'juhe' },
    }
  }

  // ── 第 3 步：content 为空，获取正文（v5.4 优先级：聚合官方接口 → 网页抓取 → summary）──
  let finalContent = ''
  let contentSource = 'fallback'

  // 3a. 优先：聚合官方内容接口（id 为 juhe_xxx 时解析 uniquekey）
  const juheKey = parseJuheKey(newsId)
  if (juheKey) {
    console.log(`[getNewsDetail] 聚合内容接口查询 uniquekey=${juheKey}`)
    const juheContent = await fetchJuheContent(juheKey, { title: doc.title, source: doc.source })
    if (juheContent) {
      finalContent = juheContent
      contentSource = 'juhe_content_api'
      console.log(`[getNewsDetail] 聚合内容接口成功: ${finalContent.length} 字符`)
    } else {
      console.warn('[getNewsDetail] 聚合内容接口失败，尝试网页抓取')
    }
  }

  // 3b. 次选：网页抓取 sourceUrl
  if (!finalContent && doc.sourceUrl) {
    console.log(`[getNewsDetail] 从原文抓取: ${doc.sourceUrl}`)
    try {
      const html = await fetchWebPage(doc.sourceUrl)

      if (html) {
        console.log(`[getNewsDetail] 抓取到 HTML (${html.length} 字符)`)
        const extracted = extractContentFromHtml(html)

        if (extracted) {
          const cleaned = cleanNewsContent(extracted, {
            maxLength: 3000,
            title: doc.title,
            source: doc.source,
          })
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
  // DG-08（2026-08-06）性能优化：AI 摘要移出详情关键路径。
  // 此前 await summarizeWithZhipu 在每次缓存未命中时阻塞返回（LLM 往返 0.5~3s），
  // 是「进入详情/翻页 ~1s」的主因之一。详情页只展示 content，不需要 summary；
  // summary 统一由 refreshNews 列表刷新时生成。这里仅回写 content，不再生成摘要。
  if (finalContent && contentSource !== 'fallback') {
    await cacheDoc(collection, newsId, { content: finalContent })
  }

  // ── 第 6 步：阅读数+1 + 返回 ──
  bumpViewCount(collection, doc._id)

  const result = {
    ...doc,
    content: finalContent,
    summary: doc.summary || doc.title || '',
    contentSource: doc.contentSource || contentSource,  // 优先 DB 中的值，兜底按需抓取的类型
  }

  return {
    code: 0,
    data: result,
    meta: { source: collection, contentSource, engine: 'juhe' },
  }
}
