/**
 * 天行数据 API 调用模块
 * ============================================================
 * 从多个分类接口获取新闻标题列表（不抓正文），适配 3 秒云函数超时。
 *
 * 分类 → 天行接口映射（按用户 Key 可用接口配置）：
 *   recommend     → generalnews（综合新闻）
 *   tech          → it（IT 科技）
 *   sports        → sicprobe（科学探索）
 *   international → world（国际）
 *   life          → social（社会）
 *
 * 环境变量：
 *   TIAN_API_KEY — 天行数据 API Key
 * ============================================================
 */

const config = require('../config')

const CATEGORY_ENDPOINTS = {
  recommend: 'generalnews',
  tech: 'it',
  sports: 'sicprobe',
  international: 'world',
  life: 'social',
}

const CATEGORY_NAMES = {
  recommend: '推荐',
  tech: '科技',
  sports: '科学探索',
  international: '国际',
  life: '社会',
}

/**
 * 调用天行 API 获取新闻列表
 * @param {string} category 分类 ID
 * @param {number} [num=10] 获取条数
 * @returns {Promise<Array>}
 */
async function fetchTianNewsList(category, num = 10) {
  const apiKey = config.tian.apiKey
  if (!apiKey) {
    throw new Error('TIAN_API_KEY 未配置')
  }

  const endpoint = CATEGORY_ENDPOINTS[category]
  if (!endpoint) {
    console.warn(`[tianxing] 未知分类 ${category}，跳过`)
    return []
  }

  const url = `https://apis.tianapi.com/${endpoint}/index?key=${apiKey}&num=${num}`

  console.log(`[tianxing] 请求 ${category} → ${endpoint}`)

  return new Promise((resolve, reject) => {
    const https = require('https')
    const req = https.get(url, { timeout: config.tian.timeout || 8000 }, (res) => {
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          if (result.code !== 200) {
            console.warn(`[tianxing] ${category} API 返回错误: code=${result.code} msg=${result.msg}`)
            resolve([])
            return
          }
          // 天行分类接口返回的新闻数组字段统一为 newslist（部分旧接口为 list，做兼容）
          const newsList = (result.result && (result.result.newslist || result.result.list)) || []
          if (newsList.length === 0) {
            console.log(`[tianxing] ${category} 响应结构:`, JSON.stringify({
              code: result.code,
              msg: result.msg,
              resultKeys: result.result ? Object.keys(result.result) : null,
              sample: result.result ? JSON.stringify(result.result).slice(0, 200) : null,
            }))
          }
          console.log(`[tianxing] ${category} 获取 ${newsList.length} 条`)
          resolve(newsList)
        } catch (e) {
          console.error(`[tianxing] ${category} JSON 解析失败:`, e.message)
          resolve([])
        }
      })
    })

    req.on('error', (err) => {
      console.error(`[tianxing] ${category} 请求失败:`, err.message)
      resolve([]) // 降级：返回空数组，不中断流程
    })

    req.on('timeout', () => {
      req.destroy()
      console.error(`[tianxing] ${category} 请求超时`)
      resolve([])
    })

    req.end()
  })
}

/**
 * 将天行 API 返回的新闻格式化为统一结构
 * @param {Object} rawItem  天行原始数据
 * @param {string} category 分类 ID
 * @returns {Object}
 */
function formatTianNewsItem(rawItem, category) {
  const { cleanSummary } = require('../utils/newsCleaner')

  return {
    id: `tian_${category}_${rawItem.uniq_id || rawItem.id || Date.now()}`,
    title: rawItem.title || '',
    summary: cleanSummary(rawItem.description || rawItem.ctime || '', 150),
    category: category,
    categoryName: CATEGORY_NAMES[category] || category,
    source: rawItem.source || rawItem.src || '天行数据',
    sourceUrl: rawItem.url || '',
    picUrl: (rawItem.picUrl || rawItem.pic_url || '').split(',')[0] || '', // 取第一张
    publishTime: rawItem.pub_time || rawItem.ctime || new Date().toISOString(),
  }
}

/**
 * 批量拉取多个分类的新闻列表（v6.3: 增强重试+指数退避，修复国际分类 0 条问题）
 * @param {string[]} categories  分类 ID 列表
 * @param {number} [perCategory=10]  每分类条数
 * @returns {Promise<{ news: Array, stats: Object }>}
 */
async function fetchAllCategories(categories, perCategory = 10) {
  const results = []
  const stats = {}

  // v6.3(V5-FS-02-①): 分类间延迟增至 500ms，添加重试+指数退避（500ms/1500ms/3000ms）
  for (const category of categories) {
    let rawList = []
    let lastErr = null

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        rawList = await fetchTianNewsList(category, perCategory)
        if (rawList.length > 0) break // 成功获取数据，跳出重试
        // 空结果也重试（可能是临时限流）
        console.warn(`[tianxing] ${category} 第 ${attempt + 1} 次返回 0 条，${attempt < 2 ? '重试' : '放弃'}`)
      } catch (err) {
        lastErr = err
        console.warn(`[tianxing] ${category} 第 ${attempt + 1} 次失败: ${err.message}`)
      }
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt)))
      }
    }

    if (rawList.length > 0) {
      const formatted = rawList.map(item => formatTianNewsItem(item, category))
      results.push(...formatted)
      stats[category] = formatted.length
    } else {
      if (lastErr) {
        console.error(`[tianxing] ${category} 3 次重试均失败:`, lastErr.message)
      }
      stats[category] = 0
    }

    // 分类间延迟 500ms（最后一个分类后无需等待）
    if (category !== categories[categories.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  }

  return { news: results, stats }
}

module.exports = {
  fetchTianNewsList,
  fetchAllCategories,
  formatTianNewsItem,
  CATEGORY_ENDPOINTS,
  CATEGORY_NAMES,
}
