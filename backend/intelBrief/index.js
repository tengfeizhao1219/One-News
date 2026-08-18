// 情报读取云函数 getIntelBrief（T4.x / D 推送/UI）
// ============================================================
// ⚠️ 复用 One News getNewsList 的「云函数读缓存 → 结构化返回」范式（非其业务），
//    intel_* 命名空间隔离，可整体摘除。不触碰 One News 阅读数据（§5.7/§8.6）。
//
// 职责（设计 §7.2 / §7.6 / §8.2）：
//   读取 intel_current 中 isCurrent=true 的当期 Brief（发布闸门 Dispatcher T4.1
//   组装并升级指针），交由 Channels 层 OneNewsChannel 渲染成小程序可消费 payload，
//   「AI 情报」首页据此呈现：今日关注 + 本周可试用 + 数据截至 HH:MM + 源健康提示。
//
// 与 intelDispatcher（并行 agent B，T4.1）的衔接（不依赖其具体实现）：
//   只需遵守数据契约 —— Dispatcher 把 Brief 写进 intel_current 并置 isCurrent=true，
//   本函数按 (isCurrent) 读取即可。若尚未组装 → 返回空态占位，绝不报错（§7.7）。
//
// 复用 backend/common/：ensureSchema（自愈建表）+ channels（渠道渲染）。
//   部署时需将 backend/common/ 一并上传（同 intelFetch/intelProcess）。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { ensureSchema } = require('../common/ensureSchema')
const { getChannel } = require('../common/channels')

// 集合名（intel_* 命名空间）
const INTEL_CURRENT = 'intel_current'
const INTEL_CONFIG = 'intel_config'

/**
 * 读当期 Brief。优先按发布闸门的 currentIssueId 指针（intel_config，
 * intelDispatcher 的 upgradePointer 维护），回退按 intel_current 的
 * isCurrent=true（§8.2）。两者指向同一条文档，双路兜底增强读期稳健。
 * 找不到（未组装 / 尚未到发布时刻）→ 返回 null，由调用方降级为空态。
 */
async function readCurrentBrief() {
  // ① 优先指针读取：intel_config.intel_current_issue 记 currentIssueId
  try {
    const ptr = await db.collection(INTEL_CONFIG).doc('intel_current_issue').get()
    const issueId = ptr && ptr.data && ptr.data.currentIssueId
    if (issueId) {
      const doc = await db.collection(INTEL_CURRENT).doc(issueId).get()
      if (doc && doc.data && !doc.data.deleted) return doc.data
    }
  } catch (e) {
    console.warn('[getIntelBrief] 指针读取失败，回退 isCurrent:', e.message)
  }

  // ② 回退：intel_current 中 isCurrent=true 的最新一期
  try {
    const res = await db.collection(INTEL_CURRENT)
      .where({ isCurrent: true })
      .orderBy('generatedAt', 'desc')   // 多期兜底取最新，索引 (date,isCurrent) 已建
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    console.warn('[getIntelBrief] 读 intel_current 失败（集合未建交给自愈）:', e.message)
    return null
  }
}

exports.main = async (event = {}) => {
  // 自愈建表（幂等；集合不存在时创建，确保首次访问不抛「表不存在」）
  try { await ensureSchema() } catch (e) { console.warn('[getIntelBrief] ensureSchema 失败:', e.message) }

  // 渠道参数：本期仅 oneNews（决策 D3/§7.8）；预留 future = wechat/whatsapp
  const channelId = event.channel || 'oneNews'

  // 可选：指定日期（读取历史某期 brief；默认读取当期 isCurrent=true）
  const date = event.date || null

  let brief = null
  if (date) {
    try {
      const res = await db.collection(INTEL_CURRENT)
        .where({ date })
        .orderBy('version', 'desc')
        .limit(1)
        .get()
      brief = (res.data && res.data[0]) || null
    } catch (e) {
      console.warn(`[getIntelBrief] 读历史期 ${date} 失败:`, e.message)
    }
  } else {
    brief = await readCurrentBrief()
  }

  // 无当期 → 空态占位（有则汇报、无则不打扰，§7.7 不伪造内容）
  if (!brief) {
    return {
      code: 0,
      data: getChannel(channelId).render(null),
      meta: { channel: channelId, from: 'current', empty: true, hint: '当期情报尚未生成' },
    }
  }

  const payload = getChannel(channelId).render(brief)
  return {
    code: 0,
    data: payload,
    meta: {
      channel: channelId,
      from: date ? `history:${date}` : 'current',
      date: brief.date || '',
      version: typeof brief.version === 'number' ? brief.version : 0,
      mode: brief.mode || 'increment',
    },
  }
}
