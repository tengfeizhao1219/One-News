/**
 * feedback/list — 留言板列表（RQ-22-FS）
 *
 * 接口约定（开发交接单 FS §四 · PRD §5.2）：
 *   入参：{ pageNum, pageSize, filter? }
 *   出参：{ code: 0, data: { list: [...], total }, isAuthor }
 *
 * 返回扁平记录列表（前端自行组装楼中楼树）：
 *   list 每条：{ _id, parentId, rootId, content, nickname, isAuthor, status, createdAt }
 *   isAuthor 在顶层返回（标记当前调用者是否为作者，驱动管理控件渲染）
 *
 * 查询策略：
 *   - 顶层留言（rootId 为空/null）：按 createdAt 倒序分页
 *   - 回复（rootId 非空）：按 createdAt 正序全量返回（楼中楼展开）
 *   - filter 筛选（仅作者）：all（默认）/ violation（仅违规标记）/ mine（仅我的回复）
 *
 * @module feedback/list
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ── 作者识别 ──────────────────────────────────────────

function getAuthorOpenid() {
  return (process.env.AUTHOR_OPENID || '').trim()
}

// ── 主流程 ────────────────────────────────────────────

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID || ''
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(50, Math.max(1, parseInt(event.pageSize) || 20))
  const filter = event.filter || 'all'   // all | violation | mine
  const authorOpenid = getAuthorOpenid()
  const isAuthor = !!authorOpenid && openid === authorOpenid

  try {
    // 顶层留言条件（rootId 为空；兼容历史数据 rootId 字段缺失）
    const topWhere = _.or([
      { rootId: null },
      { rootId: _.exists(false) },
    ])

    // filter 条件
    // 说明：BLOCKED 内容不入库，当前数据模型无独立「违规标记」字段。
    //   violation 筛选 = 已删除（软删除 status='deleted'，作者侧灰显可查看，Q3 已确认）
    //   mine 筛选 = 当前调用者（openid 匹配）
    const baseWhere = { rootId: topWhere }
    if (filter === 'mine') {
      baseWhere.openid = openid
    }

    // 1. 分页查询顶层留言
    let msgRes
    if (filter === 'violation') {
      // 仅违规标记：软删除的留言（作者视角）
      msgRes = await db.collection('feedback')
        .where(_.and([baseWhere, { status: 'deleted' }]))
        .orderBy('createdAt', 'desc')
        .skip((pageNum - 1) * pageSize)
        .limit(pageSize)
        .get()
    } else {
      msgRes = await db.collection('feedback')
        .where(baseWhere)
        .orderBy('createdAt', 'desc')
        .skip((pageNum - 1) * pageSize)
        .limit(pageSize)
        .get()
    }

    const topMessages = msgRes.data || []

    // 2. 总数统计（当前 filter 条件下的顶层留言数）
    let total = 0
    try {
      const totalRes = await db.collection('feedback').where(baseWhere).count()
      total = totalRes.total || 0
    } catch (e) {
      console.warn('[feedback/list] 总数统计失败:', e.message)
    }

    // 3. 批量查询这些顶层留言的全部回复（rootId in 顶层id，正序）
    let replies = []
    if (topMessages.length > 0) {
      const topIds = topMessages.map((m) => m._id)
      try {
        const repliesRes = await db.collection('feedback')
          .where({ rootId: _.in(topIds) })
          .orderBy('createdAt', 'asc')
          .get()
        replies = repliesRes.data || []
      } catch (e) {
        console.warn('[feedback/list] 回复查询失败:', e.message)
      }
    }

    // 4. 组装扁平记录（已删除的也返回，前端按 status 灰显；普通用户不可见 deleted 由前端控制？——见下）
    const normalize = (doc) => ({
      _id: doc._id,
      parentId: doc.parentId || null,
      rootId: doc.rootId || null,
      content: doc.content || '',
      nickname: doc.nickname || '微信用户',
      isAuthor: !!doc.isAuthor,
      status: doc.status === 'deleted' ? 'deleted' : 'visible',
      createdAt: doc.createdAt || 0,
    })

    let list = [...topMessages, ...replies].map(normalize)

    // 普通用户（非作者）不返回已删除记录（PRD §4.2：软删除对普通用户不可见，作者侧灰显可查看）
    if (!isAuthor) {
      list = list.filter((x) => x.status !== 'deleted')
    }

    return {
      code: 0,
      data: { list, total },
      isAuthor,
    }
  } catch (err) {
    console.error('[feedback/list] 失败:', err.message)
    return { code: -1, message: `查询失败: ${err.message}` }
  }
}
