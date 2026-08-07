/**
 * feedback/delete — 删除留言（RQ-22-FS）
 *
 * 接口约定（开发交接单 FS §四 · PRD §5.2）：
 *   入参：{ id }
 *   出参：{ code: 0, data: { deleted: true } } | { code: -1, message }
 *
 * 权限：仅作者（AUTHOR_OPENID 环境变量）可删除；云函数内再次校验 isAuthor（前端不可伪造，PRD §4.3.3）
 * 方式：软删除（status='deleted'，普通用户不可见，作者侧灰显可查看，Q3 已确认）
 *
 * @module feedback/delete
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

function getAuthorOpenid() {
  return (process.env.AUTHOR_OPENID || '').trim()
}

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return { code: -1, message: '无法获取用户身份' }
  }

  const { id } = event
  if (!id) {
    return { code: -1, message: '缺少留言 ID' }
  }

  // 校验作者身份（云函数内再次校验，前端不可伪造）
  const authorOpenid = getAuthorOpenid()
  if (!authorOpenid || openid !== authorOpenid) {
    return { code: -1, message: '仅作者可删除留言' }
  }

  try {
    await db.collection('feedback').doc(id).update({
      data: {
        status: 'deleted',
        updatedAt: Date.now(),
      },
    })
    console.log(`[feedback/delete] 作者删除留言: ${id}`)
    return { code: 0, data: { deleted: true } }
  } catch (err) {
    console.error('[feedback/delete] 失败:', err.message)
    return { code: -1, message: `删除失败: ${err.message}` }
  }
}
