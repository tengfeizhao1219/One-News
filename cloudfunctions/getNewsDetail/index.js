// 获取新闻详情云函数 v6.4 — 纯读取端（news_cache/news_raw_official 只读 + R1 合规过滤）
// ============================================================
// v6.4 纯读取端改造（2026-09-07 owner 拍板）：
//   1) 移除历史遗留 news 集合查询——news 自 v5.1 起无任何写入方（全库 grep 证实
//      仅本函数还在读），每次详情先查 news 必 miss，白付一次串行 DB 往返。
//   2) 移除读取端实时抓取（聚合内容接口 / 原文网页抓取）与抓后回写库。
//      详情页定位为纯读取端：正文抓取/清洗/AI 加工一律由 newsPipeline 在入库阶段
//      完成并落 news_cache，读取端不再有任何实时抓取处理动作。
//      根因：此前 content ≤ 200 字时读取端现抓聚合接口（超时 2.5s）→ 原文网页
//      （每跳超时 2.5s × 最多 3 跳，最坏 ~10s），且抓到的全文在 ai_first 合规模式下
//      返回前必被 R1 拦截——用户白等 3~10s 后看到的仍是 summary（延迟全损、零展示收益）。
//      现 content 不足时统一走 R1 过滤返回，前端 resolveContentText 自动以 summary 渲染。
//   附带清理：fetchWebPage/decodeBuffer/isSafeHttpUrl/fetchJuheContent/parseJuheKey/
//   extractContentFromHtml/locateBodyHtml/trimExtraneousContent/extractParagraphs/
//   cacheDoc/cacheContent/summarizeWithZhipu/summarizeWithDashscope 等随之失效的函数
//   一并删除（summarize 系列自 DG-08 移出关键路径后已无调用方）。
//
// ── 以下为历史演进记录（保留备查）──
// v5.6 改造（2026-08-03）：
//   抓取到正文后调用智谱 GLM-4-Flash 生成 100-150 字摘要（v6.4 起摘要生成只在管线侧）。
// v5.5 改造（2026-08-03）：
//   详情页正文清洗增强：去除标题重复段、元信息行（时间+来源）、仅含来源段落。
// v5.4 改造（2026-08-03）：
//   详情页正文获取优先级：聚合官方内容接口 → 网页抓取 → summary 兜底（v6.4 已移除）。
// v5.3 改造（2026-08-03）：
//   查询顺序兼容 news_cache（v5 当前数据源）；v6.4 起不再查历史遗留 news 集合。
// v5.0 原逻辑：
//   列表只缓存标题，详情页点击时实时抓原文（v6.4 起废弃，正文的唯一供给方是 newsPipeline）。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { cleanTitle } = require('./utils/newsCleaner')

// B-COMPLIANCE-1 R1（2026-08-10 owner 拍板）：读取端 content_mode 拦截
// 默认 = 'ai_first'。含义：详情页只返回 AI 摘要/解读，不返回抓取的全文（防版权侵权）。
// 拦截范围：所有返回点统一走 applyR1Filter，凡 contentSource 不是 'ai_interpretation'
// （即 'cached' / 'fetched_and_cleaned' / 'juhe_content_api' / 'summary_fallback' 等历史全文本）
// 一律清空 doc.content，前端只看到 summary + title + contentSource 标记。
// 标记为 'r1_blocked_fulltext' → 前端可识别并展示"已合规降级"提示。
// PRD §2.3 全局开关（2026-08-11 owner 拍板）：通过云函数环境变量 READ_CONTENT_MODE 切换
//   - ai_first（默认）：拦截全文本，仅返回 AI 摘要/解读（防版权侵权）
//   - fetch_full：回滚旧行为，详情页返回库内完整正文（仅合规审查期/灰度回滚使用；
//     v6.4 起读取端不抓取，该模式只放行库内已有 content，不再有"实时抓全文"行为）
const READ_CONTENT_MODE_DEFAULT = process.env.READ_CONTENT_MODE || 'ai_first'
// R1 拦截掉的 contentSource 应被前端识别为"已合规降级"
const R1_BLOCKED_CONTENT_SOURCE = 'r1_blocked_fulltext'

/**
 * R1 拦截：根据 read_content_mode 判断是否清空 content（保留 summary/title/references）
 * @param {Object} doc - 详情文档
 * @param {string} originalContentSource - 原始 contentSource（如 'cached' / 'ai_interpretation'）
 * @returns {Object} { content, contentSource, blocked }
 */
function applyR1Filter(doc, originalContentSource) {
  if (READ_CONTENT_MODE_DEFAULT === 'fetch_full') {
    // fetch_full 模式：不拦截，回滚旧行为（合规审查期/紧急回滚使用）
    return { content: doc.content || '', contentSource: originalContentSource, blocked: false }
  }
  // ai_first 模式（默认）：仅放行以下 contentSource，其余全文本一律清空
  // - 'ai_interpretation'：newsPipeline "AI 独立解读"通道（PRD §2.1-2 档位二）写入的 content
  // - 'official_rss'：官方 RSS 源直连，版权红线只存 summary 不存正文（v1.1 #35）
  //   content 为 summary 兜底值，非侵权全文，前端展示「出处↗」跳转源站 H5
  // - 'ai_summary'：owner 8/13 新增——聚合/天行源 AI 解读失败时回退的 AI 摘要 content（仍属 AI 加工产物，非 raw 原文），放行展示
  const allowedSources = ['ai_interpretation', 'official_rss', 'ai_summary']
  if (allowedSources.includes(originalContentSource)) {
    return { content: doc.content || '', contentSource: originalContentSource, blocked: false }
  }
  return {
    content: '', // 清空全文本，仅保留 summary/title
    contentSource: R1_BLOCKED_CONTENT_SOURCE, // 前端可识别降级态
    blocked: true,
  }
}

/**
 * 按 newsId 查找新闻文档（v6.4：news_cache → news_raw_official，已移除遗留 news 集合查询）
 * @param {string} newsId  - 前端传入的 id（juhe_xxx 形态 id 或数据库 _id）
 * @returns {Promise<{doc: Object, collection: string}|null>}
 */
async function findNewsDoc(newsId) {
  // 1. news_cache 集合按 id（v5 当前数据源；聚合/天行源前端传 juhe_xxx 形态 id）
  try {
    const res = await db.collection('news_cache').where({ id: newsId }).get()
    if (res.data && res.data.length > 0) {
      return { doc: res.data[0], collection: 'news_cache' }
    }
  } catch (e) {
    console.warn('[getNewsDetail] news_cache 按 id 查询失败:', e && e.message)
  }

  // 2. news_cache 集合按 _id（前端可能直接传数据库 _id，如官方源汇入条目）
  try {
    const res = await db.collection('news_cache').doc(newsId).get()
    if (res.data && res.data._id) {
      return { doc: res.data, collection: 'news_cache' }
    }
  } catch (e) {
    // 忽略：可能不是合法 _id
  }

  // 3. news_raw_official 集合（官方 RSS 源直连，v1.1 #35）
  // id 格式 official_<urlFp>，前端传参主键即 _id
  try {
    const res = await db.collection('news_raw_official').doc(newsId).get()
    if (res.data && res.data._id) {
      return { doc: res.data, collection: 'news_raw_official' }
    }
  } catch (e) {
    // 忽略：可能不是合法 _id 或集合未创建
  }

  return null
}

/**
 * 阅读数 +1（非阻塞）
 * @param {string} collection
 * @param {string} realId  - 数据库 _id
 */
function bumpViewCount(collection, realId) {
  try {
    db.collection(collection).doc(realId).update({
      data: { viewCount: _.inc(1) },
    }).catch(() => {})
  } catch (_) {}
}

// ─── 主函数（v6.4 纯读取：查库 → 官方源短路 → R1 过滤 → 返回，无任何实时抓取） ─────────────────────────────────────────

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少 newsId 参数' }
  }

  console.log(`[getNewsDetail] v6.4 纯读取 newsId=${newsId}`)

  // ── 第 1 步：查集合（news_cache 按 id → 按 _id → news_raw_official）──
  let found
  try {
    found = await findNewsDoc(newsId)
  } catch (e) {
    console.warn('[getNewsDetail] 查询失败:', e && e.message)
  }

  if (!found) {
    console.warn(`[getNewsDetail] 新闻不存在: ${newsId}`)
    return { code: -1, message: '新闻不存在或已过期', errorCode: 'NO_DATA' }
  }

  const { doc, collection } = found
  // 兜底清洗标题（防御数据库中历史脏数据含 HTML 实体）
  doc.title = cleanTitle(doc.title || '')
  console.log(`[getNewsDetail] 命中集合: ${collection}, id=${doc._id}`)

  // ── 官方 RSS 源直连短路（v1.1 #35）──
  // 版权红线：news_raw_official 只存 summary 不存正文全文，不抓取源站 HTML。
  // 直接返回 summary + sourceUrl/sourceName/category，前端展示「出处↗」跳转源站 H5。
  if (collection === 'news_raw_official') {
    bumpViewCount(collection, doc._id)
    return {
      code: 0,
      data: {
        ...doc,
        content: doc.summary || doc.content || '',       // official_rss 无正文，兜底 summary
        contentSource: 'official_rss',
        sourceUrl: doc.url,
        sourceName: doc.sourceName,
        category: doc.category,
        // 时间字段归一化：news_raw_official 用 pubDate，前端读 publishTime（缺则 NaN，已前端防御）
        publishTime: doc.publishTime || doc.pubDate || '',
      },
      meta: {
        source: collection,
        contentSource: 'official_rss',
        engine: 'rss',
      },
    }
  }

  // ── 官方源已汇入 news_cache（v1.2 路线1）──
  // 官方源在 news_cache 中 content 可能为空（解读失败，版权红线不缓存原文）或为 AI 解读正文。
  // contentSource='official_rss'。命中时短路：有 AI 解读正文则展示，否则返回 summary + 出处。
  if (doc.contentSource === 'official_rss') {
    bumpViewCount(collection, doc._id)
    return {
      code: 0,
      data: {
        ...doc,
        // AI 解读正文优先；无正文（解读失败/历史数据）兜底 summary
        content: doc.content && doc.content.trim().length >= 30 ? doc.content : (doc.summary || ''),
        contentSource: 'official_rss',
        sourceUrl: doc.sourceUrl || doc.url || '',
        sourceName: doc.sourceName || doc.source || '',
        category: doc.category,
        // 时间字段归一化：官方源汇入 news_cache 后仍可能用 pubDate，前端读 publishTime（缺则 NaN，已前端防御）
        publishTime: doc.publishTime || doc.pubDate || '',
      },
      meta: {
        source: collection,
        contentSource: 'official_rss',
        engine: 'rss',
        r1Blocked: false,
        readContentMode: READ_CONTENT_MODE_DEFAULT,
      },
    }
  }

  // ── 第 2 步：统一 R1 过滤后返回（v6.4：不再按 content 长度分流、不再实时抓取）──
  // 库内 content 即展示数据的唯一来源：管线已入库的 AI 解读/AI 摘要直接放行展示；
  // content 为空/过短或来源不在放行列表时，R1 清空 content，前端 resolveContentText
  // 自动以 summary 渲染（与改造前该场景的用户可见结果一致，但不再白等抓取超时）。
  // 附带收益：此前 content ≤ 200 字的放行来源（如较短的 ai_interpretation）会被
  // 200 字阈值误伤强制走抓取后被拦，现在按 contentSource 正确放行。
  bumpViewCount(collection, doc._id)

  const r1 = applyR1Filter(doc, doc.contentSource || 'cached')
  console.log(`[getNewsDetail] 纯读取返回: content=${(doc.content || '').length}字, source=${doc.contentSource || 'cached'}, R1=${r1.blocked ? '拦截' : '放行'}`)

  const result = {
    ...doc,
    content: r1.content, // R1 拦截后为空字符串，前端以 summary 渲染
    summary: doc.summary || doc.title || '',
    contentSource: r1.contentSource, // 优先 R1 标记值（blocked 时为 r1_blocked_fulltext）
    // B-COMPLIANCE-1 S1：透传 references（智谱/AI 搜索链的来源 URL 列表），
    // 前端详情页"原文回源"按钮根据此数组显示/隐藏（PRD §3.2）。
    references: Array.isArray(doc.references) ? doc.references : [],
    // 时间字段归一化：兜底 pubDate（历史/官方源数据可能用该字段名），避免前端 NaN月NaN日
    publishTime: doc.publishTime || doc.pubDate || '',
  }

  return {
    code: 0,
    data: result,
    meta: {
      source: collection,
      contentSource: doc.contentSource || 'cached',
      engine: 'cache_read', // v6.4：纯读取端，不再有 juhe 抓取引擎
      r1Blocked: r1.blocked,
      readContentMode: READ_CONTENT_MODE_DEFAULT,
    },
  }
}
