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
const newsIngestStore = require('./newsIngestStore')

// ── 官方源源站分类 → 前端 5 tab 分类映射（v1.2 路线1）──
// 官方源 feed.category 是源站原始栏目（finance/edu/culture/society/health/book/house...），
// 前端只有 recommend/tech/international/sports/life 5 个 tab。写入 news_ingest 时统一映射，
// 保证官方源上首页后落在可见 tab（"全部"天然可见所有分类）。
const OFFICIAL_CATEGORY_MAP = {
  tech: 'tech', digital: 'tech', auto: 'tech', it: 'tech',
  // owner 8/13：官方 RSS 条目级「科学探索」栏目（IT之家等）→ 科学探索 tab（前端 id=sports）
  science: 'sports', sci: 'sports',
  sports: 'sports',
  life: 'life', edu: 'life', culture: 'life', health: 'life', book: 'life',
  house: 'life', society: 'life', finance: 'life', economy: 'life', money: 'life',
  world: 'international', international: 'international', global: 'international',
  // owner 8/13：体育类源（虎扑/中新体育/juhe tiyu）改并入「推荐」综合流，不再进科学探索 tab
  recommend: 'recommend',
}

/**
 * 官方源源站分类 → 前端 tab 分类（未命中兜底 life=社会）
 * @param {string} srcCategory
 * @returns {string}
 */
function mapOfficialCategory(srcCategory) {
  const c = String(srcCategory || '').trim().toLowerCase()
  return OFFICIAL_CATEGORY_MAP[c] || 'life'
}

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
    // 版权红线（A.4/A.5）：news_raw_official 归档只存 title/url/summary，绝不落 content 正文全文；
    // content 仅走 news_ingest 瞬时 staging（见 batchInsertToIngest）。
    delete doc.content
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

/**
 * 批量写入新增项到 news_ingest（staging，含 content 供 AI 加工；瞬时，批次后清除）。
 * 字段对齐 newsIngestStore.buildInputDoc 输入形态：
 *   { sourceType, sourceName, title, summary, url, content, category, publishTime, fetchedAt }
 * 幂等：_id = ingest_${urlFp}（有 URL 时），重复写入自动跳过。
 * @param {Array<Object>} items - validator.validate 输出的 item（含 content）
 * @param {Object} [opts] - { sourceName? }
 * @returns {Promise<{written:number, failed:number, total:number}>}
 */
async function batchInsertToIngest(items) {
  if (!items || !items.length) return { written: 0, failed: 0, total: 0 }
  const ingestItems = items.map((it) => ({
    sourceType: 'official_rss',
    sourceName: it.sourceName || '官方源',
    title: it.title,
    summary: it.summary || '',
    url: it.url || '',
    // A.4/A.5：content 仅作为 AI 加工源数据（瞬时 staging，批次后清除）
    content: it.content || '',
    category: mapOfficialCategory(it.category),
    publishTime: it.pubDate || it.fetchedAt || '',
    fetchedAt: it.fetchedAt || new Date().toISOString(),
  }))
  return newsIngestStore.pushItems(ingestItems)
}

module.exports = { filterDuplicates, batchInsert, batchInsertToIngest, mapOfficialCategory, OFFICIAL_CATEGORY_MAP, sha256 }
