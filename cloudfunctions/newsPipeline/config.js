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
 *   DEEPSEEK_API_KEY — DeepSeek（v6.6 智谱降级兜底数据源；**必须配置**，否则降级路径会失败）
 */

module.exports = {
  // 智谱 GLM-4-Flash API（refreshNews 主力数据源）🆕
  zhipu: {
    apiKey: process.env.ZHIPU_API_KEY || '',
    model: 'glm-4-flash',
    timeout: 45000,
  },

  // DeepSeek API（refreshNews 智谱降级兜底数据源）🆕
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || '', // P2-9 修复：env 缺失时兜底空串，避免 undefined 传入 SDK
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

  // 智谱 GLM-4-Flash AI 摘要（v6.2：从百炼 DashScope 切换为智谱，统一 refreshNews 数据源）
  // 使用 ZHIPU_API_KEY 环境变量（与新闻搜索共用同一个 Key）
  zhipuSummary: {
    apiKey: process.env.ZHIPU_API_KEY || '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    timeout: 8000,
    maxInputChars: 2000,
    summaryMaxChars: 150,
  },

  // 混元大模型（云开发内置，无需 API Key — 微信AI小程序成长计划免费额度）
  // FS-06（2026-08-09 owner 拍板）：接入混元 hy3 作为摘要主力（免费10亿Token），
  // 经 cloud.ai().createModel('cloudbase').generateText() 调用，平台托管鉴权、零密钥。
  // ⚠️ 前置：owner 需在 CloudBase 控制台 AI+ → 生文模型 勾选 hy3 并报名成长计划；
  // 未启用时 code 侧 dynamic require 失败 → 自动降级到原 智谱/Qwen/DeepSeek 链，零影响。
  hunyuan: {
    enabled: true,
    model: 'hy3',
    timeout: 8000,
    maxInputChars: 2000,
    summaryMaxChars: 150,
    concurrency: 5, // 体验模型单环境并发上限 5
  },

  // 缓存配置（v7 / TL-B12：数据保留分级策略）
  //   - 普通记录：7 天（RQ-16，原 65 分钟）
  //   - retained 记录（收藏/分享）：30 天
  cache: {
    memoryTTL: 2 * 60 * 1000,        // 内存缓存 2 分钟
    searchTTL: 5 * 60 * 1000,        // 搜索缓存 5 分钟
    dbCacheTTL: 7 * 24 * 60 * 60 * 1000,        // 普通记录 7 天（RQ-16）
    retainedTTL: 30 * 24 * 60 * 60 * 1000,      // retained 记录 30 天（RQ-16）
    maxCachePages: 3,
  },

  // 分页配置
  pagination: {
    defaultPageSize: 10,
    apiFetchSize: 20,
    maxPageSize: 50,
  },

  // ── 统一多源聚合 · 条数规格（Phase 4 共享规格，供 qualityGate/AI 加工消费）──
  // 与「统一按 rssFetcher→筛选→AI加工→落库」模式对齐（owner 拍板 recommend=15/其他=8/每源每类抓20）。
  // ⚠️ 三种条数语义不同，勿混用：
  //   a) fetchPerFeedPerCategory：官方RSS 每源每类原始抓取量（rssFetcher 输入侧 → 落瞬时 news_ingest）
  //   b) selectRecommend / selectOther：qualityGate 精选后落 news_cache 展示的最终条数（recommend 精选 15，其他分类 8）
  //   c) aiSearchPerCall：保留 8（❗超时红线，勿改）。智谱 web_search 单次生成 >10 条实测 50s 超时
  //      （zhipuSearch.js DG-01 注释实证 10 条即 50s），放大即超时回归。AI 搜索只是「抓取」候选，
  //      精选由 qualityGate 从多源聚合池池中挑满 b) 条数，不由 AI 单次生成量决定。
  counts: {
    // a) 官方 RSS 每源每类原始抓取量（rssFetcher 抓取量；qualityGate 输入池大小基线）
    fetchPerFeedPerCategory: 20,
    // b) qualityGate 精选输出规格（落 news_cache 展示条数）
    selectRecommend: 15,
    selectOther: 8,
    // c) AI 搜索单次生成量 —— 勿改（超时红线：10 条即 50s）
    aiSearchPerCall: 8,
    // feedMeta 单源条数上限兜底（避免单源灌爆聚合池）
    maxPerFeed: 30,
  },

  // 内容安全审核（B-02 / P0-Q1 降级放行）
  // ⚠️ 个人主体小程序无法调用微信 msgSecCheck（-501001 invalid access_token 属预期，非配置错误）。
  //    设 SECURITY_CHECK_ENABLED=false 可跳过安全检测，避免每次刷新空打失败请求 + 日志噪音。
  //    企业主体认证后可改回 true（或删除环境变量）恢复审核。
  security: {
    enabled: process.env.SECURITY_CHECK_ENABLED !== 'false',
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
    enrichConcurrency: 8,             // B-14: enrichNewsList 并发数（抓正文+AI摘要 worker 池）
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
