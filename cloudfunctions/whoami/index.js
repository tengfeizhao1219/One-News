// 临时调试云函数：返回当前调用者的 openid
// 用途：部署期获取 owner 自己的 openid，用于配置 AUTHOR_OPENID 环境变量（作者角标「一页君」）。
// ⚠️ 验证完成后可删除此云函数（生产逻辑不依赖它）。

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async (event, context) => {
  const openid = cloud.getWXContext().OPENID || ''
  // 同时打印到云函数日志，便于在云开发控制台「日志」中查看
  console.log('[whoami] 当前调用者 openid =', openid)
  return {
    code: 0,
    data: { openid },
  }
}
