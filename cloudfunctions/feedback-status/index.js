// feedback-status — 意见反馈「与我相关」提醒状态（owner 2026-09-09 3.0.0）
// ============================================================
// 职责：计算当前用户有多少「与我相关」的未读反馈（首页⚙蓝圈/dock设置蓝框/设置页数字气泡共用）。
// 相关性（owner 定义）：
//   - 作者（AUTHOR_OPENID 或“发过 isAuthor 文档”推断）：任何用户（非作者）新留言/回复都与我相关；
//   - 普通用户：只有「回复了 TA 的留言」（parentOpenid==TA 且非 TA 本人所发）才相关。
// 已读基线：2026-09-09 改为**客户端本地保存**（wx storage，单设备够用），彻底规避云端集合
//   未建/一致性延迟导致基线反复丢失的坑——本函数只按入参 lastReadAt 计数，不写已读状态。
// 接口：{ op:'unread', lastReadAt } → { code:0, data:{isAuthor, count, serverNow} }
//       { op:'markRead'} → 客户端本地前移基线即可，本函数仅回执
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const FEEDBACK = 'feedback'

function authorOpenid() {
  return (process.env.AUTHOR_OPENID || '').trim()
}

/** 作者判定（双通道）：① 环境变量 AUTHOR_OPENID；② 无/不等时按“库里已有我 openid 的 isAuthor 文档”推断 */
async function detectAuthor(openid) {
  const envAuthor = authorOpenid()
  if (envAuthor) return openid === envAuthor
  try {
    const r = await db.collection(FEEDBACK).where({ openid, isAuthor: true }).limit(1).get()
    return !!(r && r.data && r.data.length)
  } catch (e) {
    return false
  }
}

/** 统计“与我相关”且 createdAt > base 的数量 */
async function countRelated(openid, isAuthor, base) {
  try {
    if (isAuthor) {
      const r = await db.collection(FEEDBACK)
        .where({ isAuthor: false, status: 'visible', createdAt: _.gt(base) })
        .count()
      return (r && r.total) || 0
    }
    // 普通用户：只统计“回复了我(父留言作者==我)、且不是我本人发的”新内容
    const r = await db.collection(FEEDBACK)
      .where({ parentOpenid: openid, openid: _.neq(openid), status: 'visible', createdAt: _.gt(base) })
      .count()
    return (r && r.total) || 0
  } catch (e) {
    console.warn('[feedback-status] 统计失败:', e.message)
    return 0
  }
}

exports.main = async (event = {}) => {
  const op = String((event && event.op) || 'unread')
  const ctx = cloud.getWXContext()
  const openid = (ctx && ctx.OPENID) || ''
  if (!openid) return { code: -1, message: '缺少 openid' }

  const envAuthor = authorOpenid()
  const isAuthor = (!!envAuthor && openid === envAuthor)
    ? true
    : await detectAuthor(openid)

  if (op === 'markRead') {
    // 已读由客户端本地前移基线；此处仅回执
    return { code: 0, data: { ok: true, isAuthor } }
  }

  // unread：客户端传入本地基线 lastReadAt；<=0 视为首次（返回 0 并回 serverNow 供客户端建基线）
  const base = Math.max(0, Number((event && event.lastReadAt) || 0))
  const serverNow = Date.now()
  if (base <= 0) {
    return { code: 0, data: { isAuthor, count: 0, serverNow } }
  }
  const count = await countRelated(openid, isAuthor, base)
  return { code: 0, data: { isAuthor, count, serverNow } }
}
