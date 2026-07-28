// 获取新闻详情云函数
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

exports.main = async (event) => {
  const { newsId } = event

  if (!newsId) {
    return { code: -1, message: '缺少newsId参数' }
  }

  try {
    const res = await db.collection('news').doc(newsId).get()

    if (!res.data) {
      return { code: -1, message: '新闻不存在' }
    }

    // 阅读数+1
    await db.collection('news').doc(newsId).update({
      data: {
        viewCount: _.inc(1)
      }
    })

    return {
      code: 0,
      data: res.data
    }
  } catch (err) {
    return {
      code: -1,
      message: err.message
    }
  }
}
