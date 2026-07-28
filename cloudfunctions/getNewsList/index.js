// 获取新闻列表云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { category = 'all', pageNum = 1, pageSize = 10 } = event

  try {
    let query = db.collection('news')

    // 分类筛选
    if (category && category !== 'all') {
      query = query.where({ category })
    }

    // 获取总数
    const countRes = await query.count()
    const total = countRes.total

    // 分页查询
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
        total,
        hasMore: (pageNum * pageSize) < total
      }
    }
  } catch (err) {
    return {
      code: -1,
      message: err.message
    }
  }
}
