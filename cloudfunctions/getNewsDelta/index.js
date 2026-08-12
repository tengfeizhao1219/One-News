// 获取增量新闻云函数 v1.0（FS-CF3 · 2026-08-10 owner 确认方案A「先快返回+分批增量」）
// 职责：下拉刷新后，前端短轮询本函数，按 createdAt >= since（本轮刷新启动时刻）读回
//       refreshNews 逐条写库的新记录，实现"列表逐条增加"。
//
// 为什么需要它（根因）：
//   getNewsList 按 publishTime desc 排序，新抓新闻的 publishTime 往往比库内旧记录早，
//   走 getNewsList 读不到"刚刷新写入"的记录。因此必须按【写入时刻 createdAt】做增量通道。
//   createdAt 由 refreshNews batchInsert 在每条写入时赋为各自完成时刻（分批增量后各条不同）。
//
// 入参：
//   category  - 分类 id（必填；下拉刷新固定 recommend）
//   since     - 本轮刷新启动时刻（ms 时间戳，必填；createdAt >= since 视为本轮新增）
//   max       - 单次返回条数上限（可选，默认 10）
// 返回：
//   { code, data: { list: [...], total } }
//   list 项字段结构与 getNewsList 完全一致（含 _id），供前端增量插入 + buildCard 直接消费。

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

// 与 getNewsList 对齐的分类名称映射
const CATEGORY_NAMES = {
  recommend: '推荐', tech: '科技', sports: '科学探索',
  international: '国际', life: '社会',
}

// 轻量标题清洗（与 getNewsList/utils/newsCleaner.cleanTitle 对齐，独立云函数不能跨目录引用）
function cleanTitle(rawTitle, maxLength = 120) {
  if (!rawTitle || typeof rawTitle !== 'string') return ''
  let text = rawTitle
  text = text
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  text = text.replace(/<[^>]+>/g, '')
  text = text.replace(/\u3000/g, ' ').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim()
  if (text.length > maxLength) text = text.substring(0, maxLength).trim()
  return text
}

exports.main = async (event) => {
  const since = parseInt(event.since) || 0
  if (!since) {
    return { code: -1, message: '缺少 since 参数', data: { list: [], total: 0 } }
  }
  const category = event.category || 'recommend'
  const max = Math.min(20, Math.max(1, parseInt(event.max) || 10))

  try {
    const where = {
      category,
      createdAt: db.command.gte(since),
    }
    // 按 createdAt 升序：先写库的排前面，前端按序 prepend 保证列表顺序与抓取顺序一致
    const res = await db.collection('news_cache')
      .where(where)
      .orderBy('createdAt', 'asc')
      .limit(max)
      .get()

    const totalRes = await db.collection('news_cache').where(where).count()
    const list = (res.data || []).map(item => ({
      id: item.id, _id: item._id,
      title: cleanTitle(item.title || ''),
      summary: item.summary,
      summarySource: item.summarySource || '', // v6.1：'ai' | 'desc' | 'title'
      category: item.category,
      categoryName: item.categoryName || CATEGORY_NAMES[item.category] || '',
      source: item.source, sourceUrl: item.sourceUrl || '',
      // v1.2 路线1：透传 contentSource/sourceName（官方源「出处 ↗」识别）
      contentSource: item.contentSource || '',
      sourceName: item.sourceName || '',
      publishTime: item.publishTime,
      isRetained: item.isRetained === true,
      createdAt: item.createdAt,
    }))

    console.log(`[getNewsDelta] category=${category} since=${since} 返回 ${list.length} 条`)
    return { code: 0, data: { list, total: totalRes.total } }
  } catch (err) {
    console.warn('[getNewsDelta] 增量查询失败:', err.message)
    return { code: -1, message: '增量查询失败', data: { list: [], total: 0 } }
  }
}
