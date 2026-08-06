/**
 * 新闻正文抓取模块（refreshNews 专用，v5.8）
 * ============================================================
 * 背景：refreshNews 超时改为 60s 后，可以在刷新时就抓取新闻正文，
 *       用户打开详情页直接命中 content，无需实时抓取。
 *
 * 优先级：聚合官方内容接口（/toutiao/content）→ 网页抓取（带 UA）→ 空
 *
 * 依赖：newsCleaner.js（清洗）、config.js（JUHE_API_KEY）
 * ============================================================
 */

const { cleanNewsContent, validateCleanedContent } = require('./newsCleaner')
const config = require('../config')

// 抓取超时（refreshNews 有 60s 预算，单条抓取给 6s）
const FETCH_TIMEOUT_MS = 6000
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // 2MB
// B-14: 单条 enrich 总超时兜底（12s）——网页抓取 + AI 摘要合计不超过此值，防拖慢 worker 池/首屏
const ITEM_TIMEOUT_MS = 12000
// DG-03（owner 16:24 诉求「尽量返回原文」）：智谱源原文优先尝试参数
const FETCH_TRY_MS = 6000          // 原文抓取短超时（6s，防拖慢智谱源刷新）
const FETCH_TRY_THRESHOLD = 800    // AI 生成正文 < 800 字才尝试抓原文（长的已够用，省时）

// 浏览器 UA（避免反爬）
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

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
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })

    req.end()
  })
}

/**
 * 定位正文容器（v6.3: 严格限定，避免延伸阅读/相关推荐混入）
 */
function locateBodyHtml(html) {
  const patterns = [
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
      // v6.3(V5-FS-02-⑥): 在容器内截断"延伸阅读/相关推荐"之后的全部内容
      return trimExtraneousContent(m[1])
    }
  }
  return null
}

/**
 * v6.3(V5-FS-02-⑥): 截断正文容器内"延伸阅读/相关推荐"及之后的内容
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
 * 从 juhe id 解析 uniquekey
 * id 格式：juhe_${category}_${uniquekey}
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
 * 调用聚合官方内容接口获取正文
 * @param {string} uniquekey
 * @param {Object} [options] - { title, source } 供清洗去重
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
      // B-14: HTTP 状态码非 2xx 直接降级
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        resolve(null)
        return
      }

      let body = ''
      // B-14: 响应体大小上限（8MB），防异常大响应拖垮内存
      const MAX_BODY_BYTES = 8 * 1024 * 1024
      let bytes = 0
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) {
          req.destroy()
          resolve(null)
          return
        }
        body += chunk
      })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          // B-11: error_code 兼容字符串/数字（聚合接口偶发返回字符串 "0"）
          if (Number(result.error_code) !== 0 || !result.result || !result.result.content) {
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
            resolve(null)
            return
          }
          resolve(cleaned)
        } catch (e) {
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
 * 为单条新闻获取正文（聚合官方接口 → 网页抓取 → 空）
 * @param {Object} item - { id, title, source, sourceUrl }
 * @returns {Promise<string>} 清洗后的正文；失败返回 ''
 */
async function fetchContentForItem(item) {
  // 1. 聚合官方内容接口
  const juheKey = parseJuheKey(item.id)
  if (juheKey) {
    const juheContent = await fetchJuheContent(juheKey, { title: item.title, source: item.source })
    if (juheContent) return juheContent
  }

  // 2. 网页抓取
  if (item.sourceUrl) {
    try {
      const html = await fetchWebPage(item.sourceUrl)
      if (html) {
        const extracted = extractContentFromHtml(html)
        if (extracted) {
          const cleaned = cleanNewsContent(extracted, {
            maxLength: 3000,
            title: item.title,
            source: item.source,
          })
          const validation = validateCleanedContent(cleaned)
          if (validation.valid) return cleaned
        }
      }
    } catch (err) {
      // 忽略单条抓取失败
    }
  }

  return ''
}

module.exports = {
  enrichNewsList,
  fetchContentForItem,
  fetchJuheContent,
  fetchWebPage,
  extractContentFromHtml,
  parseJuheKey,
  summarizeWithZhipu,
}

/**
 * 调用智谱 GLM-4-Flash 生成新闻摘要（v6.2：从百炼 DashScope 切换为智谱）
 * 未配置 ZHIPU_API_KEY 时返回 null。
 * 正文长度门槛降至 10 字（v6.2：提高 AI 摘要覆盖率）。
 * @param {string} content - 清洗后的正文
 * @param {string} title   - 新闻标题
 * @returns {Promise<string|null>} 100-300 字中文摘要
 */
function summarizeWithZhipu(content, title) {
    // config 模块级引用（顶部 require ../config）
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
            content: '你是新闻摘要助手。基于用户提供的新闻正文，生成 100-300 字的中文摘要。要求：突出核心事件、关键信息与各方反应，不重复标题，不使用"本文""据报道"等套话，直接输出摘要正文。',
          },
          {
            role: 'user',
            content: `新闻标题：${title || ''}\n\n新闻正文：\n${input}`,
          },
        ],
        max_tokens: 600,  // DG-10: 300→600，100-300 字摘要（中文 ~2 token/字）
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
          if (summary && summary.length >= 30) { resolve(summary); return }
          if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt)))
        }
        console.warn(`[summarize] ${eng.name} 摘要失败，尝试下一引擎`)
        tryEngine(idx + 1).then(resolve)
      })()
    })
  }
  return tryEngine(0)
}

// v6.2：保留旧函数名兼容（contentFetcher 内部已改用 summarizeWithZhipu）
// 外部 getNewsDetail 可能仍引用旧名，保留别名
const summarizeWithDashscope = summarizeWithZhipu

/**
 * 批量 enrich：抓正文 + AI 摘要（并发控制）
 * v6.1：为每条记录标记 summarySource（'ai' | 'desc' | 'title'），供前端判断是否 AI 摘要。
 * v6.5：新增 skipFetch 参数——智谱 AI 搜索返回的新闻自带 content，跳过网页抓取。
 * v6.6：新增 skipAiSummary 参数——智谱 prompt 已内联 summary（AI 来源），跳过二次 AI 摘要。
 * B-14：并发数从 config.rateLimit 读取（可调），并为单条处理加超时兜底——
 *        避免单条慢请求（网页抓取/AI 摘要）拖垮整个 worker 池、拖慢首屏。
 * @param {Array<Object>} newsList - 待处理新闻列表
 * @param {number} [concurrency] - 并发数（控制外部 API 压力；缺省读 config.rateLimit.enrichConcurrency，默认 8）
 * @param {boolean} [skipFetch=false] - 是否跳过网页抓取（智谱已自带正文）
 * @param {boolean} [skipAiSummary=false] - 是否跳过 AI 摘要生成（智谱已内联 summary）
 * @param {number} [deadline=0] - P0-2：enrich 阶段硬期限（毫秒时间戳，0=不限制）。
 *   剩余预算不足时优先保「正文抓取」（详情页缓存命中依赖 content），跳过 AI 摘要；
 *   剩余 <3s 时不再启动新条目，确保整函数 60s 内必有写入。
 * @returns {Promise<Array<Object>>} 每项追加 content / 更新 summary / 标记 summarySource
 */
async function enrichNewsList(newsList, concurrency, skipFetch = false, skipAiSummary = false, deadline = 0) {
  // B-14: 并发数可配置（默认 8，防外部 API 压力 + 拖慢首屏）
  if (!concurrency || concurrency < 1) {
    concurrency = (config.rateLimit && config.rateLimit.enrichConcurrency) || 8
  }
  const result = new Array(newsList.length)
  let cursor = 0

  async function worker() {
    while (cursor < newsList.length) {
      // P0-2：剩余预算 < 3s 不再启动新条目（保写入，防整函数 60s 超时 0 写入）
      if (deadline && Date.now() + 3000 > deadline) break
      const idx = cursor++
      const item = newsList[idx]
      try {
        // 1. 抓正文
        // DG-03 增强（owner 16:24 诉求「尽量返回原文」）：
        //   - skipFetch=true（智谱源）：AI 生成正文 < 800 字时，并行尝试抓 sourceUrl 原文
        //     （短超时 FETCH_TRY_MS=6s）；抓到更长原文（≥200 字）→ 覆盖；失败/超时/更短 → 保留 AI 正文（零损失）
        //   - skipFetch=false（聚合/天行源）：原有网页抓取（12s 超时）
        let content
        if (skipFetch) {
          const aiContent = item.content || ''
          content = aiContent
          if (item.sourceUrl && aiContent.length < FETCH_TRY_THRESHOLD) {
            const fetched = await Promise.race([
              fetchContentForItem(item),
              new Promise(resolve => setTimeout(() => resolve(''), FETCH_TRY_MS)),
            ])
            if (fetched && fetched.length >= 200 && fetched.length > aiContent.length) {
              content = fetched
            }
          }
        } else {
          content = await Promise.race([
            fetchContentForItem(item),
            new Promise(resolve => setTimeout(() => resolve(''), ITEM_TIMEOUT_MS)),
          ])
        }
        const enriched = { ...item, content }

        // 2. 判断原始 summary 来源（description 或标题兜底）
        const rawSummary = (item.summary || '').trim()
        let summarySource = (!rawSummary || rawSummary === item.title) ? 'title' : 'desc'

        // 3. AI 摘要（v6.6：skipAiSummary 时跳过——智谱已内联 summary，标记为 'ai'）
        if (skipAiSummary) {
          // 智谱 prompt 已内联 summary，且经过 AI 生成 → 标记为 'ai'
          if (rawSummary && rawSummary.length >= 20 && rawSummary !== item.title) {
            summarySource = 'ai'
          }
        } else if (content && content.length > 10) {
          // P0-2：剩余预算不足跑摘要（<8s）→ 跳过 AI 摘要，保留 content（详情页优先正文，摘要仅列表展示用）
          if (!deadline || Date.now() + 8000 <= deadline) {
            // B-14: AI 摘要同样加超时兜底（12s）
            const aiSummary = await Promise.race([
              summarizeWithZhipu(content, item.title),
              new Promise(resolve => setTimeout(() => resolve(null), ITEM_TIMEOUT_MS)),
            ])
            if (aiSummary && aiSummary.length >= 30) {
              enriched.summary = aiSummary
              summarySource = 'ai'
            }
          } else {
            console.warn(`[enrich] ${item.id || ''} 预算不足跳过 AI 摘要（保留 content，summarySource=${summarySource}）`)
          }
        }

        enriched.summarySource = summarySource
        result[idx] = enriched
      } catch (err) {
        result[idx] = { ...item, summarySource: 'title' } // 失败保留原样
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, newsList.length) }, () => worker())
  await Promise.all(workers)
  return result
}
