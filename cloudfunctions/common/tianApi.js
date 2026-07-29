/**
 * 天行数据 API 调用封装（主数据源）
 */

const config = require('./config')
const { API_TIMEOUT, API_RETRY_DELAY } = { API_TIMEOUT: config.tian.timeout, API_RETRY_DELAY: config.tian.retryDelay }

/**
 * 带超时的 HTTP 请求
 */
function fetchWithTimeout(url, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API_TIMEOUT')), timeout)

    const https = require('https')
    const http = require('http')
    const client = url.startsWith('https') ? https : http

    client.get(url, (res) => {
      clearTimeout(timer)
      let data = ''
      res.on('data', chunk => { data += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('API_INVALID_RESPONSE'))
        }
      })
    }).on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * 带重试的 API 调用
 */
async function callWithRetry(url, retries = 2) {
  let lastError

  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fetchWithTimeout(url, API_TIMEOUT)
      return result
    } catch (err) {
      lastError = err
      if (i < retries) {
        const delay = API_RETRY_DELAY[i] || 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * 调用天行数据新闻 API
 * @param {object} params
 * @param {number|null} params.col - 频道 ID，null 表示全部
 * @param {string} [params.word] - 搜索关键词
 * @param {number} [params.page=1] - 页码
 * @param {number} [params.num=10] - 每页条数
 * @returns {Promise<{list: Array, allnum: number, curpage: number}>}
 */
async function callTianApi({ col, word, page = 1, num = 10 }) {
  if (!config.tian.apiKey) {
    throw new Error('API_KEY_INVALID: 天行数据 API Key 未配置')
  }

  const params = new URLSearchParams()
  params.set('key', config.tian.apiKey)
  params.set('num', String(Math.min(num, 50)))
  params.set('page', String(page))

  if (col !== null && col !== undefined) {
    params.set('col', String(col))
  }
  if (word) {
    params.set('word', String(word).trim())
  }

  const url = `${config.tian.baseUrl}?${params.toString()}`
  console.log('[TianApi] 请求:', url.replace(config.tian.apiKey, '***'))

  const result = await callWithRetry(url)

  // 天行数据状态码处理
  if (result.code === 200) {
    // 注意：allnews 接口返回的新闻数组字段是 newslist（非 list）
    const list = result.result?.newslist || result.result?.list || []
    return {
      list,
      allnum: result.result?.allnum || 0,
      curpage: result.result?.curpage || page,
    }
  }

  // API 错误码映射
  const errorMap = {
    150: 'API_RATE_LIMIT',     // 次数不足
    160: 'API_NOT_APPLIED',    // 尚未申请该 API（需去控制台免费申请）
    230: 'API_KEY_INVALID',    // key无效
    100: 'API_SERVER_ERROR',   // 内部错误
    110: 'API_SERVER_ERROR',   // 内部错误
    120: 'API_SERVER_ERROR',   // 内部错误
    250: 'API_EMPTY_DATA',     // 无数据
  }

  const errorCode = errorMap[result.code] || `API_ERROR_${result.code}`
  const error = new Error(result.msg || '天行数据 API 返回异常')
  error.code = errorCode
  throw error
}

module.exports = { callTianApi }
