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
 *   sports        → tiyu（体育）⚠️ 前端 tab 已改「科学探索」，聚合无科学探索分类，内容仍为体育（降级源可接受）
 *   international → guoji（国际）
 *   life          → shehui（社会）
 *
 * 请求方式：POST，application/x-www-form-urlencoded
 *
 * 环境变量：
 *   JUHE_API_KEY — 聚合数据 API Key
 * ============================================================
 */

const config = require('../config')

// 分类 → 聚合 type 映射（与 test/v4-regression-data-layer.js 一致）
// v7（TL-B11）：移除 v4.2 遗留的 finance/entertainment（前端无 tab），与 constants.js 对齐。
const APP_TO_JUHE_TYPE = {
  recommend: 'top',
  tech: 'keji',
  sports: 'tiyu',
  international: 'guoji',
  life: 'shehui',
}

const CATEGORY_NAMES = {
  recommend: '推荐',
  tech: '科技',
  sports: '科学探索',
  international: '国际',
  life: '社会',
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
      // B-11: HTTP 状态码非 2xx 直接降级
      if (res.statusCode < 200 || res.statusCode >= 300) {
        console.warn(`[juhe] ${category} HTTP ${res.statusCode}，降级返回空`)
        res.resume()
        resolve([])
        return
      }

      let body = ''
      // B-11: 响应体大小上限（8MB）
      const MAX_BODY_BYTES = 8 * 1024 * 1024
      let bytes = 0
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) {
          console.warn(`[juhe] ${category} 响应超过 ${MAX_BODY_BYTES} 字节，截断降级`)
          req.destroy()
          resolve([])
          return
        }
        body += chunk
      })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          console.log(`[juhe] ${category} 响应: error_code=${result.error_code}, reason=${result.reason}`)

          // B-11: error_code 兼容字符串/数字（聚合接口偶发返回字符串 "0"）
          if (Number(result.error_code) !== 0) {
            // 10012 = 超过每日可允许请求次数（免费版配额耗尽）
            if (Number(result.error_code) === 10012) {
              console.warn(`[juhe] ⚠️ ${category} 聚合API免费额度已用完（每日请求次数上限），请等待次日重置或升级套餐`)
            }
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

  // 注意：聚合 API 头条接口不返回 description 字段，摘要用标题兜底
  // （详情页会按需抓正文，列表页摘要仅作展示）
  const summarySource = rawItem.description || rawItem.title || ''

  return {
    id: `juhe_${category}_${rawItem.uniquekey || rawItem.id || Date.now()}`,
    title: rawItem.title || '',
    summary: cleanSummary(summarySource, 150),
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
 * B-12: 增加重试+指数退避（配额保护，聚合免费版限流 100 次/分钟）
 * @param {string[]} categories  分类 ID 列表
 * @param {number} [perCategory=10]  每分类条数
 * @returns {Promise<{ news: Array, stats: Object }>}
 */
async function fetchAllCategories(categories, perCategory = 10) {
  const stats = {}

  // B-12: 从 config.rateLimit 读取统一策略
  const rl = config.rateLimit || {}
  const maxRetries = rl.maxRetries || 3
  const backoffBaseMs = rl.backoffBaseMs || 500

  // 并行请求所有分类（微信云函数 3s 超时限制：串行 7 分类约 3.7s 必超时，
  // 并行只需 ~0.5s。聚合免费版限流 100 次/分钟，7 并发远未达上限）
  const settled = await Promise.all(
    categories.map(async (category) => {
      try {
        let rawList = []
        let lastErr = null
        for (let attempt = 0; attempt < maxRetries; attempt++) {
          try {
            rawList = await fetchJuheNewsList(category, perCategory)
            if (rawList.length > 0) break
            // 空结果也重试（可能是临时限流）
            console.warn(`[juhe] ${category} 第 ${attempt + 1} 次返回 0 条，${attempt < maxRetries - 1 ? '重试' : '放弃'}`)
          } catch (err) {
            lastErr = err
            console.warn(`[juhe] ${category} 第 ${attempt + 1} 次失败: ${err.message}`)
          }
          if (attempt < maxRetries - 1) {
            await new Promise(r => setTimeout(r, backoffBaseMs * Math.pow(3, attempt)))
          }
        }
        if (rawList.length === 0 && lastErr) {
          console.error(`[juhe] ${category} ${maxRetries} 次重试均失败:`, lastErr.message)
        }
        const formatted = rawList.map(item => formatJuheNewsItem(item, category))
        return { category, news: formatted }
      } catch (err) {
        console.error(`[juhe] ${category} 失败:`, err.message)
        return { category, news: [] }
      }
    })
  )

  const results = []
  for (const { category, news } of settled) {
    results.push(...news)
    stats[category] = news.length
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
