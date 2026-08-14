/**
 * newsFetcher 配置（Stage 0 · 统一抓取）
 * ============================================================
 * 仅含抓取侧所需：聚合源 Key + 限流策略。
 * AI 引擎 Key 由 Stage 2（newsAI）读取，不在此处。
 * 所有 Key 走环境变量（绝不硬编码）。
 */
module.exports = {
  // 聚合数据（juhe）
  juhe: {
    baseUrl: 'https://v.juhe.cn/toutiao/index',
    apiKey: process.env.JUHE_API_KEY || '',
    timeout: 8000,
  },
  // 天行数据（tianxing）
  tian: {
    baseUrl: 'https://apis.tianapi.com',
    apiKey: process.env.TIAN_API_KEY || '',
    timeout: 8000,
  },
  // 限流/退避（与 refreshNews 一致，防配额打爆）
  rateLimit: {
    minCallGapMs: 1500,
    maxRetries: 3,
    backoffBaseMs: 1000,
    backoffMaxMs: 8000,
  },
}
