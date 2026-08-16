/**
 * apiFetch.js — 通用 HTTP 抓取工具（rssFetcher 首次抽出，多源复用）
 * ============================================================
 * 契约要点（FS-多源接入统一适配器接口契约 · 2026-08-11）：
 *   - 超时 30s / 失败重试 2 次（共 3 次尝试）
 *   - 遵循 Last-Modified / ETag 缓存语义：传上次值，收到 304 直接返回 notModified
 *     （既省带宽又守源站礼节，避免被拉黑）
 *   - 编码：GBK→UTF-8 转码（中新网等旧站 feed 可能为非 UTF-8）
 *   - 指定 UA，模拟正常抓取者，避开无 UA 数据中心请求被反爬拦截
 * ============================================================
 */

// ─── 常量 ───
const REQUEST_TIMEOUT_MS = 30 * 1000 // 30s
const MAX_RETRIES = 2 // 失败重试 2 次（共 3 次尝试）
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 // 5MB，防超大 feed 撑爆云函数内存
const DEFAULT_UA = 'Mozilla/5.0 (compatible; OneNewsRSS/1.0; +news.onenews.app)'

// 单请求发起（不重试）。返回 Promise<{status, headers, rawBuffer, notModified}>
function _requestOnce(url, { headers = {}, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? require('https') : require('http')
    const req = protocol.get(url, {
      timeout: timeoutMs,
      headers: Object.assign(
        {
          'User-Agent': DEFAULT_UA,
          'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          'Cache-Control': 'no-cache',
        },
        headers,
      ),
    }, (res) => {
      const status = res.statusCode || 0
      // 304 Not Modified：内容未变化，按缓存语义跳过
      if (status === 304) {
        res.resume()
        resolve({ status, notModified: true, rawBuffer: null, headers: res.headers })
        return
      }
      // 跟随一次重定向（301/302/303/307）
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        // 递归但不再记入外层重试计数（这里只处理单跳，多层重定向靠重试兜底）
        return _requestOnce(nextUrl, { headers, timeoutMs }).then(resolve)
      }
      const chunks = []
      let total = 0
      res.on('data', (chunk) => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          req.destroy()
          resolve({ status, notModified: false, rawBuffer: Buffer.concat(chunks), headers: res.headers })
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => {
        resolve({ status, notModified: false, rawBuffer: Buffer.concat(chunks), headers: res.headers })
      })
      res.on('error', () => {
        resolve({ status, notModified: false, rawBuffer: null, headers: res.headers })
      })
    })
    req.on('error', () => resolve({ status: 0, notModified: false, rawBuffer: null, headers: {} }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ status: 0, notModified: false, rawBuffer: null, headers: {} })
    })
    req.end()
  })
}

/**
 * 从 buffer 检测并转码为 UTF-8 字符串。
 * RSS 源常见编码：UTF-8 / GBK / GB2312。优先信任 XML 声明的 encoding；
 * 无声明时按 BOM 或常见启发式判断，默认 UTF-8。
 * @param {Buffer|null} buffer
 * @param {Object} [options]
 * @param {string} [options.declaredEncoding]  XML 声明的 encoding（rssParser 解析时传入）
 * @returns {string}
 */
function decodeBuffer(buffer, options = {}) {
  const buf = Buffer.from(buffer)
  // 1) BOM 优先
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return buf.slice(3).toString('utf8')
  }
  // 2) XML 声明指定的编码
  const declared = (options.declaredEncoding || '').toLowerCase()
  const enc = declared || detectEncodingFromXml(buf)
  if (enc && enc !== 'utf-8' && enc !== 'utf8') {
    const decoded = decodeWith(enc, buf)
    if (decoded != null) return decoded
  }
  // 3) 兜底 UTF-8（含无声明场景）
  return buf.toString('utf8')
}

/** 从 XML 文本里粗扫声明（仅当未传入 declaredEncoding 时） */
function detectEncodingFromXml(buf) {
  // 只看前 200 字节内的声明，避免解析大 payload
  const head = buf.slice(0, 200).toString('utf8')
  const m = /encoding\s*=\s*["']([^"']+)["']/i.exec(head)
  return m ? m[1].toLowerCase() : null
}

/** 尝试用指定编码解码；环境不支持时返回 null → 走 UTF-8 兜底 */
function decodeWith(enc, buf) {
  try {
    // 优先用 Node TextDecoder（full-icu 下支持 gbk/gb2312）
    const canonical = enc.replace(/[-_]/g, '').toLowerCase()
    if (canonical === 'gbk' || canonical === 'gb2312' || canonical === 'gb18030') {
      if (typeof TextDecoder !== 'undefined') {
        return new TextDecoder('gbk').decode(buf)
      }
      // 回退 iconv-lite（懒加载，仅 GBK 场景才 require，避免空载）
      try {
        const iconv = require('iconv-lite')
        return iconv.decode(buf, 'gbk')
      } catch (e) {
        return null
      }
    }
    // 其他声明编码（如 iso-8859-1）用 TextDecoder 尝试
    if (typeof TextDecoder !== 'undefined') {
      try {
        const td = new TextDecoder(enc)
        if (td.encoding !== 'utf-8') return td.decode(buf)
      } catch (e) { /* 忽略，走兜底 */ }
    }
    return null
  } catch (e) {
    return null
  }
}

/**
 * 抓取一个 URL，返回结构化的抓取结果。
 * @param {string} url
 * @param {Object} [options]
 * @param {Object} [options.headers]         附加请求头（含缓存头 Last-Modified/ETag）
 * @param {Object} [options.prev]            上次抓取元信息，用于 304 语义
 *   @param {string} [options.prev.lastModified]
 *   @param {string} [options.prev.etag]
 * @returns {Promise<{ok:boolean, notModified:boolean, text:string|null,
 *           status:number, lastModified:string|null, etag:string|null}>}
 */
async function get(url, options = {}) {
  const prev = options.prev || {}
  const cacheHeaders = {}
  if (prev.lastModified) cacheHeaders['If-Modified-Since'] = prev.lastModified
  if (prev.etag) cacheHeaders['If-None-Match'] = prev.etag

  let resp = null
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    resp = await _requestOnce(url, { headers: Object.assign(cacheHeaders, options.headers || {}) })
    // 200 / 304 均为有效响应，直接返回；其余状态（5xx/超时/0）进入重试
    if (resp.status === 200 || resp.status === 304) break
    // 4xx 客户端错误重试无意义（URL 错了），直接放弃
    if (resp.status >= 400 && resp.status < 500) break
  }

  const lastModified = (resp.headers['last-modified'] || null)
  const etag = (resp.headers['etag'] || null)

  if (resp.notModified) {
    return { ok: true, notModified: true, text: null, status: 304, lastModified, etag }
  }
  if (resp.status !== 200 || !resp.rawBuffer) {
    return { ok: false, notModified: false, text: null, status: resp.status, lastModified, etag }
  }
  // 从 buffer 头扫一次 XML 声明编码，交给 decodeBuffer 做正确转码
  const rawText = Buffer.from(resp.rawBuffer).slice(0, 200).toString('utf8')
  const em = /encoding\s*=\s*["']([^"']+)["']/i.exec(rawText)
  return {
    ok: true, notModified: false,
    text: decodeBuffer(resp.rawBuffer, em ? { declaredEncoding: em[1] } : {}),
    status: 200, lastModified, etag,
  }
}

module.exports = { get, decodeBuffer }
