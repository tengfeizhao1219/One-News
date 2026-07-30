/**
 * 云函数配置模块 v3.1
 *
 * 数据源优先级（缓存降权，天行实时优先）：
 *   getNewsList: 内存缓存(2min) → 云数据库(10min) → AI静态缓存(兜底) → 天行API(主力) → 聚合降级
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

  // 缓存配置（v3.1 降权：缩短 TTL，让天行实时数据成为主力）
  cache: {
    memoryTTL: 2 * 60 * 1000,        // 内存缓存 2 分钟（原 5min）
    searchTTL: 5 * 60 * 1000,        // 搜索缓存 5 分钟（原 10min）
    dbCacheTTL: 10 * 60 * 1000,      // 云数据库缓存 10 分钟（原 24h）
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
