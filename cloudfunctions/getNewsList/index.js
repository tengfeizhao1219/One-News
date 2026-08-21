// 获取新闻列表云函数 v7.3 — FinalScore 质量排序 — 纯智谱/DeepSeek，不降级不兜底，全是真实数据
// v7.3（2026-08-18 owner 方案1）：次排序键 publishTime → createdAt，解决源站 publishTime 可能晚于落库时间
//   所致排序错位（如 14:00 抓入但 publishTime 标为 15:00 → 排在 15:00 那批前）。createdAt 是落库
//   时刻，反映"True freshness"，防止旧批次靠源站更新的 publishTime 穿插到新位置。
//   FinalScore 仍是主键（质量+热度），未评分旧数据沉底。backup 层同改。
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const config = require('./config')
const { cleanTitle } = require('./utils/newsCleaner')

// ─── 服务端去重（2026-08-15 补）────────────────────────
// 背景：news_cache 因历史遗留（旧 refreshNews 多 id 分支）与集群抖动，
//   可能残留同篇新闻的多条副本（不同 id / 跨分类）。前端按 id 去重兜不住
//   「同篇不同 id」的情况，用户会看到重复。此处无论缓存是否干净，都在
//   返回前按「sourceUrl 优先、归一化标题兜底」去重，保证用户永不看到重复。
// 返回数组保持原顺序（已按 finalScore/publishTime 排好），每组只留第一条（最优）。
function dedupItems(items) {
  const seen = new Set()
  const out = []
  for (const it of (items || [])) {
    const key = String(it.sourceUrl || it.link || it.url || '').trim()
      || ('T:' + String(it.title || '').replace(/\s+/g, '').toLowerCase())
    if (!key) { out.push(it); continue }
    if (seen.has(key)) continue
    seen.add(key)
    out.push(it)
  }
  return out
}

// ─── 分类名称映射（本地常量，无需 adapter）───
// v7（TL-B11）：移除 v4.2 遗留的 finance/entertainment（前端无 tab、无数据源语义），
// 与 frontend utils/constants.js CATEGORIES 对齐。
const CATEGORY_NAMES = {
  recommend: '推荐', tech: '科技', science: '科学探索',
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
    // FS-质量把控 v2（2026-08-12）：排序 FinalScore 优先（质量+热度），同分按发布时间。
    //   - finalScore 由 refreshNews qualityScorer 落库（0-100 整数）；未评分的旧数据 finalScore=null。
    //   - ⚠️ 部署前置：news_cache 需建组合索引 (finalScore desc, createdAt desc)，
    //     否则链式 orderBy 可能查询失败或退化为单字段排序（见 .workbuddy/reports/FS-SSH-push通道修复经验-2026-08-12.md 旁 FS-质量把控 交接）。
    //     回滚：删除此行注释回到单 orderBy('createdAt','desc') 即可恢复原行为。
    const res = await db.collection('news_cache')
      .where(where)
      .orderBy('finalScore', 'desc')
      .orderBy('createdAt', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()

    if (res.data && res.data.length > 0) {
      const totalRes = await db.collection('news_cache')
        .where(where)
        .count()

      // 服务端去重：同 sourceUrl/同标题只保留一条，斩断用户可见的重复
      const listData = dedupItems(res.data)

      return {
        list: listData.map(item => ({
          id: item.id, _id: item._id,
          title: cleanTitle(item.title || ''), summary: item.summary,
          // 2026-08-21 方案A：透传完整 AI 解读正文 + 独立观点，
          // 详情页首帧即可用完整解读渲染（不再"先摘要 0.5s 再刷新"）。
          content: item.content || '',
          aiOpinion: item.aiOpinion || '',
          summarySource: item.summarySource || '', // v6.1：'ai' | 'desc' | 'title'（前端胶囊提示）
          category: item.category, categoryName: item.categoryName || CATEGORY_NAMES[item.category] || '',
          source: item.source, sourceUrl: item.sourceUrl || '', publishTime: item.publishTime,
          // v1.2 路线1：透传 contentSource（前端识别官方源「出处 ↗」）+ sourceName（官方源来源名）
          contentSource: item.contentSource || '',
          sourceName: item.sourceName || '',
          isRetained: item.isRetained === true, // v7/TL-B12：供前端判断收藏/分享态
          // FS-质量把控 v2：附加评分字段（前端可选，用于排序标识/后续展示评分）
          finalScore: typeof item.finalScore === 'number' ? item.finalScore : null,
          qualityScore: typeof item.qualityScore === 'number' ? item.qualityScore : null,
          heatScore: typeof item.heatScore === 'number' ? item.heatScore : null,
          eventId: item.eventId || '',
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
//
// 占位新闻设计（owner 2026-08-21 决策）：
//   - summary（列表卡片）：~100 字结构化介绍——
//       首句提示「当前分类下暂无新资讯」→ 中段介绍初衷/功能/来源/更新机制 → 末句引导「AI 情报」模块。
//   - content（详情正文）：故事化总结（getBuiltinContent 拼装，末尾动态追加近 1 个月版本更新）。
//   - contentSource='app_intro'：区别于 AI 解读，详情页不挂「AI 解读」徽标，改用品牌绿 hero + 分段标题卡片。

// 详情正文：故事化总结（不含版本更新块，由 getBuiltinContent 动态追加）
// 首行「关于一页」已由详情页品牌绿 hero 展示，此处不再重复。
const BUILTIN_INTRO_BODY = [
  '我们做一页，是想在信息洪流里给你留一块安静的角落。每天 AI 先替你读完全网动态，再把重点讲给你听——你不必追赶，轻轻一划，世界就安静地躺在这里。',
  '一页说',
  '有些事值得多想一步。我们挑出有态度的新闻，额外写一段独立观点，带你看见流水账之外的那一层。',
  '怎么用',
  '上下滑动浏览新闻 · 左滑切换分类 · 右滑进入 AI 情报 · 顶部下滑刷新 · 点卡片看详情',
  '你的数据',
  '收藏和浏览历史都安静地存在你这台设备里，只属于你。但请记得：卸载或清除小程序缓存，它们会一起消失，且无法找回。',
].join('\n')

// 近期更新：仅展示与系统版本日志（RELEASE_NOTE_*.md）一致的版本，不在日志中的不展示。
// VERSION_UPDATES 须随版本发布手动与版本日志保持同步（新增/移除版本都改这里）。
const VERSION_UPDATES = [
  { version: 'v1.0.2', date: '2026-08-16', items: ['官方媒体直接接入，重要事件在站内读完，不用跳来跳去', '每条新闻新增 AI 摘要与 AI 解读，"一页说"独立观点上线', '修复同一篇新闻在列表里反复出现'] },
  { version: 'v1.2.0', date: '2026-08-09', items: ['AI 摘要升级（接入混元大模型，优先免费额度，失败自动降级）', '摘要来源角标（AI / 来源 / 正文 / 标题）', '品牌 Logo 全站落地（首页 / 详情页 / 关于页 / 启动页 / 头像）', '分享增强（发送给朋友 + 朋友圈）', '修复首页"假摘要"顶掉正文首段的问题'] },
  { version: 'v1.2.1', date: '2026-08-10', items: ['修复关于页 / 设置页空白、首页卡片布局与浅色模式 Logo', '工程化拆分私有配置，解决部署 JSON 冲突'] },
]

/**
 * 取版本更新文本块（仅含 VERSION_UPDATES 内、与系统版本日志一致的版本；无则空串）
 */
function getRecentVersionUpdates() {
  if (!VERSION_UPDATES.length) return ''
  const lines = VERSION_UPDATES.map((u) => `· ${u.version}（${u.date}）：${(u.items || []).join('；')}`)
  return '近期更新\n' + lines.join('\n')
}

/**
 * 拼装占位新闻详情正文（功能介绍 + 近期版本更新）
 */
function getBuiltinContent() {
  const updates = getRecentVersionUpdates()
  return updates ? `${BUILTIN_INTRO_BODY}\n\n${updates}` : BUILTIN_INTRO_BODY
}

// 每分类列表 summary（首句提示当前分类暂无新资讯，中段介绍，末句引导 AI 情报）
const BUILTIN_NEWS = {
  recommend: [
    { id: 'builtin-rec-01', title: '欢迎使用 One News', summary: '【推荐】分类下暂时没有新的资讯。你可以左右滑动切换其它分类看看。一页是一款极简资讯速览小程序，每天从官方媒体与权威聚合源为你精选科技、国际、科学、社会的动态，并由 AI 生成摘要与解读，每小时更新一次。如果你对 AI 感兴趣，在首页右滑即可进入「AI 情报」模块。', category: 'recommend', categoryName: '推荐', source: 'One-News', publishTime: Date.now() },
  ],
  tech: [
    { id: 'builtin-tech-01', title: '欢迎使用 One News', summary: '【科技】分类下暂时没有新的资讯。你可以左右滑动切换其它分类看看。一页是一款极简资讯速览小程序，每天从官方媒体与权威聚合源为你精选科技、国际、科学、社会的动态，并由 AI 生成摘要与解读，每小时更新一次。如果你对 AI 感兴趣，在首页右滑即可进入「AI 情报」模块。', category: 'tech', categoryName: '科技', source: 'One-News', publishTime: Date.now() },
  ],
  science: [
    { id: 'builtin-science-01', title: '欢迎使用 One News', summary: '【科学探索】分类下暂时没有新的资讯。你可以左右滑动切换其它分类看看。一页是一款极简资讯速览小程序，每天从官方媒体与权威聚合源为你精选科技、国际、科学、社会的动态，并由 AI 生成摘要与解读，每小时更新一次。如果你对 AI 感兴趣，在首页右滑即可进入「AI 情报」模块。', category: 'science', categoryName: '科学探索', source: 'One-News', publishTime: Date.now() },
  ],
  international: [
    { id: 'builtin-intl-01', title: '欢迎使用 One News', summary: '【国际】分类下暂时没有新的资讯。你可以左右滑动切换其它分类看看。一页是一款极简资讯速览小程序，每天从官方媒体与权威聚合源为你精选科技、国际、科学、社会的动态，并由 AI 生成摘要与解读，每小时更新一次。如果你对 AI 感兴趣，在首页右滑即可进入「AI 情报」模块。', category: 'international', categoryName: '国际', source: 'One-News', publishTime: Date.now() },
  ],
  life: [
    { id: 'builtin-life-01', title: '欢迎使用 One News', summary: '【社会】分类下暂时没有新的资讯。你可以左右滑动切换其它分类看看。一页是一款极简资讯速览小程序，每天从官方媒体与权威聚合源为你精选科技、国际、科学、社会的动态，并由 AI 生成摘要与解读，每小时更新一次。如果你对 AI 感兴趣，在首页右滑即可进入「AI 情报」模块。', category: 'life', categoryName: '社会', source: 'One-News', publishTime: Date.now() },
  ],
}

/**
 * 从内置精选列表返回分页数据（极端兜底，meta.source='cache-fallback'）
 * 每条附带 content（详情正文）+ contentSource='app_intro'，供详情页渲染模块化介绍。
 */
function getBuiltinNewsList(category, pageNum, pageSize) {
  const cat = (category === 'all' || !BUILTIN_NEWS[category]) ? 'recommend' : category
  const items = BUILTIN_NEWS[cat] || BUILTIN_NEWS.recommend
  const start = (pageNum - 1) * pageSize
  const builtinContent = getBuiltinContent()
  const list = items.slice(start, start + pageSize).map((it) => ({
    ...it,
    content: builtinContent,
    contentSource: 'app_intro',
  }))
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
      .orderBy('createdAt', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .get()
    if (res.data && res.data.length > 0) {
      const totalRes = await db.collection('news_cache_backup').where(where).count()
      const listData = dedupItems(res.data)
      return {
        list: listData.map(item => ({
          id: item.id, _id: item._id,
          title: cleanTitle(item.title || ''), summary: item.summary,
          summarySource: item.summarySource || '', // v6.2：'ai' | 'desc' | 'title'
          category: item.category,
          categoryName: item.categoryName || CATEGORY_NAMES[item.category] || '',
          source: item.source, sourceUrl: item.sourceUrl || '',
          publishTime: item.publishTime,
          isRetained: item.isRetained === true,
          // FS-质量把控 v2：附加评分字段（备份为历史快照，一般无 finalScore，值与主路径对齐便于前端）
          finalScore: typeof item.finalScore === 'number' ? item.finalScore : null,
          qualityScore: typeof item.qualityScore === 'number' ? item.qualityScore : null,
          heatScore: typeof item.heatScore === 'number' ? item.heatScore : null,
          eventId: item.eventId || '',
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

  console.log(`[getNewsList] v7.2 category=${category} page=${pageNum} size=${pageSize}`)

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
