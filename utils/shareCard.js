/**
 * shareCard.js — 朋友圈单页模式分享卡打包/解析
 * ============================================================
 * 背景：微信朋友圈单页模式（scene 1154）禁路由/登录/云函数/本地存储不共用，
 *       落地页只能读到 onShareTimeline 打包进 query 的数据。
 *
 * v2（owner 2026-09-08 真机反馈后重构）：
 *  - 旧版 JSON+encodeURIComponent：中文 UTF-8 3 字节 → percent 编码 9 字符，
 *    400 字摘要 ≈ 3600 字符，超微信 query 安全长度的风险高。
 *  - 改 base64url(JSON)：中文 3B → 4B，膨胀仅 1.33 倍；字段收紧
 *    （title 40 / summary 100 / source 20 / time 20 / category 12），
 *    整包 query ≈ 900 字符以内。
 *  - 单页打开只渲染 components/single-page-card（与首页卡片设计一致），
 *    query 不再携带 id/index/category 前缀（单页模式下无用，纯省长度）。
 *  - parse 兼容旧版 percent-JSON 格式（已分享出去的历史链接仍可打开）。
 */

var MAX_TITLE = 40
var MAX_SUMMARY = 100
var MAX_SOURCE = 20
var MAX_TIME = 20
var MAX_CATEGORY = 12
var MAX_ID = 40

var CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/* ---------- UTF-8 ↔ 字节 ↔ base64url（小程序环境无 atob/btoa，手写实现） ---------- */

function utf8Bytes(str) {
  var bytes = []
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt ? str.codePointAt(i) : str.charCodeAt(i)
    if (code > 0xffff) i++ // 增补平面字符占两个 code unit，跳过低位代理
    if (code < 0x80) {
      bytes.push(code)
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    } else {
      bytes.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    }
  }
  return bytes
}

function bytesToUtf8(bytes) {
  var out = ''
  var i = 0
  while (i < bytes.length) {
    var b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b < 0xe0) {
      out += String.fromCharCode(((b & 31) << 6) | (bytes[i + 1] & 63))
      i += 2
    } else if (b < 0xf0) {
      out += String.fromCharCode(((b & 15) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63))
      i += 3
    } else {
      var cp = ((b & 7) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63)
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023))
      i += 4
    }
  }
  return out
}

function bytesToB64Url(bytes) {
  var out = ''
  for (var i = 0; i < bytes.length; i += 3) {
    var b1 = bytes[i]
    var b2 = bytes[i + 1]
    var b3 = bytes[i + 2]
    out += CHARS[b1 >> 2]
    out += CHARS[((b1 & 3) << 4) | ((b2 === undefined ? 0 : b2) >> 4)]
    out += b2 === undefined ? '' : CHARS[((b2 & 15) << 2) | ((b3 === undefined ? 0 : b3) >> 6)]
    out += b3 === undefined ? '' : CHARS[b3 & 63]
  }
  return out
}

function b64UrlToBytes(s) {
  var bytes = []
  var buffer = 0
  var bits = 0
  for (var i = 0; i < s.length; i++) {
    var idx = CHARS.indexOf(s.charAt(i))
    if (idx < 0) throw new Error('bad base64url char: ' + s.charAt(i))
    buffer = (buffer << 6) | idx
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 255)
    }
  }
  return bytes
}

/* ---------- 卡片打包 / 解析 ---------- */

/**
 * 归一化卡片字段（收紧长度，单页只展示首页卡片视觉所需的最小集）
 * @param {Object} news - 首页卡片/详情新闻对象
 * @returns {Object} 紧凑卡片 { t,c,s,tm,sum,ai,src,cs,id }
 */
function normalizeCard(news) {
  if (!news || !news.title) {
    // 无新闻时的兜底卡（保证单页模式打开总有内容）
    return { t: '一页 · 极简新闻速览', c: '', s: '', tm: '', sum: '', ai: false, src: '', cs: '', id: '' }
  }
  return {
    t: String(news.title || '').slice(0, MAX_TITLE),
    c: String(news.categoryName || news.category || '').slice(0, MAX_CATEGORY),
    s: String(news.source || news.sourceName || news.metaSource || '').slice(0, MAX_SOURCE),
    tm: String(news.time || '').slice(0, MAX_TIME),
    sum: String(news.summary || '').slice(0, MAX_SUMMARY),
    ai: news.summarySource === 'ai' || news.isAiSummary === true || news.isAi === true,
    src: String(news.summarySource || '').slice(0, 10),
    cs: String(news.contentSource || '').slice(0, 20),
    id: String(news.id || '').slice(0, MAX_ID),
  }
}

/**
 * 把新闻卡片对象打包成 query 字符串（供 onShareTimeline query 用）
 * @param {Object} news - 首页卡片/详情新闻对象
 * @returns {string} query（"card=" + base64url(JSON)，无多余前缀）
 */
function buildCardQuery(news) {
  return 'card=' + bytesToB64Url(utf8Bytes(JSON.stringify(normalizeCard(news))))
}

/**
 * 解析 onLoad query 里的卡片数据（兼容 v2 base64url 与 v1 percent-JSON）
 * @param {Object} query - onLoad 的 options
 * @returns {Object|null} 卡片数据 { title, categoryName, source, time, summary, isAi, id, summarySource, contentSource }
 */
function parseCardData(query) {
  if (!query || !query.card) return null
  var raw = String(query.card)
  var d = null
  try {
    d = JSON.parse(bytesToUtf8(b64UrlToBytes(raw)))
  } catch (e) {
    d = null
  }
  if (!d || !d.t) {
    // v1 兼容：旧版 percent-encoded JSON（历史分享链接）
    try {
      d = JSON.parse(decodeURIComponent(raw))
    } catch (e2) {
      d = null
    }
  }
  if (!d || !d.t) return null
  return {
    title: d.t,
    categoryName: d.c || '',
    source: d.s || '',
    time: d.tm || '',
    summary: d.sum || '',
    isAi: !!d.ai,
    id: d.id || '',
    summarySource: d.src || (d.ai ? 'ai' : ''),
    contentSource: d.cs || '',
  }
}

module.exports = { buildCardQuery, parseCardData }
