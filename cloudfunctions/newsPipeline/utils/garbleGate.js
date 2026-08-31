/**
 * garbleGate — news_cache 注入前乱码闸门（Stage 3 publish 最后一步兜底）
 * ============================================================
 * 背景（2026-08-31 乱码事故复盘）：
 *   news_cache 的 summary/content 曾批量出现 U+FFFD（豆腐块），定位为
 *   LLM 响应流被 `data += chunk` 逐块解码、多字节中文被 TCP 分片切断所致
 *   （根因修复：utils/contentFetcher.js 两处 AI 响应读取已改为 Buffer.concat 整体解码）。
 *   本闸门是「最后一步」防线：任何来源（RSS desc、历史 staging、上游 AI）漏网的
 *   替换字符/私用区/控制字符，在写库前统一清洗，保证入库即净。
 *
 * 设计原则：
 *   1. U+FFFD 是有损替换——原字符已丢失，字符串层面无法还原，只能剥除；
 *      真正的修复在上游（contentFetcher 的 Buffer 收集 + GBK 检测解码）。
 *   2. 清洗只做无损最小集：剥 U+FFFD/私用区/控制字符；不改写正常文案，
 *      不做引号/空白归一（避免破坏 content 排版与既有判重指纹口径）。
 *   3. 不阻断注入：清洗后照常写库（缺 1 字远好于丢整条/整批），
 *      逐字段计数走日志，供观测上游是否仍在产生脏数据。
 */

const FFFD_RE = /\uFFFD/g
const PUA_RE = /[\uE000-\uF8FF]/g
const CTRL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

// 需要过闸门的文本字段（news_cache 文档中的人工可读字段）
const TEXT_FIELDS = ['title', 'summary', 'content', 'aiOpinion', 'categoryName', 'sourceName', 'source']

/** 单字段清洗，返回清洗后文本（无需清洗则原样返回） */
function cleanText(s) {
  if (typeof s !== 'string' || !s) return s
  return s.replace(FFFD_RE, '').replace(PUA_RE, '').replace(CTRL_RE, '')
}

/** 统计字符串中 U+FFFD 处数（观测上游脏数据信号） */
function countHits(s) {
  if (typeof s !== 'string' || !s) return 0
  const m = s.match(FFFD_RE)
  return m ? m.length : 0
}

/**
 * 注入前闸门：原地清洗 doc 的文本字段。
 * @param {Object} doc 待写 news_cache 的 docData（原地修改）
 * @returns {{changed: boolean, details: Object<string,number>}} details 记录各字段剥除的 U+FFFD 数
 */
function garbleGate(doc) {
  const details = {}
  let changed = false
  for (const f of TEXT_FIELDS) {
    const v = doc[f]
    if (typeof v !== 'string' || !v) continue
    const hits = countHits(v)
    const cleaned = cleanText(v)
    if (cleaned !== v) {
      doc[f] = cleaned
      changed = true
      if (hits) details[f] = hits
    }
  }
  return { changed, details }
}

/** 乱码分级（检测层）：每条入库前判定乱码严重度，决定 还原 / 清洗 / 丢弃 */
// 阈值（owner 2026-08-31）：某字段 U+FFFD ≥ HEAVY_THRESHOLD 或 占比 ≥ HEAVY_RATIO 判重度
const HEAVY_THRESHOLD = 3            // 单字段 U+FFFD 数
const HEAVY_RATIO = 0.05             // 占比 5%
const LIGHT_THRESHOLD = 1            // ≥1 个即记轻度（走清洗）

/**
 * 分类一条文档的乱码等级。
 * @param {Object} doc 待检文档（含 summary/content）
 * @returns {{level:'clean'|'light'|'heavy', hits:Object<string,number>, heavyFields:Array, totalHits:number}}
 *   clean  无乱码 → 直接入库
 *   light  轻微（<阈值）→ garbleGate 清洗后入库
 *   heavy  重度 → 需还原（打回 AI 重跑）或丢弃
 */
function classifyGarbled(doc) {
  const hits = {}
  for (const f of ['title', 'summary', 'content', 'aiOpinion']) {
    const n = countHits(doc[f])
    if (n > 0) hits[f] = n
  }
  const totalHits = Object.values(hits).reduce((a, b) => a + b, 0)
  if (totalHits === 0) return { level: 'clean', hits, heavyFields: [], totalHits }

  const heavyFields = []
  for (const [f, n] of Object.entries(hits)) {
    const len = String(doc[f] || '').length
    const ratio = len > 0 ? n / len : 0
    if (n >= HEAVY_THRESHOLD || ratio >= HEAVY_RATIO) heavyFields.push(f)
  }
  return {
    level: heavyFields.length ? 'heavy' : 'light',
    hits, heavyFields, totalHits,
  }
}

module.exports = { garbleGate, cleanText, countHits, classifyGarbled }
