/**
 * 智谱 GLM-4-Flash 联网搜索模块（L1 主力数据源）
 *
 * 通过智谱 API 的 web_search 工具能力，让大模型联网搜索最新新闻，
 * 返回结构化 JSON。永久免费 + 2000万 token 额度。
 *
 * API 文档：https://open.bigmodel.cn/dev/api/normal-model/glm-4
 *
 * 降级：智谱失败时自动切换到 DeepSeek API（通过 deepseekSearch）
 */

const https = require('https')
const config = require('./config')

// ─── 智谱 API 配置 ──────────────────────────────────

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || config.zhipu?.apiKey || ''
const ZHIPU_BASE = 'open.bigmodel.cn'
const ZHIPU_PATH = '/api/paas/v4/chat/completions'
const ZHIPU_MODEL = 'glm-4-flash'  // 永久免费，128K 上下文

// ─── DeepSeek API 配置（降级）──────────────────────

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || config.deepseek?.apiKey || ''
const DEEPSEEK_BASE = 'api.deepseek.com'
const DEEPSEEK_PATH = '/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'

// ─── HTTP 请求工具 ─────────────────────────────────

function httpsRequest({ hostname, path, method, headers, body, timeout = 45000 }) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname, path, method, headers, timeout }, (res) => {
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
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

// ─── 分类 Prompt 模板（每分类 15 条）─────────────────

const PER_CATEGORY_COUNT = 15

const CATEGORY_PROMPTS = {
  recommend: `请从以下可信新闻源搜索今日最重要的${PER_CATEGORY_COUNT}条国内要闻：
新闻源：xinhuanet.com, people.com.cn, cctv.com, chinanews.com, thepaper.cn, huanqiu.com

要求：
1. 必须是最近发布的最新新闻
2. 每条新闻输出为 JSON 对象，包含以下字段：
   - title: 新闻标题（字符串，不超过50字）
   - summary: 新闻摘要（字符串，100-200字）
   - source: 来源（必须是上述新闻源之一）
   - url: 原文链接（真实网页 URL，以 http/https 开头）
3. 所有${PER_CATEGORY_COUNT}条放在一个 JSON 数组中返回
4. 只返回 JSON 数组，不要其他文字

返回格式示例：
[{"title":"...","summary":"...","source":"新华社","url":"https://www.news.com/xxx"}]`,

  tech: `请从以下可信科技新闻源搜索今日最重要的${PER_CATEGORY_COUNT}条科技新闻：
新闻源：36kr.com, huxiu.com, techcrunch.com

要求：
1. 必须是最近发布的最新科技/互联网/AI 相关新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,

  sports: `请从以下可信新闻源搜索今日最重要的${PER_CATEGORY_COUNT}条体育新闻：
新闻源：xinhuanet.com, cctv.com, thepaper.cn, reuters.com

要求：
1. 必须是最近发布的最新体育新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,

  international: `请从以下可信新闻源搜索今日最重要的${PER_CATEGORY_COUNT}条国际新闻：
新闻源：reuters.com, bbc.com, apnews.com, huanqiu.com, chinanews.com

要求：
1. 必须是最近发布的最新国际新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,

  life: `请从以下可信新闻源搜索今日最重要的${PER_CATEGORY_COUNT}条社会生活新闻：
新闻源：people.com.cn, thepaper.cn, chinanews.com, cctv.com

要求：
1. 必须是最近发布的最新社会/生活/民生类新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,
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
    recommend: '推荐', tech: '科技', sports: '体育',
    international: '国际', life: '生活',
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
      summary: String(item.summary || '').trim(),
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
        content: '你是一个专业的新闻搜索助手。使用 web_search 工具从指定可信新闻源搜索信息，严格按要求输出 JSON 格式。不要编造任何信息。每条新闻必须包含 url 字段，且 url 必须是该新闻最初发布的真实网页链接（以 http/https 开头），不得使用占位符。'
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
    max_tokens: 6000,
  })

  const result = await httpsRequest({
    hostname: ZHIPU_BASE,
    path: ZHIPU_PATH,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ZHIPU_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
    timeout: 45000,
  })

  const content = result.choices?.[0]?.message?.content || ''
  return parseNewsFromContent(content, category)
}

// ─── DeepSeek API 降级搜索 ─────────────────────────

/**
 * DeepSeek API 作为智谱失败时的降级搜索
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
        content: '你是一个专业的新闻搜索助手。使用联网搜索从指定可信新闻源搜索信息，严格按要求输出 JSON 格式。不要编造任何信息。每条新闻必须包含 url 字段，且 url 必须是该新闻最初发布的真实网页链接（以 http/https 开头），不得使用占位符。'
      },
      { role: 'user', content: prompt }
    ],
    enable_search: true,
    temperature: 0.1,
    max_tokens: 6000,
  })

  const result = await httpsRequest({
    hostname: DEEPSEEK_BASE,
    path: DEEPSEEK_PATH,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: requestBody,
    timeout: 45000,
  })

  const content = result.choices?.[0]?.message?.content || ''
  // 使用 zhipu 前缀以保持 id 一致性，实际来源标记在 source 字段
  const news = parseNewsFromContent(content, category)
  // 标记来源为 DeepSeek 降级
  return news.map(item => ({
    ...item,
    id: item.id.replace('zhipu_', 'ds_'),
  }))
}

// ─── 单分类搜索（智谱优先 → DeepSeek 降级）─────────

async function searchNewsByCategory(category) {
  // 首选：智谱 GLM-4-Flash
  try {
    console.log(`[zhipuSearch] 智谱搜索 ${category}...`)
    const news = await searchWithZhipu(category)
    console.log(`[zhipuSearch] 智谱 ${category}: ${news.length} 条`)
    return { news, engine: 'zhipu' }
  } catch (zhipuErr) {
    console.warn(`[zhipuSearch] 智谱 ${category} 失败: ${zhipuErr.message}`)

    // 降级：DeepSeek API
    try {
      console.log(`[zhipuSearch] 降级到 DeepSeek 搜索 ${category}...`)
      const news = await searchWithDeepSeek(category)
      console.log(`[zhipuSearch] DeepSeek ${category}: ${news.length} 条`)
      return { news, engine: 'deepseek' }
    } catch (dsErr) {
      console.error(`[zhipuSearch] DeepSeek ${category} 也失败: ${dsErr.message}`)
      return { news: [], engine: 'none' }
    }
  }
}

// ─── 批量搜索 ──────────────────────────────────────

async function searchAllCategories(categories = null) {
  const cats = categories || Object.keys(CATEGORY_PROMPTS)
  const allNews = []
  const stats = {}

  for (const cat of cats) {
    const result = await searchNewsByCategory(cat)
    allNews.push(...result.news)
    stats[cat] = { success: result.news.length > 0, count: result.news.length, engine: result.engine }
  }

  return { news: allNews, stats }
}

module.exports = {
  searchNewsByCategory,
  searchAllCategories,
  CATEGORY_PROMPTS,
}
