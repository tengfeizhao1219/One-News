/**
 * 云函数配置模块 v3
 *
 * 数据源优先级：
 *   getNewsList: 内存缓存 → 云数据库(大模型搜索写入) → AI静态缓存 → 外部API
 *   searchNews:  内存缓存 → 云数据库搜索 → AI静态缓存 → 外部API
 *   refreshNews: 阿里百炼 DeepSeek 联网搜索 → 校验 → 写入云数据库
 */

module.exports = {
  // 阿里百炼 DeepSeek API（refreshNews 主力数据源）
  // 安全：key 仅从环境变量读取，禁止硬编码（已存入 /root/.secrets/bailian_api_key）
  bailian: {
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    model: 'deepseek-v3.2',
    timeout: 30000,
  },

  // 天行数据 API（第4层降级，可选）
  tian: {
    baseUrl: 'https://apis.tianapi.com/allnews/index',
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

  // 缓存配置
  cache: {
    memoryTTL: 5 * 60 * 1000,       // 内存缓存 5 分钟
    searchTTL: 10 * 60 * 1000,       // 搜索缓存 10 分钟
    dbCacheTTL: 24 * 60 * 60 * 1000, // 云数据库缓存 24 小时
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
