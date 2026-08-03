/**
 * 云函数配置模块 v5.6 — getNewsDetail 专用配置
 *
 * 说明：详情页正文获取 + AI 摘要生成
 *
 * 环境变量：
 *   JUHE_API_KEY        — 聚合数据（必填，正文接口）
 *   DASHSCOPE_API_KEY   — 阿里百炼（可选，AI 摘要生成；未配置则降级为原 summary）
 */

module.exports = {
  // 聚合数据 API（正文接口）
  juhe: {
    baseUrl: 'https://v.juhe.cn/toutiao/index',
    contentUrl: 'https://v.juhe.cn/toutiao/content',
    apiKey: process.env.JUHE_API_KEY || '',
    timeout: 8000,
  },

  // 阿里百炼 AI 摘要（v5.6 新增）
  dashscope: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'deepseek-v3',
    timeout: 6000,
    maxInputChars: 2000,  // 截断喂给 AI 的正文长度
    summaryMaxChars: 150, // 期望摘要字数（100-150 字）
  },

  // 缓存配置
  cache: {
    dbCacheTTL: 65 * 60 * 1000, // 云数据库缓存 65 分钟（适配每小时刷新）
  },
}
