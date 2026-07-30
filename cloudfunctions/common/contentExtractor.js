/**
 * 正文提取器 — 零依赖实现（仅使用 Node.js 内置 https 模块）
 *
 * 背景：天行等免费新闻接口只返回 description（导语/摘要），不返回正文全文。
 *       但每条新闻都带有原文 URL（sourceUrl）。本模块根据 URL 抓取原文页面，
 *       用纯字符串/正则启发式提取正文段落，供 getNewsDetail 补全 content 字段。
 *
 * 设计约束：
 *   - 不引入第三方依赖（cheerio/jsdom/linkedom），避免云函数冷启动与内存负担。
 *   - 请求带 3s 超时与 UA，失败返回 null，由调用方降级到 summary。
 *   - 输出纯文本段落数组，单篇上限 5000 字，避免超大内容写入数据库。
 */

const https = require('https')
const http = require('http')
const { URL } = require('url')

// 单篇正文最大字数（超出截断）
const MAX_CONTENT_LENGTH = 5000
// 单次抓取最大字节数（防止异常大页面拖垮云函数）
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // 2MB
// 请求超时（毫秒）
const FETCH_TIMEOUT = 3000

/**
 * 发起 HTTP GET 请求，返回 HTML 文本（截断到上限）
 * @param {string} url
 * @returns {Promise<string|null>}
 */
function fetchHtml(url) {
  return new Promise((resolve) => {
    let client
    try {
      const parsed = new URL(url)
      client = parsed.protocol === 'http:' ? http : https
    } catch (_) {
      return resolve(null)
    }

    const req = client.get(
      url,
      {
        timeout: FETCH_TIMEOUT,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
      },
      (res) => {
        // 跟随一次重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return resolve(fetchHtml(new URL(res.headers.location, url).toString()))
        }
        if (res.statusCode !== 200) {
          res.resume()
          return resolve(null)
        }
        const chunks = []
        let total = 0
        res.on('data', (c) => {
          total += c.length
          if (total > MAX_DOWNLOAD_BYTES) {
            req.destroy()
            return
          }
          chunks.push(c)
        })
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      }
    )

    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(null))
  })
}

/**
 * 从 HTML 中定位正文容器（优先语义标签，其次常见 class/id）
 */
function locateBodyHtml(html) {
  // 常见正文容器选择器（按优先级）
  const patterns = [
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*id=["']paragraph["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*article-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) return m[1]
  }
  return null
}

/**
 * 从一段 HTML 中提取 <p> 文本段落
 */
function extractParagraphs(containerHtml) {
  if (!containerHtml) return []
  const paras = []
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = pRe.exec(containerHtml)) !== null) {
    const text = stripHtml(m[1]).replace(/\s+/g, ' ').trim()
    // 过滤过短（导航/图片说明）与过长的异常段落
    if (text.length >= 15) paras.push(text)
  }
  return paras
}

/**
 * 去 HTML 标签与空白控制字符
 */
function stripHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/[ ­­­­­]/g, ' ')
    .trim()
}

/**
 * 主入口：根据新闻原文 URL 提取正文纯文本段落
 * @param {string} url
 * @returns {Promise<string[]|null>} 段落数组；失败返回 null
 */
async function extractContent(url) {
  if (!url || !/^https?:\/\//i.test(url)) return null
  const html = await fetchHtml(url)
  if (!html) return null

  // 优先用语义容器；拿不到则退化为全页 <p> 提取
  let container = locateBodyHtml(html)
  let paras = extractParagraphs(container)
  if (paras.length < 2) {
    paras = extractParagraphs(html)
  }
  if (paras.length === 0) return null

  // 合并并截断到字数上限
  let joined = paras.join('\n')
  if (joined.length > MAX_CONTENT_LENGTH) {
    joined = joined.slice(0, MAX_CONTENT_LENGTH)
  }
  return joined.split('\n')
}

module.exports = { extractContent, fetchHtml, extractParagraphs, stripHtml }
