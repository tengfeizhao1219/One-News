/**
 * 云函数配置模块 v5.0 — 天行 API 轻量列表缓存
 *
 * 数据流架构（v5.0）：
 *   refreshNews: 天行 API 多分类接口 → 清洗 → 写入 news_cache（仅标题列表，不含正文）
 *   getNewsList: news_cache → 返回标题列表
 *   getNewsDetail: news 集合（content 为空时从 sourceUrl 抓取 → 清洗 → 缓存）
 *
 * 环境变量：
 *   TIAN_API_KEY   — 天行数据（必填，主力数据源）
 *   JUHE_API_KEY   — 聚合数据（可选，备用）
 *   ZHIPU_API_KEY  — 智谱（已废弃 v5.0，保留配置以便回滚到 v3-ai-dual-engine）
 *   DEEPSEEK_API_KEY — DeepSeek（已废弃 v5.0，保留配置以便回滚）
 */

module.exports = {
  // 智谱 GLM-4-Flash API（refreshNews 主力数据源）🆕
  zhipu: {
    apiKey: process.env.ZHIPU_API_KEY || '',
    model: 'glm-4-flash',
    timeout: 45000,
  },

  // DeepSeek API（refreshNews 降级数据源）🆕
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '',
    model: 'deepseek-chat',
    timeout: 45000,
  },

  // 阿里百炼 DeepSeek API（已废弃 v4.0，保留配置以防回滚）
  bailian: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    model: 'deepseek-v3.2',
    timeout: 30000,
  },

  // 天行数据 API（第4层降级，可选）
  // 注意：baseUrl 仅作为 host 基址，具体分类由 callTianApi 按 endpoint 拼接
  // 例如 https://apis.tianapi.com/{endpoint}/index
  // 原因：allnews 聚合接口未申请（返回 code:160），改为按已申请的分类专属接口路由
  tian: {
    baseUrl: 'https://apis.tianapi.com',
    apiKey: process.env.TIAN_API_KEY || '',
    timeout: 8000,
    retryDelay: [1000, 2000],
  },

  // 聚合数据 API（第4层降级，可选）
  juhe: {
    baseUrl: 'https://v.juhe.cn/toutiao/index',
    apiKey: process.env.JUHE_API_KEY || '',
    timeout: 6000,
  },

  // 缓存配置（v4.0：每小时刷新，DB 缓存 65min 覆盖刷新间隔）
  cache: {
    memoryTTL: 2 * 60 * 1000,        // 内存缓存 2 分钟
    searchTTL: 5 * 60 * 1000,        // 搜索缓存 5 分钟
    dbCacheTTL: 65 * 60 * 1000,      // 云数据库缓存 65 分钟（适配每小时刷新）
    maxCachePages: 3,
  },

  // 分页配置
  pagination: {
    defaultPageSize: 10,
    apiFetchSize: 20,
    maxPageSize: 50,
  },

  // 错误码
  errorCodes: {
    API_TIMEOUT: 'API_TIMEOUT',
    API_RATE_LIMIT: 'API_RATE_LIMIT',
    API_KEY_INVALID: 'API_KEY_INVALID',
    API_SERVER_ERROR: 'API_SERVER_ERROR',
    API_EMPTY_DATA: 'API_EMPTY_DATA',
    API_NETWORK: 'API_NETWORK',
    ADAPT_FAILED: 'ADAPT_FAILED',
    FIELD_MISSING: 'FIELD_MISSING',
    NO_DATA: 'NO_DATA',
    ALL_DOWN: 'ALL_DOWN',
  },
}
