/**
 * 智谱 GLM-4-Flash 联网搜索模块（L1 主力数据源）
 *
 * 通过智谱 API 的 web_search 工具能力，让大模型联网搜索最新新闻，
 * 返回结构化 JSON。永久免费 + 2000万 token 额度。
 *
 * API 文档：https://open.bigmodel.cn/dev/api/normal-model/glm-4
 *
 * 降级：智谱失败时自动切换到 DeepSeek API（通过 deepseekSearch）
 *
 * B-12 限流/退避策略（2026-08-01）：
 *   策略1: 分类间调用间隔（minCallGapMs）
 *   策略2: 429 限流识别（API_RATE_LIMIT 错误码）
 *   策略3: 指数退避 + jitter（限流时重试 ≤3 次）
 *   策略4: DeepSeek 预算熔断（deepseekDailyCap）
 *   策略6: 智谱调用量监控（system_kv 计数）
 */

const https = require('https')
const config = require('./config')

// ─── 智谱 API 配置 ──────────────────────────────────

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || config.zhipu?.apiKey || ''
const ZHIPU_BASE = 'open.bigmodel.cn'
const ZHIPU_PATH = '/api/paas/v4/chat/completions'
const ZHIPU_MODEL = 'glm-4-flash'  // 永久免费，128K 上下文
const ZHIPU_TIMEOUT = 50000  // v6.6：单分类调用超时（实测 web_search 慢，需放宽到 50s 让正常调用完成；配合并发=5 单批完成）

// ─── DeepSeek API 配置（降级）──────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || config.deepseek?.apiKey || ''
const DEEPSEEK_BASE = 'api.deepseek.com'
const DEEPSEEK_PATH = '/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

// ─── 限流配置快捷引用 ──────────────────────────────

const RL = config.rateLimit || {}
const MIN_CALL_GAP_MS = RL.minCallGapMs || 1500
const MAX_RETRIES = RL.maxRetries || 3
const BACKOFF_BASE_MS = RL.backoffBaseMs || 1000
const BACKOFF_MAX_MS = RL.backoffMaxMs || 8000
const DEEPSEEK_DAILY_CAP = RL.deepseekDailyCap || 40

// ─── 工具函数 ──────────────────────────────────────

/** 异步等待（策略1：调用间隔） */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** 指数退避 + jitter（策略3：429 重试） */
function backoffWithJitter(attempt) {
  const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(2, attempt))
  const jitter = base * 0.3 * (Math.random() * 2 - 1)  // ±30%
  return Math.round(base + jitter)
}

// ─── system_kv 配额读写（策略4 + 策略6）─────────────

/**
 * 获取当日配额计数文档 ID
 * 格式：ratelimit:YYYY-MM-DD，每日自动切换
 */
function getTodayKey() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `ratelimit:${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 读当日配额（云数据库 system_kv 集合）
 * 需要调用方传入 db 实例（cloud.database()）
 */
async function readDailyQuota(db) {
  try {
    const key = getTodayKey()
    const res = await db.collection('system_kv').where({ key }).get()
    if (res.data && res.data.length > 0) {
      return res.data[0].value || { deepseekCalls: 0, zhipuCalls: 0 }
    }
  } catch (err) {
    console.warn('[quota] 读取当日配额失败:', err.message)
  }
  return { deepseekCalls: 0, zhipuCalls: 0 }
}

/**
 * 写入当日配额
 */
async function writeDailyQuota(db, value) {
  try {
    const key = getTodayKey()
    const now = Date.now()
    const exist = await db.collection('system_kv').where({ key }).get()
    if (exist.data && exist.data.length > 0) {
      await db.collection('system_kv').doc(exist.data[0]._id).update({
        data: { value, updatedAt: now }
      })
    } else {
      await db.collection('system_kv').add({
        data: { key, value, createdAt: now, updatedAt: now }
      })
    }
  } catch (err) {
    console.warn('[quota] 写入当日配额失败:', err.message)
  }
}

// ─── HTTP 请求工具 ─────────────────────────────────

/**
 * HTTPS 请求封装
 * B-12 策略2: 429 限流识别 — 区分限流错误 vs 普通错误
 */
function httpsRequest({ hostname, path, method, headers, body, timeout = 45000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers, timeout }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        // ── 策略2: 429 限流识别 ──
        if (res.statusCode === 429) {
          const err = new Error('API_RATE_LIMIT')
          err.errorCode = config.errorCodes.API_RATE_LIMIT
          // 提取 Retry-After 头（秒）
          const retryAfter = res.headers['retry-after']
          if (retryAfter) {
            err.retryAfterMs = parseInt(retryAfter, 10) * 1000
          }
          // 尝试解析 body 中的限流详情
          try {
            const bodyObj = JSON.parse(data)
            err.responseBody = bodyObj
          } catch (_) {}
          reject(err)
          return
        }

        if (res.statusCode !== 200) {
          // 检查 body 中是否包含限流特征码（智谱 code:1113, DeepSeek rate_limit_error）
          let isRateLimit = false
          try {
            const bodyObj = JSON.parse(data)
            if (
              (bodyObj.error && (bodyObj.error.code === '1113' || bodyObj.error.code === '1114')) ||
              (bodyObj.error && bodyObj.error.type === 'rate_limit_error')
            ) {
              isRateLimit = true
            }
          } catch (_) {}

          if (isRateLimit) {
            const err = new Error('API_RATE_LIMIT')
            err.errorCode = config.errorCodes.API_RATE_LIMIT
            reject(err)
            return
          }

          reject(new Error(`API 返回 ${res.statusCode}: ${data.substring(0, 200)}`))
          return
        }
        try {
          resolve(JSON.parse(data))
        } catch (err) {
          reject(new Error(`解析响应失败: ${err.message}`))
        }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')) })
    req.write(body)
    req.end()
  })
}

// ─── 分类 Prompt 模板（每分类 15 条，含 content 正文）──

const PER_CATEGORY_COUNT = 5  // v6.6：对齐聚合/天行量级，保证 60s 超时内完成

/**
 * 生成分类搜索 Prompt（统一要求 content 正文）
 */
function buildPrompt(categoryName, sources) {
  return `请从以下可信新闻源搜索今日最重要的${PER_CATEGORY_COUNT}条${categoryName}：
新闻源：${sources}

要求：
1. 必须是最近发布的最新新闻
2. 每条新闻输出为 JSON 对象，包含以下字段：
   - title: 新闻标题（字符串，不超过50字）
   - summary: 新闻摘要（字符串，80-150字，概括核心）
   - content: 新闻正文（字符串，300-500字，完整叙述事件背景、经过、影响，分段用\\n分隔）
   - source: 来源（必须是上述新闻源之一）
   - url: 原文链接（真实网页 URL，以 http/https 开头）
3. 所有${PER_CATEGORY_COUNT}条放在一个 JSON 数组中返回
4. 只返回 JSON 数组，不要其他文字

返回格式示例：
[{"title":"...","summary":"...","content":"第一段\\n\\n第二段","source":"新华社","url":"https://www.news.com/xxx"}]`
}

const CATEGORY_PROMPTS = {
  recommend: buildPrompt('国内要闻', 'xinhuanet.com, people.com.cn, cctv.com, chinanews.com, thepaper.cn, huanqiu.com'),
  tech: buildPrompt('科技新闻', '36kr.com, huxiu.com, techcrunch.com'),
  sports: buildPrompt('科学探索新闻', 'xinhuanet.com, cctv.com, thepaper.cn, reuters.com, nationalgeographic.com, science.org'),
  international: buildPrompt('国际新闻', 'reuters.com, bbc.com, apnews.com, huanqiu.com, chinanews.com'),
  life: buildPrompt('社会生活新闻', 'people.com.cn, thepaper.cn, chinanews.com, cctv.com'),
}

// ─── JSON 解析 ────────────────────────────────────

function parseNewsFromContent(content, category) {
  const strategies = [
    () => JSON.parse(content),
    () => {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      return match ? JSON.parse(match[1]) : null
    },
    () => {
      const match = content.match(/\[\s*\{[\s\S]*\}\s*\]/)
      return match ? JSON.parse(match[0]) : null
    },
  ]

  let rawList = null
  for (const strategy of strategies) {
    try {
      rawList = strategy()
      if (Array.isArray(rawList) && rawList.length > 0) break
    } catch (_) {}
  }

  if (!Array.isArray(rawList) || rawList.length === 0) {
    console.warn(`[zhipuSearch] ${category}: 无法从响应中提取新闻列表`)
    return []
  }

  const categoryNames = {
    recommend: '推荐', tech: '科技', sports: '科学探索',
    international: '国际', life: '社会',
  }

  const domainMap = {
    'xinhuanet.com': '新华社', 'people.com.cn': '人民日报', 'cctv.com': '央视新闻',
    'chinanews.com': '中新网', 'thepaper.cn': '澎湃新闻', '36kr.com': '36氪',
    'huxiu.com': '虎嗅', 'huanqiu.com': '环球时报', 'reuters.com': '路透社',
    'bbc.com': 'BBC', 'apnews.com': '美联社', 'techcrunch.com': 'TechCrunch',
  }

  return rawList
    .filter(item => item != null && typeof item === 'object')
    .map((item, i) => ({
      id: `zhipu_${category}_${Date.now()}_${i}`,
      title: String(item.title || '').trim(),
      summary: String(item.summary || item.content?.slice(0, 150) || '').trim(),
      content: String(item.content || item.summary || '').trim(),  // 🆕 完整正文
      category,
      categoryName: categoryNames[category] || category,
      sourceUrl: String(item.url || item.sourceUrl || '').trim(),
      source: (() => {
        const raw = String(item.source || '未知来源').trim()
        if (domainMap[raw]) return domainMap[raw]
        for (const [domain, name] of Object.entries(domainMap)) {
          if (raw.includes(domain)) return name
        }
        return raw
      })(),
      publishTime: new Date().toISOString(),
    }))
    .filter(item => item.title.length > 0)
}

// ─── 智谱 API 搜索 ────────────────────────────────

/**
 * 使用智谱 GLM-4-Flash + web_search 搜索新闻
 * B-12 策略3: 429 限流时指数退避重试（≤3 次）
 */
async function searchWithZhipu(category) {
  const prompt = CATEGORY_PROMPTS[category]
  if (!prompt) throw new Error(`未知分类: ${category}`)
  if (!ZHIPU_API_KEY) throw new Error('未配置 ZHIPU_API_KEY')

  const requestBody = JSON.stringify({
    model: ZHIPU_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的新闻搜索助手。使用 web_search 工具从指定可信新闻源搜索信息，严格按要求输出 JSON 格式。不要编造任何信息。每条新闻必须包含 content 字段（300-500字完整正文）和 url 字段（真实网页链接，以 http/https 开头），不得使用占位符。'
      },
      { role: 'user', content: prompt }
    ],
    tools: [{
      type: 'web_search',
      web_search: {
        enable: true,
        search_mode: 'auto',
      }
    }],
    temperature: 0.1,
    max_tokens: 8000,
  })

  let lastErr = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await httpsRequest({
        hostname: ZHIPU_BASE,
        path: ZHIPU_PATH,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ZHIPU_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
        timeout: ZHIPU_TIMEOUT,
      })

      const content = result.choices?.[0]?.message?.content || ''
      return parseNewsFromContent(content, category)
    } catch (err) {
      lastErr = err
      // 仅对限流错误退避重试
      if (err.errorCode === config.errorCodes.API_RATE_LIMIT) {
        if (attempt < MAX_RETRIES) {
          const delay = err.retryAfterMs || backoffWithJitter(attempt)
          console.warn(`[zhipuSearch] 智谱 ${category} 限流，第 ${attempt + 1}/${MAX_RETRIES} 次重试，等待 ${delay}ms`)
          await sleep(delay)
          continue
        }
        console.warn(`[zhipuSearch] 智谱 ${category} 限流重试耗尽（${MAX_RETRIES} 次）`)
      }
      // 非限流错误不重试，直接抛
      break
    }
  }

  throw lastErr
}

// ─── DeepSeek API 降级搜索 ─────────────────────────

/**
 * DeepSeek API 作为智谱失败时的降级搜索
 * B-12 策略3: 429 限流时指数退避重试（≤3 次）
 */
async function searchWithDeepSeek(category) {
  const prompt = CATEGORY_PROMPTS[category]
  if (!prompt) throw new Error(`未知分类: ${category}`)
  if (!DEEPSEEK_API_KEY) throw new Error('未配置 DEEPSEEK_API_KEY')

  const requestBody = JSON.stringify({
    model: DEEPSEEK_MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的新闻搜索助手。使用联网搜索从指定可信新闻源搜索信息，严格按要求输出 JSON 格式。不要编造任何信息。每条新闻必须包含 content 字段（300-500字完整正文）和 url 字段（真实网页链接，以 http/https 开头），不得使用占位符。'
      },
      { role: 'user', content: prompt }
    ],
    enable_search: true,
    temperature: 0.1,
    max_tokens: 8000,
  })

  let lastErr = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await httpsRequest({
        hostname: DEEPSEEK_BASE,
        path: DEEPSEEK_PATH,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
        timeout: ZHIPU_TIMEOUT,
      })

      const content = result.choices?.[0]?.message?.content || ''
      // 使用 zhipu 前缀以保持 id 一致性，实际来源标记在 source 字段
      const news = parseNewsFromContent(content, category)
      // 标记来源为 DeepSeek 降级
      return news.map(item => ({
        ...item,
        id: item.id.replace('zhipu_', 'ds_'),
      }))
    } catch (err) {
      lastErr = err
      if (err.errorCode === config.errorCodes.API_RATE_LIMIT) {
        if (attempt < MAX_RETRIES) {
          const delay = err.retryAfterMs || backoffWithJitter(attempt)
          console.warn(`[zhipuSearch] DeepSeek ${category} 限流，第 ${attempt + 1}/${MAX_RETRIES} 次重试，等待 ${delay}ms`)
          await sleep(delay)
          continue
        }
        console.warn(`[zhipuSearch] DeepSeek ${category} 限流重试耗尽（${MAX_RETRIES} 次）`)
      }
      break
    }
  }

  throw lastErr
}

// ─── 单分类搜索（智谱优先 → DeepSeek 降级）─────────

/**
 * 搜索单个分类的新闻
 * B-12 策略4: DeepSeek 预算熔断 — 调用前检查当日配额
 * B-12 策略6: 智谱调用量监控 — 每次调用后写入 system_kv
 *
 * @param {string} category - 分类名
 * @param {object} db - 云数据库实例（用于配额读写）
 * @param {object} quotaRef - 可变配额引用 { deepseekCalls, zhipuCalls }
 */
async function searchNewsByCategory(category, db, quotaRef) {
  // 首选：智谱 GLM-4-Flash
  try {
    console.log(`[zhipuSearch] 智谱搜索 ${category}...`)
    const news = await searchWithZhipu(category)
    console.log(`[zhipuSearch] 智谱 ${category}: ${news.length} 条`)
    // 策略6: 智谱调用计数
    if (quotaRef) quotaRef.zhipuCalls++
    return { news, engine: 'zhipu' }
  } catch (zhipuErr) {
    console.warn(`[zhipuSearch] 智谱 ${category} 失败: ${zhipuErr.message}`)

    // 降级：DeepSeek API（策略4: 预算熔断）
    if (quotaRef && quotaRef.deepseekCalls >= DEEPSEEK_DAILY_CAP) {
      console.warn(`[zhipuSearch] DeepSeek ${category} 跳过 — 已达日配额 ${DEEPSEEK_DAILY_CAP}`)
      return { news: [], engine: 'skipped_quota' }
    }

    try {
      console.log(`[zhipuSearch] 降级到 DeepSeek 搜索 ${category}...`)
      const news = await searchWithDeepSeek(category)
      console.log(`[zhipuSearch] DeepSeek ${category}: ${news.length} 条`)
      // 策略6: DeepSeek 调用计数
      if (quotaRef) quotaRef.deepseekCalls++
      return { news, engine: 'deepseek' }
    } catch (dsErr) {
      console.error(`[zhipuSearch] DeepSeek ${category} 也失败: ${dsErr.message}`)
      return { news: [], engine: 'none' }
    }
  }
}

// ─── 批量搜索 ──────────────────────────────────────

/**
 * 搜索所有分类的新闻
 * v6.6 超时优化：分类搜索限并发并行（CONCURRENCY_LIMIT），
 *   搜索阶段从 顺序≈57s 降至 并行≈20s，确保云函数 60s 内完成。
 * B-12 策略4+6: 读取当日配额，传给各分类；搜索完成后写回
 *
 * @param {string[]} categories - 分类列表（默认全部）
 * @param {object} db - 云数据库实例（用于配额读写）
 */
const SEARCH_CONCURRENCY = 5  // v6.6：全分类并行（5 路），单批耗时 = 最慢单次调用，最大化利用 60s 预算

async function searchAllCategories(categories = null, db = null) {
  const cats = categories || Object.keys(CATEGORY_PROMPTS)
  const allNews = []
  const stats = {}

  // 策略4+6: 读取当日配额
  let quota = { deepseekCalls: 0, zhipuCalls: 0 }
  if (db) {
    quota = await readDailyQuota(db)
    console.log(`[zhipuSearch] 当日配额: 智谱=${quota.zhipuCalls}, DeepSeek=${quota.deepseekCalls}/${DEEPSEEK_DAILY_CAP}`)
  }

  // 可变引用，供各分类递增
  const quotaRef = {
    zhipuCalls: quota.zhipuCalls || 0,
    deepseekCalls: quota.deepseekCalls || 0,
  }

  // v6.6：限并发并行搜索（替代顺序，规避 60s 超时）
  let cursor = 0
  async function worker() {
    while (cursor < cats.length) {
      const i = cursor++
      const cat = cats[i]
      try {
        const result = await searchNewsByCategory(cat, db, quotaRef)
        allNews.push(...result.news)
        stats[cat] = { success: result.news.length > 0, count: result.news.length, engine: result.engine }
        if (quotaRef.zhipuCalls > (RL.zhipuWarnThreshold || 200)) {
          console.warn(`[zhipuSearch] ⚠️ 智谱单日调用 ${quotaRef.zhipuCalls} 次，已超告警阈值`)
        }
      } catch (err) {
        console.error(`[zhipuSearch] 分类 ${cat} 搜索异常:`, err.message)
        stats[cat] = { success: false, count: 0, engine: 'none' }
      }
    }
  }

  const workers = Array.from({ length: Math.min(SEARCH_CONCURRENCY, cats.length) }, () => worker())
  await Promise.all(workers)

  // 策略6: 写回当日配额
  if (db) {
    await writeDailyQuota(db, {
      zhipuCalls: quotaRef.zhipuCalls,
      deepseekCalls: quotaRef.deepseekCalls,
    })
  }

  return {
    news: allNews,
    stats,
    quota: {
      zhipuCalls: quotaRef.zhipuCalls,
      deepseekCalls: quotaRef.deepseekCalls,
      deepseekCap: DEEPSEEK_DAILY_CAP,
    },
  }
}

module.exports = {
  searchNewsByCategory,
  searchAllCategories,
  CATEGORY_PROMPTS,
  readDailyQuota,
  writeDailyQuota,
}
