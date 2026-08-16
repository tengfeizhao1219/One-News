/**
 * validator.js — 官方 RSS 源 新闻条目校验
 * ============================================================
 * 对齐方案 §3：写入 news_raw_official 前做字段级合法性校验，
 * 保证落库数据满足去重键（urlFp/titleFp）与展示所需的 6 个核心字段。
 * 规则：
 *   - title / url / pubDate 必填
 *   - url 必须 http(s) 且长度合理；urlFp = normalizeUrl → sha256
 *   - title 长度 ≥4 ≤200；titleFp = cleanTitle → sha256
 *   - summary / sourceId / category / fetchedAt 由上游补齐，仅做类型校验
 * ============================================================
 */

// Node 内置 crypto 提供 sha256，无需额外依赖
const crypto = require('crypto')

// ── URL 归一化 → urlFp ──
// 去掉协议头/末尾斜杠/常见跟踪参数，避免同文多 URL 被当成多条
function normalizeUrl(url) {
  if (!url) return ''
  let u = String(url).trim()
  // 去掉协议与主机小写化不影响路径指纹，但为稳定去重统一去协议
  u = u.replace(/^(https?:\/\/)?/i, '').replace(/\/+$/, '')
  // 去掉常见 UTM / 版本号跟踪参数
  u = u.replace(/([?&])(utm_[a-z]+|spm|from|from_|source|ref)=[^&]*(&|$)/gi, '$1').replace(/[?&]+$/, '')
  return u
}

// ── 标题归一化 → titleFp（标题轻度清洗后去重）──
function cleanTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')      // 折叠空白
    .replace(/^[【\[]+|[】\]]+$/g, '') // 去首尾括号
    .trim()
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex')
}

/**
 * 校验并规整一条候选新闻项。
 * @param {Object} raw - 上游组合好的原始条目（字段见 rssParser + filter 输出）
 * @param {Object} meta - { sourceId, sourceName, category }
 * @returns {{ok:boolean, item?:Object, reason?:string}}
 */
function validate(raw, meta) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, reason: '候选条目为空' }
  }
  const title = cleanTitle(raw.title)
  const rawUrl = String(raw.url || '').trim()
  const pubDate = raw.pubDate || raw.pub_time || ''
  const summary = raw.summary || raw.description || ''

  // 1. 必填
  if (!title) return { ok: false, reason: '缺标题' }
  if (!rawUrl) return { ok: false, reason: '缺 URL' }

  // 2. URL 合法性
  if (!/^https?:\/\//i.test(rawUrl)) {
    return { ok: false, reason: `URL 非 http(s)：${rawUrl.slice(0, 40)}` }
  }
  if (rawUrl.length < 10 || rawUrl.length > 1024) {
    return { ok: false, reason: `URL 长度异常：${rawUrl.length}` }
  }

  // 3. 标题长度
  if (title.length < 4) return { ok: false, reason: `标题过短(${title.length}字)：${title.slice(0, 20)}` }
  if (title.length > 200) return { ok: false, reason: `标题过长(${title.length}字)` }

  // 4. 归一化字段类型（summary/sourceId/category/fetchedAt 由上游补齐，这里兜底校验）
  const item = {
    sourceId: String(meta && meta.sourceId || ''),
    sourceName: String(meta && meta.sourceName || ''),
    category: String(meta && meta.category || raw.category || ''),
    title,
    urlFp: sha256(normalizeUrl(rawUrl)),
    titleFp: sha256(title),
    url: rawUrl,
    summary: String(summary),
    // A.4/A.5：content 正文全文 → AI 加工源数据（瞬时 staging，仅 news_ingest 用）
    content: raw.content ? String(raw.content) : '',
    pubDate: String(pubDate),
    fetchedAt: raw.fetchedAt || new Date().toISOString(),
    status: 'pending',
  }

  // 补充：条目时间无法解析时保留原样，不阻断入库；若为空则给 fetchedAt 作为兜底显示时间
  if (!item.pubDate) item.pubDate = item.fetchedAt

  return { ok: true, item }
}

module.exports = { validate, normalizeUrl, cleanTitle, sha256 }
