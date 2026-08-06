// 获取新闻列表云函数 v4.2 — 纯智谱/DeepSeek，不降级不兜底，全是真实数据
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const config = require('./config')

// ─── 分类名称映射（本地常量，无需 adapter）───
// v7（TL-B11）：移除 v4.2 遗留的 finance/entertainment（前端无 tab、无数据源语义），
// 与 frontend utils/constants.js CATEGORIES 对齐。
const CATEGORY_NAMES = {
  recommend: '推荐', tech: '科技', sports: '科学探索',
  international: '国际', life: '社会',
}

// ─── 缓存查询 ────────────────────────────────────────

/**
 * 从云数据库 news_cache 读取（智谱/DeepSeek refreshNews 每小时写入）
 */
async function getFromDbCache(category, pageNum, pageSize) {
  try {
    const now = Date.now()

    // 1. 优先查未过期数据（cacheExpire > now）
    const freshWhere = category && category !== 'all'
      ? { category, cacheExpire: db.command.gt(now) }
      : { cacheExpire: db.command.gt(now) }

    let where = freshWhere
    let stale = false

    const res = await queryCache(where, pageNum, pageSize)

    // 2. stale 兜底（owner 2026-08-06 09:48 决策：仅 fresh 完全为空时启动，兜底不加时间上限）
    //    DG-01：条件从 res.list.length === 0 收紧为 res.total === 0——
    //    翻页翻过头（fresh 有数据但当前页空）不再误触发 stale 混入过期新闻；
    //    仅 fresh 一条都没有（total=0，如 refreshNews 故障/配额耗尽）才走历史缓存。
    if (!res || res.total === 0) {
      const staleWhere = category && category !== 'all'
        ? { category }
        : {}
      const staleRes = await queryCache(staleWhere, pageNum, pageSize)
      if (staleRes && staleRes.list.length > 0) {
        return { ...staleRes, stale: true }
      }
    }

    if (res) return { ...res, stale }
    return null
  } catch (err) {
    console.warn('[getNewsList] DB 缓存读取失败:', err.message)
    return null
  }
}

/**
 * 执行 news_cache 查询并格式化
 */
async function queryCache(where, pageNum, pageSize) {
  try {
    const res = await db.collection('news_cache')
      .where(where)
      .orderBy('publishTime', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()

    if (res.data && res.data.length > 0) {
      const totalRes = await db.collection('news_cache')
        .where(where)
        .count()

      return {
        list: res.data.map(item => ({
          id: item.id, _id: item._id,
          title: item.title, summary: item.summary,
          summarySource: item.summarySource || '', // v6.1：'ai' | 'desc' | 'title'（前端胶囊提示）
          category: item.category, categoryName: item.categoryName || CATEGORY_NAMES[item.category] || '',
          source: item.source, sourceUrl: item.sourceUrl || '', publishTime: item.publishTime,
          isRetained: item.isRetained === true, // v7/TL-B12：供前端判断收藏/分享态
        })),
        total: totalRes.total,
        hasMore: (pageNum * pageSize) < totalRes.total,
      }
    }
    return null
  } catch (err) {
    console.warn('[getNewsList] news_cache 查询失败:', err.message)
    return null
  }
}

// ─── 内置精选列表（极端兜底：news_cache + backup 均空时使用）───
// ADR-003 §3.4：覆盖 5 个分类，每个分类至少 1 条占位内容，确保任何情况下不返回空白页。
const BUILTIN_NEWS = {
  recommend: [
    { id: 'builtin-rec-01', title: '欢迎使用 One-News', summary: '这是一款极简新闻速览小程序，每天为你精选值得关注的新闻。', category: 'recommend', categoryName: '推荐', source: 'One-News', publishTime: Date.now() },
  ],
  tech: [
    { id: 'builtin-tech-01', title: '新闻数据加载中', summary: '当前新闻缓存尚未填充，请稍后刷新或联系管理员触发 refreshNews。', category: 'tech', categoryName: '科技', source: 'One-News', publishTime: Date.now() },
  ],
  sports: [
    { id: 'builtin-sports-01', title: '新闻数据加载中', summary: '当前新闻缓存尚未填充，请稍后刷新或联系管理员触发 refreshNews。', category: 'sports', categoryName: '科学探索', source: 'One-News', publishTime: Date.now() },
  ],
  international: [
    { id: 'builtin-intl-01', title: '新闻数据加载中', summary: '当前新闻缓存尚未填充，请稍后刷新或联系管理员触发 refreshNews。', category: 'international', categoryName: '国际', source: 'One-News', publishTime: Date.now() },
  ],
  life: [
    { id: 'builtin-life-01', title: '新闻数据加载中', summary: '当前新闻缓存尚未填充，请稍后刷新或联系管理员触发 refreshNews。', category: 'life', categoryName: '社会', source: 'One-News', publishTime: Date.now() },
  ],
}

/**
 * 从内置精选列表返回分页数据（极端兜底，meta.source='cache-fallback'）
 */
function getBuiltinNewsList(category, pageNum, pageSize) {
  const cat = (category === 'all' || !BUILTIN_NEWS[category]) ? 'recommend' : category
  const items = BUILTIN_NEWS[cat] || BUILTIN_NEWS.recommend
  const start = (pageNum - 1) * pageSize
  const list = items.slice(start, start + pageSize)
  return {
    list,
    total: items.length,
    hasMore: (start + pageSize) < items.length,
  }
}

// ─── 备份快照查询（ADR-003 §3.3）─────────────────────

/**
 * 从 news_cache_backup 读取上次成功 refresh 的快照
 */
async function getFromCacheBackup(category, pageNum, pageSize) {
  try {
    const where = category && category !== 'all'
      ? { category }
      : {}
    const res = await db.collection('news_cache_backup')
      .where(where)
      .orderBy('publishTime', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()
    if (res.data && res.data.length > 0) {
      const totalRes = await db.collection('news_cache_backup').where(where).count()
      return {
        list: res.data.map(item => ({
          id: item.id, _id: item._id,
          title: item.title, summary: item.summary,
          summarySource: item.summarySource || '', // v6.2：'ai' | 'desc' | 'title'
          category: item.category,
          categoryName: item.categoryName || CATEGORY_NAMES[item.category] || '',
          source: item.source, sourceUrl: item.sourceUrl || '',
          publishTime: item.publishTime,
          isRetained: item.isRetained === true,
        })),
        total: totalRes.total,
        hasMore: (pageNum * pageSize) < totalRes.total,
      }
    }
    return null
  } catch (err) {
    console.warn('[getFromCacheBackup] 备份查询失败:', err.message)
    return null
  }
}

// ─── 主函数 v7.1（TL-B8）：news_cache → backup 快照 → 内置精选 三层降级 ──

exports.main = async (event) => {
  const category = event.category || 'all'
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(config.pagination.maxPageSize, Math.max(1, parseInt(event.pageSize) || config.pagination.defaultPageSize))

  console.log(`[getNewsList] v7.1 category=${category} page=${pageNum} size=${pageSize}`)

  // ── L1：云数据库 news_cache（正常路径 + stale 兜底）──
  const dbCached = await getFromDbCache(category, pageNum, pageSize)
  if (dbCached && dbCached.list.length > 0) {
    console.log(`[getNewsList] L1 news_cache 命中，返回 ${dbCached.list.length} 条${dbCached.stale ? '（历史兜底）' : ''}`)
    return {
      code: 0,
      data: dbCached,
      meta: {
        source: 'news_cache',
        engine: 'zhipu/deepseek',
        stale: !!dbCached.stale,
      },
    }
  }

  // ── 🆕 TL-B8 一层兜底：news_cache_backup（上次成功快照，ADR-003 §3.2）──
  const backupData = await getFromCacheBackup(category, pageNum, pageSize)
  if (backupData && backupData.list.length > 0) {
    console.warn(`[getNewsList] news_cache 为空，降级到 cache_backup，返回 ${backupData.list.length} 条`)
    return {
      code: 0,
      data: backupData,
      meta: { source: 'cache-fallback', engine: 'cache-backup', fallback: true },
    }
  }

  // ── 🆕 TL-B8 二层兜底：内置精选列表（极端情况，ADR-003 §3.2）──
  const builtinData = getBuiltinNewsList(category, pageNum, pageSize)
  if (builtinData && builtinData.list.length > 0) {
    console.warn(`[getNewsList] news_cache + backup 均为空，降级到内置精选`)
    return {
      code: 0,
      data: builtinData,
      meta: { source: 'cache-fallback', engine: 'builtin', fallback: true },
    }
  }

  // 三重均空 → 理论上不应到达（内置精选始终有数据）
  return {
    code: 0,
    data: { list: [], total: 0, hasMore: false },
    meta: { source: 'empty', hint: '所有数据源均无可用数据，请联系管理员' },
  }
}
