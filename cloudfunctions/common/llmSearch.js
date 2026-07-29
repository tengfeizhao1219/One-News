/**
 * 大模型联网搜索模块
 *
 * 通过阿里云百炼 DeepSeek API 的 enable_search 能力，
 * 让大模型自己联网搜索最新新闻，返回结构化数据。
 *
 * API 文档：https://help.aliyun.com/zh/model-studio/deepseek-api
 */

const https = require('https')

const config = require('./config')
// ─── 配置 ───────────────────────────────────────────

// 百炼 API 配置（优先环境变量，fallback 到 config）
const API_KEY = process.env.DASHSCOPE_API_KEY || config.bailian?.apiKey || ''
const API_BASE = 'dashscope.aliyuncs.com'
const API_PATH = '/compatible-mode/v1/chat/completions'
const MODEL = 'deepseek-v3.2'  // 支持联网搜索的 DeepSeek 模型

// 新闻来源白名单 — 只接受这些域名的结果
const SOURCE_WHITELIST = [
  // 国内
  'xinhuanet.com', 'people.com.cn', 'cctv.com', 'chinanews.com',
  'thepaper.cn', '36kr.com', 'huxiu.com', 'huanqiu.com',
  // 海外
  'reuters.com', 'bbc.com', 'apnews.com', 'techcrunch.com',
]

// ─── 分类 Prompt 模板 ──────────────────────────────

const CATEGORY_PROMPTS = {
  recommend: `请从以下可信新闻源搜索今日最重要的5条国内要闻：
新闻源：xinhuanet.com, people.com.cn, cctv.com, chinanews.com, thepaper.cn, huanqiu.com

要求：
1. 必须是最近几天发布的最新新闻
2. 每条新闻输出为 JSON 对象，包含以下字段：
   - title: 新闻标题（字符串，不超过50字）
   - summary: 新闻摘要（字符串，100-200字）
   - source: 来源（必须是上述新闻源之一）
   - url: 原文链接（真实网页 URL，以 http/https 开头）
3. 所有5条放在一个 JSON 数组中返回
4. 只返回 JSON 数组，不要其他文字

返回格式示例：
[{"title":"...","summary":"...","source":"新华社","url":"https://www.news.com/xxx"}]`,

  tech: `请从以下可信科技新闻源搜索今日最重要的5条科技新闻：
新闻源：36kr.com, huxiu.com, techcrunch.com

要求：
1. 必须是最近发布的最新科技/互联网/AI 相关新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,

  sports: `请从以下可信新闻源搜索今日最重要的5条体育新闻：
新闻源：xinhuanet.com, cctv.com, thepaper.cn, reuters.com

要求：
1. 必须是最近发布的最新体育新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,

  international: `请从以下可信新闻源搜索今日最重要的5条国际新闻：
新闻源：reuters.com, bbc.com, apnews.com, huanqiu.com, chinanews.com

要求：
1. 必须是最近发布的最新国际新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,

  life: `请从以下可信新闻源搜索今日最重要的5条社会生活新闻：
新闻源：people.com.cn, thepaper.cn, chinanews.com, cctv.com

要求：
1. 必须是最近发布的最新社会/生活/民生类新闻
2. 每条输出 JSON：title(标题), summary(摘要), source(来源), url(原文链接，真实网页URL)
3. 只返回 JSON 数组`,
}

// ─── API 调用 ──────────────────────────────────────

/**
 * 调用百炼 API 进行联网搜索
 * @param {string} category - 分类 ID
 * @returns {Promise<Array>} 新闻列表
 */
async function searchNewsByCategory(category) {
  const prompt = CATEGORY_PROMPTS[category]
  if (!prompt) {
    throw new Error(`未知分类: ${category}`)
  }

  if (!API_KEY) {
    throw new Error('未配置 DASHSCOPE_API_KEY 环境变量')
  }

  const requestBody = JSON.stringify({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的新闻搜索助手。你只从指定的可信新闻源搜索信息，严格按要求输出 JSON 格式。不要编造任何信息。每条新闻【必须】包含 url 字段，且 url 必须是该新闻最初发布的真实网页链接（以 http/https 开头），不得使用占位符。'
      },
      {
        role: 'user',
        content: prompt
      }
    ],
    enable_search: true,
    search_options: {
      search_strategy: 'max',
      forced_search: true,
      freshness: 7,  // 只搜最近7天（API限制最小值为7）
    },
    temperature: 0.1,  // 低温度，减少幻觉
    max_tokens: 3000,
  })

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_BASE,
      path: API_PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`百炼 API 返回 ${res.statusCode}: ${body.substring(0, 200)}`))
          return
        }
        try {
          const result = JSON.parse(body)
          const content = result.choices?.[0]?.message?.content || ''
          resolve(parseNewsFromContent(content, category))
        } catch (err) {
          reject(new Error(`解析 API 响应失败: ${err.message}`))
        }
      })
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('百炼 API 请求超时'))
    })

    req.write(requestBody)
    req.end()
  })
}

/**
 * 从大模型返回的文本中提取新闻 JSON 数组
 */
function parseNewsFromContent(content, category) {
  // 尝试多种方式提取 JSON 数组
  const strategies = [
    // 1. 直接解析整个内容
    () => JSON.parse(content),
    // 2. 提取 ```json ... ``` 代码块
    () => {
      const match = content.match(/```(?:json)?\s*([\s\S]*?)```/)
      return match ? JSON.parse(match[1]) : null
    },
    // 3. 提取第一个 [...] 数组
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
    console.warn(`[llmSearch] ${category}: 无法从响应中提取新闻列表`)
    return []
  }

  // 格式化为标准数据模型
  const categoryNames = {
    recommend: '推荐', tech: '科技', sports: '体育',
    international: '国际', life: '生活',
  }

  return rawList
    .filter(item => item != null && typeof item === 'object')
    .map((item, i) => ({
      id: `llm_${category}_${Date.now()}_${i}`,
      title: String(item.title || '').trim(),
      summary: String(item.summary || '').trim(),
      category,
      categoryName: categoryNames[category] || category,
      sourceUrl: String(item.url || item.sourceUrl || '').trim(),
      source: (() => {
        const raw = String(item.source || '未知来源').trim()
        // 尝试域名→中文名映射
        const domainMap = {
          'xinhuanet.com': '新华社', 'people.com.cn': '人民日报', 'cctv.com': '央视新闻',
          'chinanews.com': '中新网', 'thepaper.cn': '澎湃新闻', '36kr.com': '36氪',
          'huxiu.com': '虎嗅', 'huanqiu.com': '环球时报', 'reuters.com': '路透社',
          'bbc.com': 'BBC', 'apnews.com': '美联社', 'techcrunch.com': 'TechCrunch',
        }
        // 如果 source 是域名，映射为中文名
        if (domainMap[raw]) return domainMap[raw]
        // 如果 source 包含域名，尝试提取
        for (const [domain, name] of Object.entries(domainMap)) {
          if (raw.includes(domain)) return name
        }
        return raw
      })(),
      publishTime: new Date().toISOString(),
    }))
    .filter(item => item.title.length > 0)
}

// ─── 批量搜索 ──────────────────────────────────────

/**
 * 批量搜索所有分类的新闻
 * @param {string[]} categories - 分类 ID 数组，默认全部
 * @returns {Promise<{news: Array, stats: Object}>}
 */
async function searchAllCategories(categories = null) {
  const cats = categories || Object.keys(CATEGORY_PROMPTS)
  const allNews = []
  const stats = {}

  for (const cat of cats) {
    try {
      console.log(`[llmSearch] 搜索 ${cat}...`)
      const news = await searchNewsByCategory(cat)
      allNews.push(...news)
      stats[cat] = { success: true, count: news.length }
      console.log(`[llmSearch] ${cat}: ${news.length} 条`)
    } catch (err) {
      stats[cat] = { success: false, error: err.message }
      console.error(`[llmSearch] ${cat} 搜索失败:`, err.message)
    }
  }

  return { news: allNews, stats }
}

module.exports = {
  searchNewsByCategory,
  searchAllCategories,
  SOURCE_WHITELIST,
}
