/**
 * setNewsRetained 云函数 — RQ-16 新闻存储保留机制（v7 改造）
 *
 * v7（TL-B12 / 2026-08-03）：操作集合从 news → news_cache（news 集合自 v5.1 已停写，
 * 原逻辑标记失效）。标记/取消标记新闻的 isRetained 状态，使 refreshNews 分级清理时跳过。
 *
 * 输入：{ newsId: string, retained: boolean, retainedBy?: 'favorite'|'share'|'shareTimeline' }
 * 输出：{ code: 0, data: { newsId, isRetained, retainedBy, updated } }
 *
 * 语义（PRD §7.1）：
 *   - retained=true  : { isRetained:true, retainedAt:now, retainedBy, cacheExpire: now+30d }
 *   - retained=false : { isRetained:false, retainedAt:null, retainedBy:null, cacheExpire: now+7d }（不物理删除）
 *
 * P2-1 修复（2026-08-16）：安全加固
 *   - 读取 wxContext.OPENID，全部操作要求已登录身份；
 *   - openid 频率限制（5 次/分钟，system_kv 窗口计数）；
 *   - retainedBy 白名单（favorite/share/shareTimeline）+ 长度上限；
 *   - 标记保留时记录 retainedByOpenid；取消保留仅允许"本人上次置 true"的条目，
 *     防止任意用户把他人收藏/分享钉住的条目提前释放（缩短可见期）。
 *
 * v4.1 平铺自包含风格（不依赖 common/）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 保留策略 TTL（与 refreshNews/config.js 对齐，平铺自包含）
const RETAINED_TTL = 30 * 24 * 60 * 60 * 1000 // 30 天
const NORMAL_TTL = 7 * 24 * 60 * 60 * 1000   // 7 天

// P2-1：安全参数
const RETAINED_BY_WHITELIST = ['favorite', 'share', 'shareTimeline']
const RATE_WINDOW_MS = 60 * 1000
const RATE_MAX = 5

// P2-1：openid 频率限制（60s 窗口内最多 RATE_MAX 次；限频查询失败 fail-open）
async function checkRateLimit(openid) {
  const now = Date.now()
  const key = 'rate_retained_' + openid
  try {
    const r = await db.collection('system_kv').doc(key).get().catch(() => null)
    const cur = (r && r.data) || {}
    if (cur.ts && (now - Number(cur.ts)) < RATE_WINDOW_MS) {
      if ((cur.count || 0) >= RATE_MAX) return false
      try {
        await db.collection('system_kv').doc(key).update({ data: { count: _.inc(1), ts: now } })
      } catch (e) {
        await db.collection('system_kv').add({ data: { _id: key, count: 1, ts: now } })
      }
    } else {
      try {
        await db.collection('system_kv').doc(key).set({ data: { count: 1, ts: now } })
      } catch (e) {
        await db.collection('system_kv').add({ data: { _id: key, count: 1, ts: now } })
      }
    }
    return true
  } catch (e) {
    console.warn('[setNewsRetained] 限频检查异常（放行）:', e.message)
    return true
  }
}

exports.main = async (event) => {
  const { newsId, retained, retainedBy } = event

  // P2-1：身份校验。owner 2026-09-02 决策：
  //   - retained=true（标记保留）：放行匿名。朋友圈单页模式（onShareTimeline）无法登录，
  //     OPENID 为空，但「标记新闻保留」是低风险操作（仅防新闻被 publish 删除），
  //     无身份也允许，否则朋友圈分享的新闻不保留 → 下次整批替换后被删 → 打开报「新闻详情暂不可用」。
  //   - retained=false（取消保留）：必须登录。防止任意用户把他人保留的新闻提前释放（缩短可见期）。
  let openid = ''
  try { openid = (cloud.getWXContext() && cloud.getWXContext().OPENID) || '' } catch (e) { /* 忽略 */ }
  const isAnonymousMark = (!openid && retained === true)
  if (!openid && !isAnonymousMark) {
    return { code: -1, message: '无法获取用户身份（OPENID 为空）' }
  }
  // 匿名标记保留用固定兜底身份（限频 key 需要非空）
  const rateKey = openid || 'anonymous_mark'

  // ── 参数校验 ──
  if (!newsId || typeof newsId !== 'string' || newsId.trim().length === 0 || newsId.length > 200) {
    return { code: -1, message: '缺少 newsId 参数' }
  }
  if (typeof retained !== 'boolean') {
    return { code: -1, message: 'retained 参数必须为 boolean' }
  }
  const rb = retainedBy || 'favorite'
  if (typeof rb !== 'string' || rb.length > 30 || !RETAINED_BY_WHITELIST.includes(rb)) {
    return { code: -1, message: 'retainedBy 不合法' }
  }

  // P2-1：频率限制
  const allowed = await checkRateLimit(rateKey)
  if (!allowed) {
    return { code: -1, message: '操作过于频繁，请稍后再试' }
  }

  const now = Date.now()

  try {
    // v7：按 newsId 查找 news_cache 集合（不再查 news）
    const exist = await db.collection('news_cache').where({ id: newsId }).get()

    if (!exist.data || exist.data.length === 0) {
      // 文档不存在 — 可能是旧收藏，无需操作
      console.log(`[setNewsRetained] news_cache 文档不存在: ${newsId}`)
      return {
        code: 0,
        message: '文档不存在，无需操作',
        data: { newsId, isRetained: false, retainedBy: null, updated: false },
      }
    }

    const doc = exist.data[0]

    if (retained) {
      // 标记为保留（30 天）——记录 setter openid（供取消时校验）
      await db.collection('news_cache').doc(doc._id).update({
        data: {
          isRetained: true,
          retainedAt: now,
          retainedBy: rb,
          retainedByOpenid: openid,
          cacheExpire: now + RETAINED_TTL,
          updatedAt: now,
        },
      })
      console.log(`[setNewsRetained] 已标记保留: ${newsId} (by=${rb})`)
      return {
        code: 0,
        message: '已标记为保留',
        data: { newsId, isRetained: true, retainedBy: rb, updated: true },
      }
    } else {
      // 取消保留：不物理删除，仅复位标记并重置为普通 7 天 TTL
      // P2-1：仅允许"本人上次置 true"的条目取消（防止任意用户缩短他人可见期）；
      //       retainedByOpenid 缺失（历史数据）时放行。
      if (doc.retainedByOpenid && doc.retainedByOpenid !== openid) {
        return { code: -1, message: '无权取消该条目的保留（仅标记者可取消）' }
      }
      await db.collection('news_cache').doc(doc._id).update({
        data: {
          isRetained: false,
          retainedAt: null,
          retainedBy: null,
          retainedByOpenid: null,
          cacheExpire: now + NORMAL_TTL,
          updatedAt: now,
        },
      })
      console.log(`[setNewsRetained] 已取消保留: ${newsId}`)
      return {
        code: 0,
        message: '已取消保留',
        data: { newsId, isRetained: false, retainedBy: null, updated: true },
      }
    }
  } catch (err) {
    console.error(`[setNewsRetained] 操作失败 [${newsId}]:`, err.message)
    return {
      code: -1,
      message: `操作失败: ${err.message}`,
    }
  }
}
