/**
 * 云函数配置模块 v5.1 — 聚合 API 轻量列表缓存
 *
 * 数据流架构（v5.1）：
 *   refreshNews: 聚合 API 单一接口（type 参数分类）→ 清洗 → 写入 news_cache（仅标题列表，不含正文）
 *   getNewsList: news_cache → 返回标题列表
 *   getNewsDetail: news 集合（content 为空时从 sourceUrl 抓取 → 清洗 → 缓存）
 *
 * 回滚标记：
 *   git checkout v3-ai-dual-engine — 切回 AI 双引擎方案
 *   git checkout v5-tianxing        — 切回天行方案
 *
 * 环境变量：
 *   JUHE_API_KEY   — 聚合数据（必填，当前主力数据源 v5.1）
 *   TIAN_API_KEY   — 天行数据（可选，备用 / 回滚 v5-tianxing）
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

  // 聚合数据 API（v5.1 主力数据源）
  juhe: {
    baseUrl: 'https://v.juhe.cn/toutiao/index',
    contentUrl: 'https://v.juhe.cn/toutiao/content',
    apiKey: process.env.JUHE_API_KEY || '',
    timeout: 8000,
  },

  // 阿里百炼 AI 摘要（v6 新增：refreshNews 直接抓正文时同步生成摘要）
  dashscope: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'deepseek-v3',
    timeout: 6000,
    maxInputChars: 2000,
    summaryMaxChars: 150,
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

  // B-12 限流/退避策略配置
  rateLimit: {
    minCallGapMs: 1500,               // 分类间最小调用间隔（防智谱 RPM）
    maxRetries: 3,                    // 429 限流最大重试次数
    backoffBaseMs: 1000,              // 指数退避基数
    backoffMaxMs: 8000,               // 指数退避上限
    deepseekDailyCap: 40,             // DeepSeek 每日调用上限（熔断）
    manualCooldownMs: 10 * 60 * 1000, // 手动触发冷却 10 分钟
    zhipuWarnThreshold: 200,          // 智谱单日调用告警阈值
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
