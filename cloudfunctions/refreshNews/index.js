// 新闻自动刷新云函数
// 从 GitHub raw URL 拉取 data/news.json，批量写入云数据库 news_cache
//
// 触发方式：
//   1. 定时触发器（每天 8:00，cron: 0 0 8 * * * *）
//   2. 手动调用（用于首次部署验证）
//
// GitHub raw URL：
//   https://raw.githubusercontent.com/tengfeizhao1219/One-News/main/data/news.json

const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// ─── 配置 ───────────────────────────────────────────

const GITHUB_RAW_URL = 'https://raw.githubusercontent.com/tengfeizhao1219/One-News/main/data/news.json'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000  // 缓存有效期 24 小时
const REQUEST_TIMEOUT = 10000              // GitHub 请求超时 10 秒

// ─── HTTP 请求封装 ──────────────────────────────────

/**
 * 通过 HTTPS GET 获取 JSON 数据
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: REQUEST_TIMEOUT }, (res) => {
      // 处理重定向
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`[refreshNews] 跟随重定向: ${res.headers.location}`)
        fetchJson(res.headers.location).then(resolve).catch(reject)
        return
      }

      if (res.statusCode !== 200) {
        reject(new Error(`GitHub 返回状态码 ${res.statusCode}`))
        return
      }

      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(body)
          resolve(data)
        } catch (err) {
          reject(new Error(`JSON 解析失败: ${err.message}`))
        }
      })
    })

    req.on('error', (err) => {
      reject(new Error(`网络请求失败: ${err.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })
  })
}

// ─── 数据库操作 ─────────────────────────────────────

/**
 * 清除指定分类的旧缓存
 */
async function clearOldCache(category) {
  try {
    const now = Date.now()
    // 删除该分类下所有数据（不论是否过期）
    const res = await db.collection('news_cache')
      .where({ category })
      .remove()
    console.log(`[refreshNews] 清除 ${category} 旧缓存: ${res.stats.removed || 0} 条`)
    return res.stats.removed || 0
  } catch (err) {
    console.warn(`[refreshNews] 清除 ${category} 旧缓存失败:`, err.message)
    return 0
  }
}

/**
 * 批量写入新闻到云数据库
 */
async function batchInsert(newsList) {
  const now = Date.now()
  const expireAt = now + CACHE_TTL_MS
  let inserted = 0
  let failed = 0

  for (const item of newsList) {
    try {
      await db.collection('news_cache').add({
        data: {
          id: item.id,
          title: item.title,
          summary: item.summary,
          category: item.category,
          categoryName: item.categoryName,
          source: item.source,
          publishTime: item.publishTime,
          cacheExpire: expireAt,
          createdAt: now,
        },
      })
      inserted++
    } catch (err) {
      // 忽略重复 ID 错误（errCode -1）
      if (err.errCode === -1) {
        console.log(`[refreshNews] 跳过重复: ${item.id}`)
      } else {
        failed++
        console.warn(`[refreshNews] 写入失败 [${item.id}]:`, err.message)
      }
    }
  }

  return { inserted, failed }
}

// ─── 主函数 ─────────────────────────────────────────

exports.main = async (event) => {
  console.log('[refreshNews] ========== 开始刷新新闻缓存 ==========')
  console.log(`[refreshNews] GitHub URL: ${GITHUB_RAW_URL}`)

  // 1. 从 GitHub 拉取 news.json
  let newsData
  try {
    newsData = await fetchJson(GITHUB_RAW_URL)
  } catch (err) {
    console.error('[refreshNews] GitHub 拉取失败:', err.message)
    return {
      code: -1,
      message: `GitHub 拉取失败: ${err.message}`,
      errorCode: 'GITHUB_FETCH_FAILED',
    }
  }

  // 2. 校验数据格式
  const newsList = newsData.news || newsData
  if (!Array.isArray(newsList) || newsList.length === 0) {
    console.error('[refreshNews] 数据格式异常或无数据')
    return {
      code: -1,
      message: 'news.json 数据为空或格式异常',
      errorCode: 'INVALID_DATA',
    }
  }

  console.log(`[refreshNews] 拉取成功: ${newsList.length} 条新闻, 版本: ${newsData.version || 'unknown'}`)

  // 3. 按分类分组
  const categories = {}
  newsList.forEach(item => {
    const cat = item.category || 'unknown'
    if (!categories[cat]) categories[cat] = []
    categories[cat].push(item)
  })

  console.log(`[refreshNews] 分类分布:`, Object.fromEntries(
    Object.entries(categories).map(([k, v]) => [k, v.length])
  ))

  // 4. 逐分类清除旧缓存 + 写入新数据
  let totalInserted = 0
  let totalFailed = 0
  let totalCleared = 0

  for (const [category, items] of Object.entries(categories)) {
    const cleared = await clearOldCache(category)
    totalCleared += cleared

    const { inserted, failed } = await batchInsert(items)
    totalInserted += inserted
    totalFailed += failed

    console.log(`[refreshNews] ${category}: 清除 ${cleared} 条 → 写入 ${inserted} 条 (失败 ${failed})`)
  }

  // 5. 返回结果
  const result = {
    code: 0,
    message: '新闻缓存刷新成功',
    data: {
      version: newsData.version || 'unknown',
      generatedAt: newsData.generatedAt || '',
      total: newsList.length,
      inserted: totalInserted,
      failed: totalFailed,
      cleared: totalCleared,
      categories: Object.fromEntries(
        Object.entries(categories).map(([k, v]) => [k, v.length])
      ),
    },
  }

  console.log('[refreshNews] ========== 刷新完成 ==========')
  console.log(`[refreshNews] 总计: ${totalInserted} 条写入, ${totalFailed} 条失败, ${totalCleared} 条清除`)

  return result
}
