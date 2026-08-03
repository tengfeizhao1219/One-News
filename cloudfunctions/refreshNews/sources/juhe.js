/**
 * 聚合数据 API 调用模块
 * ============================================================
 * 从聚合头条新闻接口获取新闻标题列表（不抓正文），适配 3 秒云函数超时。
 *
 * 接口文档：https://www.juhe.cn/docs/api/id/235
 *
 * 分类 → 聚合 type 映射：
 *   recommend     → top（头条）
 *   tech          → keji（科技）
 *   sports        → tiyu（体育）
 *   international → guoji（国际）
 *   life          → shehui（社会）
 *   finance       → caijing（财经）
 *   entertainment → yule（娱乐）
 *
 * 请求方式：POST，application/x-www-form-urlencoded
 *
 * 环境变量：
 *   JUHE_API_KEY — 聚合数据 API Key
 * ============================================================
 */

const config = require('../config')

// 分类 → 聚合 type 映射（与 test/v4-regression-data-layer.js 一致）
const APP_TO_JUHE_TYPE = {
  recommend: 'top',
  tech: 'keji',
  sports: 'tiyu',
  international: 'guoji',
  life: 'shehui',
  finance: 'caijing',
  entertainment: 'yule',
}

const CATEGORY_NAMES = {
  recommend: '推荐',
  tech: '科技',
  sports: '体育',
  international: '国际',
  life: '社会',
  finance: '财经',
  entertainment: '娱乐',
}

/**
 * 调用聚合 API 获取新闻列表
 * @param {string} category 分类 ID
 * @param {number} [pageSize=10] 获取条数
 * @returns {Promise<Array>}
 */
async function fetchJuheNewsList(category, pageSize = 10) {
  const apiKey = config.juhe.apiKey
  if (!apiKey) {
    throw new Error('JUHE_API_KEY 未配置')
  }

  const juheType = APP_TO_JUHE_TYPE[category]
  if (!juheType) {
    console.warn(`[juhe] 未知分类 ${category}，跳过`)
    return []
  }

  console.log(`[juhe] 请求 ${category} → type=${juheType} (page_size=${pageSize})`)

  return new Promise((resolve, reject) => {
    const https = require('https')
    const querystring = require('querystring')

    const postData = querystring.stringify({
      key: apiKey,
      type: juheType,
      page_size: pageSize,
      page: 1,
    })

    const url = new URL(config.juhe.baseUrl)
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: config.juhe.timeout || 6000,
    }

    const req = https.request(options, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          console.log(`[juhe] ${category} 响应: error_code=${result.error_code}, reason=${result.reason}`)

          if (result.error_code !== 0) {
            console.warn(`[juhe] ${category} API 返回错误: error_code=${result.error_code} reason=${result.reason}`)
            resolve([])
            return
          }

          // 聚合返回的新闻在 result.data 数组中
          const newsList = result.result?.data || []
          console.log(`[juhe] ${category} 获取 ${newsList.length} 条`)

          if (newsList.length === 0) {
            console.log(`[juhe] ${category} 响应结构:`, JSON.stringify({
              error_code: result.error_code,
              reason: result.reason,
              resultKeys: result.result ? Object.keys(result.result) : null,
            }))
          }

          resolve(newsList)
        } catch (e) {
          console.error(`[juhe] ${category} JSON 解析失败:`, e.message)
          resolve([])
        }
      })
    })

    req.on('error', (err) => {
      console.error(`[juhe] ${category} 请求失败:`, err.message)
      resolve([]) // 降级：返回空数组，不中断流程
    })

    req.on('timeout', () => {
      req.destroy()
      console.error(`[juhe] ${category} 请求超时`)
      resolve([])
    })

    req.write(postData)
    req.end()
  })
}

/**
 * 将聚合 API 返回的新闻格式化为统一结构
 * @param {Object} rawItem  聚合原始数据
 * @param {string} category 分类 ID
 * @returns {Object}
 */
function formatJuheNewsItem(rawItem, category) {
  const { cleanSummary } = require('../utils/newsCleaner')

  return {
    id: `juhe_${category}_${rawItem.uniquekey || rawItem.id || Date.now()}`,
    title: rawItem.title || '',
    summary: cleanSummary(rawItem.description || '', 150),
    category: category,
    categoryName: CATEGORY_NAMES[category] || category,
    source: rawItem.author_name || rawItem.src || '聚合数据',
    sourceUrl: rawItem.url || '',
    picUrl: (rawItem.thumbnail_pic_s || rawItem.thumbnail_pic_s02 || rawItem.thumbnail_pic_s03 || '').split(',')[0] || '',
    publishTime: rawItem.date || new Date().toISOString().slice(0, 10),
  }
}

/**
 * 批量拉取多个分类的新闻列表
 * @param {string[]} categories  分类 ID 列表
 * @param {number} [perCategory=10]  每分类条数
 * @returns {Promise<{ news: Array, stats: Object }>}
 */
async function fetchAllCategories(categories, perCategory = 10) {
  const results = []
  const stats = {}

  // 串行请求，分类间加 300ms 间隔（防聚合 rate limit）
  for (const category of categories) {
    try {
      const rawList = await fetchJuheNewsList(category, perCategory)
      const formatted = rawList.map(item => formatJuheNewsItem(item, category))
      results.push(...formatted)
      stats[category] = formatted.length
    } catch (err) {
      console.error(`[juhe] ${category} 失败:`, err.message)
      stats[category] = 0
    }

    // 分类间延迟 300ms（最后一个分类后无需等待）
    if (category !== categories[categories.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  return { news: results, stats }
}

module.exports = {
  fetchJuheNewsList,
  fetchAllCategories,
  formatJuheNewsItem,
  APP_TO_JUHE_TYPE,
  CATEGORY_NAMES,
}
