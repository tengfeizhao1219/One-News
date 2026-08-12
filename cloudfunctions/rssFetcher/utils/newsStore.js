/**
 * newsStore.js — 官方源新闻数据落库（去重 + 批量写入）
 * ============================================================
 * 对齐方案 §5/§2：写 news_raw_official，urlFp/titleFp 双唯一去重。
 * 版权红线：只存 title/url/summary + 元信息，不存正文全文。
 * ============================================================
 */

const cloud = require('wx-server-sdk')
const { sha256 } = require('./validator')
const qualityScorer = require('./qualityScorer')

function col() {
  return cloud.database().collection('news_raw_official')
}

/**
 * 对一批候选项做 urlFp/titleFp 去重，返回「需新增」与「重复数/重复样本」。
 * 应用层先查再插，库层唯一索引兜底（并发时靠 add 失败重试/忽略）。
 * @param {Array<Object>} items - validator.validate 输出的 item
 * @returns {Promise<{inserts:Array<Object>, duplicates:number, dupSamples:string[]}>}
 */
async function filterDuplicates(items) {
  const inserts = []
  const dupSamples = []
  let duplicates = 0

  if (!items || !items.length) return { inserts, duplicates, dupSamples }

  // 分批查库（云数据库一次 where in 有上限，按 50 一批）
  const B = 50
  for (let i = 0; i < items.length; i += B) {
    const batch = items.slice(i, i + B)
    const urlFps = batch.map((it) => it.urlFp)
    const titleFps = batch.map((it) => it.titleFp)

    let existing = []
    try {
      // 用 _id（=official_xxx）或 urlFp 查；此处按 urlFp 主键查（唯一索引贴 _id）
      const res = await cloud.database().collection('news_raw_official')
        .where({ urlFp: cloud.database().command.in(urlFps) })
        .field({ urlFp: true, titleFp: true })
        .limit(B)
        .get()
      existing = res.data || []
    } catch (e) {
      // 查询失败（集合不存在等）按无重复处理，交由 ensureSchema 自愈建表
      existing = []
    }

    const existingUrls = new Set(existing.map((r) => r.urlFp))
    const existingTitles = new Set(existing.map((r) => r.titleFp))

    for (const it of batch) {
      if (existingUrls.has(it.urlFp)) {
        duplicates++
        if (dupSamples.length < 5) dupSamples.push(it.title)
        continue
      }
      if (existingTitles.has(it.titleFp)) {
        duplicates++
        if (dupSamples.length < 5) dupSamples.push(`${it.title}(同稿)`)
        continue
      }
      inserts.push(it)
    }
  }

  return { inserts, duplicates, dupSamples }
}

/**
 * 批量写入新增项（每次 add，云数据库单次最多写一批；失败可忽略并计数）。
 * 质量门：写入前逐条调用 qualityScorer.attachScore；qualityPassed=false 的不落库（rejected），
 *   并附加 qualityScore/finalScore/heatScore/qualityDetail 字段到已通过条目。
 * @param {Array<Object>} items
 * @returns {Promise<{written:number, failed:number, rejectedCount:number, rejected:Array<string>}>}
 */
async function batchInsert(items) {
  let written = 0
  let failed = 0
  let rejectedCount = 0
  const rejected = []
  if (!items || !items.length) return { written, failed, rejectedCount, rejected }

  for (const it of items) {
    // 质量门（⑥ 合规 + 质量分门控）：未通过 → 跳过落库
    const scored = qualityScorer.attachScore(it)
    if (scored.qualityPassed === false) {
      rejectedCount++
      rejected.push(scored.title ? scored.title.substring(0, 30) : '(untitled)')
      if (rejected.length <= 5) {
        console.log(`[newsStore] ${scored.sourceId} 质量门拦截: ${scored.rejectReason || scored.gated} → ${(scored.title || '').substring(0, 30)}`)
      }
      continue
    }

    const doc = Object.assign({}, it, {
      _id: `official_${it.urlFp}`,
      content_mode: 'official_rss',
      status: 'active',
    })
    try {
      await col().add({ data: doc })
      written++
    } catch (e) {
      // 唯一键冲突：并发下另一实例已写入，视为已存在（不算失败）
      const msg = ((e && (e.errMsg || e.message)) || '').toString()
      if (msg.includes('duplicate') || msg.includes('already') || msg.includes('11000') || msg.includes('-502001')) {
        written++ // 逻辑上已存在，跳过
      } else {
        failed++
        console.warn(`[newsStore] 写入失败(${it.sourceId}):`, e.message)
      }
    }
  }
  return { written, failed, rejectedCount, rejected }
}

module.exports = { filterDuplicates, batchInsert, sha256 }
