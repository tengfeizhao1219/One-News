/**
 * 云函数配置模块 v5.4 — getNewsDetail 专用最小配置
 *
 * 说明：详情页正文获取需要调用聚合官方内容接口（/toutiao/content），
 * 需读取 JUHE_API_KEY。此文件为 getNewsDetail 独立配置（云函数自包含）。
 *
 * 环境变量：
 *   JUHE_API_KEY — 聚合数据（必填，正文接口）
 */

module.exports = {
  // 聚合数据 API（正文接口）
  juhe: {
    baseUrl: 'https://v.juhe.cn/toutiao/index',
    contentUrl: 'https://v.juhe.cn/toutiao/content',
    apiKey: process.env.JUHE_API_KEY || '',
    timeout: 8000,
  },

  // 缓存配置
  cache: {
    dbCacheTTL: 65 * 60 * 1000, // 云数据库缓存 65 分钟（适配每小时刷新）
  },
}
