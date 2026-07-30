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
 *   - 过滤免责声明、来源时间戳列表、推荐列表等非正文噪音。
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

// 已知正文结束标记（开始匹配到这些就停止追加段落）
const END_MARKERS = [
  '本文系用户投稿',
  '不代表本网观点',
  '本网站所刊登新闻',
  '本网站所刊载信息',
  '不代表本站观点',
  '版权所有',
  '转载请注明来源',
]

// 噪音关键词（段落包含即丢弃）
const NOISE_KEYWORDS = [
  'Notice:',
  'NetEase Hao',
  'the content above',
  'uploaded and posted by',
  'information storage services',
  '本平台仅提供信息存储服务',
  '本平台',
  '上传并发布',
  '不代表本网观点',
  '仅代表作者观点',
  '不代表本网站观点',
  '如有侵权',
  '请联系删除',
  '联系删除',
  '投诉建议',
  '广告声明',
  '文内含有的对外跳转链接',
  '结果仅供参考',
  '所有文章均包含本声明',
  '特别声明',
  '免责声明',
  '郑重声明',
  '本文编辑',
  '编辑：',
  '责编：',
  '校对：',
  '值班编辑',
  '值班主编',
  '监制：',
  '主编：',
  '出品人',
  '来源：',
  '相关阅读',
  '推荐阅读',
  '猜你喜欢',
  '热门推荐',
  '延伸阅读',
  '您可能感兴趣',
  '大家都在看',
  '精彩推荐',
  '关注我们',
  '扫码关注',
  '关注微信公众号',
  '下载 APP',
  '打开 APP',
  '收藏',
  '举报',
  '我来说两句',
  '评论区',
  '精彩评论',
  '查看评论',
  '返回搜狐',
  '查看更多',
  '责任编辑',
]

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
    const text = stripHtml(m[1]).trim()
    if (text.length >= 15) paras.push(text)
  }
  return paras
}

/**
 * 判断是否段落为来源/时间戳列表项，如 "金融界 2026-07-29 17:28:32"
 */
function isSourceTimestamp(text) {
  // 典型格式：任意文字 + 日期时间
  return /^[^\d]{2,20}?\s+\d{4}[-/]\d{2}[-/]\d{2}\s+\d{1,2}:\d{2}(:\d{2})?$/.test(text)
}

/**
 * 判断段落是否为纯来源名（如 "金融界"、"野马财经"、"主持人杨杨"）
 */
function isStandaloneSourceName(text) {
  return /^[\u4e00-\u9fa5a-zA-Z]{2,12}$/.test(text) && text.length <= 12
}

/**
 * 判断段落是否包含噪音信息
 */
function isNoiseParagraph(text) {
  const lower = text.toLowerCase()

  // 过短
  if (text.length < 18) return true

  // 结尾为来源+时间戳
  if (isSourceTimestamp(text)) return true

  // 纯来源名
  if (isStandaloneSourceName(text)) return true

  // 关键词命中（含正文结束标记，避免免责声明段漏网）
  for (const kw of NOISE_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true
  }
  for (const m of END_MARKERS) {
    if (text.includes(m)) return true
  }

  // 典型邮箱/联系方式短句
  if (/@\w+\.\w{2,6}/.test(text) && text.length < 80) return true

  return false
}

/**
 * 检测连续的时间戳列表并全部丢弃
 */
function filterTimestampRuns(paras) {
  const result = []
  let skipCount = 0
  for (let i = 0; i < paras.length; i++) {
    if (skipCount > 0) { skipCount--; continue }
    if (isSourceTimestamp(paras[i])) {
      // 向后看，连续出现 2 条及以上时间戳则视为来源列表，全部丢弃
      let run = 1
      while (i + run < paras.length && isSourceTimestamp(paras[i + run])) run++
      if (run >= 2) {
        skipCount = run - 1
        continue
      }
    }
    result.push(paras[i])
  }
  return result
}

/**
 * 过滤并清理段落列表
 */
function cleanParagraphs(paras) {
  let result = paras
    .map(p => p.replace(/[\u00A0\u2000-\u200B\u205F\u3000]+/g, ' ').replace(/[ \t\u00A0\u3000]{2,}/g, ' ').trim())
    .filter(p => p.length >= 18)
    .filter(p => !isNoiseParagraph(p))

  result = filterTimestampRuns(result)

  // 正文结束截断：遇到结束标记（免责声明/版权声明等）后的内容都丢弃
  const cleaned = []
  for (const p of result) {
    if (END_MARKERS.some(m => p.includes(m))) break
    cleaned.push(p)
  }

  return cleaned
}

/**
 * 去 HTML 标签与 HTML 实体
 */
function stripHtml(str) {
  if (!str) return ''
  return String(str)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    // 常见空白/特殊实体
    .replace(/&nbsp;/gi, ' ')
    .replace(/&emsp;/gi, ' ')
    .replace(/&ensp;/gi, ' ')
    .replace(/&thinsp;/gi, ' ')
    .replace(/&zwnj;/gi, '')
    .replace(/&zwsp;/gi, '')
    .replace(/&shy;/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x[0-9a-fA-F]+;/g, ' ')
    .replace(/&#\d+;/g, ' ')
    .replace(/[\u00A0\u2000-\u200B\u205F\u3000]/g, ' ')
    // 折叠连续空白（多个 &emsp;/&nbsp; 退化成的多空格、制表符等）
    .replace(/[ \t\u00A0\u3000]{2,}/g, ' ')
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

  paras = cleanParagraphs(paras)
  if (paras.length === 0) return null

  // 合并并截断到字数上限
  let joined = paras.join('\n')
  if (joined.length > MAX_CONTENT_LENGTH) {
    joined = joined.slice(0, MAX_CONTENT_LENGTH)
  }
  return joined.split('\n')
}

/**
 * 根据新闻原文 URL 提取一段摘要（首段正文），用于列表卡片在无简介时兜底
 * @param {string} url
 * @param {number} [maxLen=90] 摘要最大字数（超出截断并加省略号）
 * @returns {Promise<string|null>}
 */
async function extractSummary(url, maxLen = 90) {
  if (!url || !/^https?:\/\//i.test(url)) return null
  const html = await fetchHtml(url)
  if (!html) return null

  let container = locateBodyHtml(html)
  let paras = extractParagraphs(container)
  if (paras.length < 1) paras = extractParagraphs(html)
  if (paras.length === 0) return null

  // 复用正文噪音清洗，取首个有效段落作为摘要
  const cleaned = cleanParagraphs(paras)
  const summary = (cleaned[0] || paras[0] || '').trim()
  if (!summary) return null
  if (summary.length > maxLen) return summary.slice(0, maxLen) + '…'
  return summary
}

module.exports = { extractContent, extractSummary, fetchHtml, extractParagraphs, stripHtml, cleanParagraphs }
