/**
 * 聚合数据 API 调用封装（备用数据源）
 */

const config = require('./config')

/**
 * 带超时的 POST 请求
 */
function postWithTimeout(url, data, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('API_TIMEOUT')), timeout)

    const urlObj = new URL(url)
    const https = require('https')
    const http = require('http')
    const client = urlObj.protocol === 'https:' ? https : http

    const postData = new URLSearchParams(data).toString()

    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    }

    const req = client.request(options, (res) => {
      clearTimeout(timer)
      let body = ''
      res.on('data', chunk => { body += chunk })
      res.on('end', () => {
        try {
          resolve(JSON.parse(body))
        } catch (e) {
          reject(new Error('API_INVALID_RESPONSE'))
        }
      })
    })

    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })

    req.write(postData)
    req.end()
  })
}

/**
 * 调用聚合数据新闻头条 API
 * @param {object} params
 * @param {string|null} params.type - 分类类型，null 表示默认
 * @param {number} [params.page=1] - 页码
 * @param {number} [params.page_size=10] - 每页条数
 * @returns {Promise<{list: Array}>}
 */
async function callJuheApi({ type, page = 1, page_size = 10 }) {
  if (!config.juhe.apiKey) {
    throw new Error('API_KEY_INVALID: 聚合数据 API Key 未配置')
  }

  const data = {
    key: config.juhe.apiKey,
    page: String(page),
    page_size: String(Math.min(page_size, 30)),
    is_filter: '1',
  }

  if (type) {
    data.type = type
  }

  console.log('[JuheApi] 请求 type:', type, 'page:', page)

  const result = await postWithTimeout(config.juhe.baseUrl, data, config.juhe.timeout)

  // 聚合数据错误码处理
  if (result.error_code === 0 && result.result?.stat === '1') {
    return {
      list: result.result.data || [],
    }
  }

  const error = new Error(result.reason || '聚合数据 API 返回异常')
  error.code = 'JUHE_API_ERROR'
  throw error
}

module.exports = { callJuheApi }
