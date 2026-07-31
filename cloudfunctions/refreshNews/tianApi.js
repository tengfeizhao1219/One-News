/**
 * 天行数据 API 调用封装（主数据源）
 */

const config = require('./config')
const { API_TIMEOUT, API_RETRY_DELAY } = { API_TIMEOUT: config.tian.timeout, API_RETRY_DELAY: config.tian.retryDelay }

/**
 * 带超时的 HTTP 请求
 */
function fetchWithTimeout(url, timeout) {
  const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB 上限（B-11）
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('https') ? require('https') : require('http')).get(url, (res) => {
      clearTimeout(timer)
      // B-11: 检查 HTTP 状态码
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const err = new Error(`HTTP_${res.statusCode}`)
        err.code = 'HTTP_STATUS_ERROR'
        return reject(err)
      }
      let data = ''
      let dataSize = 0
      res.on('data', chunk => {
        dataSize += chunk.length
        // B-11: 响应体大小上限
        if (dataSize > MAX_RESPONSE_SIZE) {
          req.destroy()
          return reject(new Error('RESPONSE_TOO_LARGE'))
        }
        data += chunk
      })
      res.on('end', () => {
        try {
          resolve(JSON.parse(data))
        } catch (e) {
          reject(new Error('API_INVALID_RESPONSE'))
        }
      })
    })
    const timer = setTimeout(() => {
      // B-11: 超时时销毁底层 socket，防止连接泄漏
      req.destroy()
      reject(new Error('API_TIMEOUT'))
    }, timeout)

    req.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

/**
 * 带重试的 API 调用（B-11: 不重试不可恢复错误）
 */
const NON_RETRYABLE = ['API_KEY_INVALID', 'API_NOT_APPLIED']

async function callWithRetry(url, retries = 2) {
  let lastError

  for (let i = 0; i <= retries; i++) {
    try {
      const result = await fetchWithTimeout(url, API_TIMEOUT)
      return result
    } catch (err) {
      lastError = err
      // B-11: 不可恢复错误不重试
      if (err.code && NON_RETRYABLE.includes(err.code)) {
        break
      }
      if (i < retries) {
        const delay = API_RETRY_DELAY[i] || 1000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError
}

/**
 * 调用天行数据新闻 API（按分类 endpoint 路由）
 *
 * 注意：天行 allnews 聚合接口需单独申请（未申请返回 code:160），
 * 因此改为按已申请的分类专属接口路由，例如：
 *   guonei(国内) / world(国际) / keji(科技) / generalnews(综合)
 * 拼接规则：${config.tian.baseUrl}/{endpoint}/index
 *
 * @param {object} params
 * @param {string} [params.endpoint='generalnews'] - 天行分类接口名，如 guonei/world/keji/generalnews
 * @param {string} [params.word] - 搜索关键词（综合/分类接口支持）
 * @param {number} [params.page=1] - 页码
 * @param {number} [params.num=10] - 每页条数（最大 50）
 * @returns {Promise<{list: Array, allnum: number, curpage: number}>}
 */
async function callTianApi({ endpoint = 'generalnews', word, page = 1, num = 10 }) {
  if (!config.tian.apiKey) {
    throw new Error('API_KEY_INVALID: 天行数据 API Key 未配置')
  }

  const params = new URLSearchParams()
  params.set('key', config.tian.apiKey)
  params.set('num', String(Math.min(num, 50)))
  params.set('page', String(page))

  if (word) {
    params.set('word', String(word).trim())
  }

  const url = `${config.tian.baseUrl}/${endpoint}/index?${params.toString()}`
  console.log('[TianApi] 请求:', url.replace(config.tian.apiKey, '***'))

  const result = await callWithRetry(url)

  // 天行数据状态码处理（B-11: 宽松比较，兼容字符串 "200"）
  if (Number(result.code) === 200) {
    // 天行分类接口返回的新闻数组字段统一为 newslist（部分旧接口为 list，做兼容）
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
