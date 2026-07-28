// 搜索新闻云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { keyword } = event
  const pageNum = Math.max(1, parseInt(event.pageNum) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(event.pageSize) || 10))

  if (!keyword || !keyword.trim()) {
    return { code: -1, message: '缺少keyword参数' }
  }

  try {
    const kw = keyword.trim()
    // 转义正则特殊字符，防止意外匹配
    const escapedKw = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 使用正则进行模糊匹配
    const regex = db.RegExp({
      regexp: escapedKw,
      options: 'i'
    })

    // 查询标题或摘要匹配的新闻
    const query = db.collection('news').where(
      _.or([
        { title: regex },
        { summary: regex }
      ])
    )

    const countRes = await query.count()
    const total = countRes.total

    const listRes = await query
      .orderBy('publishTime', 'desc')
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .field({
        _id: true,
        title: true,
        summary: true,
        category: true,
        categoryName: true,
        source: true,
        publishTime: true
      })
      .get()

    return {
      code: 0,
      data: {
        list: listRes.data,
        total
      }
    }
  } catch (err) {
    return {
      code: -1,
      message: err.message
    }
  }
}
