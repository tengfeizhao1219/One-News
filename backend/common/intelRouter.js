// intelRouter.js — 情报分层路由（T3.2 / P）
// ============================================================
// 设计 §6.1/§6.4/§6.6/§6.7（2026-08-19 owner 拍板修订）：
//   - 相关性打分【只关注用户初始化时填写的 AI 议题（profile.focusTags）】+
//     通用 AI 内容底线（判断「是不是 AI 新闻」）；
//   - 取消原「三重身份」（工作·RCBC / 产品·One News / 家庭·生活）信号与合同特殊路由——
//     owner：身份/产品不需要作为相关判断条件；
//   - 廉价规则打分 → high / medium / low；低相关直接丢弃（不进今日关注），不消耗强模型配额。
//
// 纯粹、无副作用、纯函数，便于单测。intel_ 命名空间隔离。
// ============================================================

// 通用 AI 内容底线词表（判断「是否 AI 新闻」，与用户画像无关）
// 设计要点（2026-08-20 治理）：
//   - 中英双语覆盖：中文源用中文词（大模型/人工智能/模型…），英文源用英文词（model(s)/ai/claude…）。
//     此前仅中文「模型」无法匹配英文 "model"，且裸 'ai' 因子串误匹配（available）被禁用，
//     导致英文源与「AI 前缀」中文标题大量漏判 → 全进 low。本次补齐英文高频词 + 改写 hit() 词边界匹配。
//   - 单英文关键词走词边界匹配（split/\W+/ 后整词/派生匹配），避免 'ai' 误中 available、'llm' 漏中 llms。
const AI_BASE_KEYWORDS = [
  // —— 英文通用词（词边界匹配）——
  'ai', 'llm', 'model', 'models', 'agent', 'agents', 'agentic',
  'gpt', 'chatgpt', 'openai', 'claude', 'gemini', 'anthropic', 'llama', 'mistral',
  'qwen', 'deepseek', 'grok', 'cohere', 'perplexity', 'copilot', 'codex',
  'rag', 'aigc', 'agi',
  'machine learning', 'deep learning', 'artificial intelligence', 'neural', 'nlp',
  'chatbot', 'chatbots', 'inference', 'embedding', 'embeddings', 'diffusion',
  'transformer', 'computer vision', 'speech', 'multimodal',   'foundation model', 'world model',
  'language model', 'generative', 'gpu', 'benchmark', 'dataset', 'datasets',
  'alignment', 'distillation', 'hallucination', 'open source',
  // —— 中文通用词（直接包含匹配）——
  '大模型', '人工智能', '智能体', '机器学习', '深度学习', '神经网络', '自然语言处理',
  '文心', '通义', '千问', '豆包', 'kimi', '混元',
  '生成式', '推理模型', '多模态', '具身智能', '机器人', '人形机器人', '具身',
  '芯片', '算力', '语音识别', '语音合成', '视频创作', '文生图', '文生视频', '图生视频',
  '开源模型', '开源大模型', '提示词', '提示工程', '智能助手', '聊天机器人',
  '数字人', '虚拟人', '知识库', '向量数据库', '检索增强', '预训练', '微调',
  '对齐', '幻觉', '机器视觉', '编程助手', '代码生成', 'ai编程',
  'ai 视频', 'ai 助手', 'ai 工具', 'ai 创作', 'ai 模型', '模型',
]

/** 关键词命中判定：
 *  - 多词短语：直接包含（如 'ai agent' / 'machine learning'）
 *  - 纯 ASCII 单关键词：按词边界匹配（split/\W+/ 后整词或派生匹配，
 *    如 'ai'→"ai music"/"AI音乐" 命中，但 'available' 不命中；'llm'→'llms' 命中）
 *  - 含非 ASCII（中文等）：直接包含匹配
 */
function hit(body, kw) {
  const k = String(kw).toLowerCase()
  if (k.includes(' ')) return body.includes(k)
  if (/^[\x00-\x7f]+$/.test(k)) {
    return body.split(/\W+/).some((t) => {
      if (t === k) return true
      // 复数/派生：token 以 k 开头且紧跟单词字符（llm→llms, model→models/ing, agent→agents/ic）
      return t.startsWith(k) && t.length > k.length && /[a-z0-9]/i.test(t[k.length])
    })
  }
  return body.includes(k)
}

/**
 * 对单条条目做相关性打分。
 * @param {Object} item - intel_ingest 原始条目（title/summary/content/layer/sourceId）
 * @param {Object|null} profile - 用户画像（intel_profile）；score 的个性化来源 = focusTags（初始化 AI 议题）
 * @returns {{ level:'high'|'medium'|'low', score:number, sceneTags:string[], hits:number, contract:boolean, reason:string }}
 */
function score(item, profile) {
  const body = [item.title, item.summary, item.content, item.sourceName]
    .filter(Boolean).map((s) => String(s).toLowerCase()).join('\n')

  // ① AI 内容底线（通用）：命中越多越高，权重 1，上限 3
  let aiHits = 0
  for (const kw of AI_BASE_KEYWORDS) {
    if (hit(body, kw)) aiHits++
  }
  const base = Math.min(aiHits, 3)

  // ② 用户初始化的 AI 议题（focusTags）：每命中 +2，上限 6 —— 唯一个性化来源
  let focusBoost = 0
  const sceneTags = []
  const matchedTags = []
  if (profile && Array.isArray(profile.focusTags)) {
    for (const t of profile.focusTags) {
      const w = String(t || '').toLowerCase()
      if (w && body.includes(w)) {
        focusBoost += 2
        matchedTags.push(String(t))
      }
    }
  }
  focusBoost = Math.min(focusBoost, 6)
  if (base > 0) sceneTags.push('ai')
  sceneTags.push(...matchedTags)

  const s = base + focusBoost
  // 深度档位影响 high 门槛：deep 更敏感(≥3)，lite 更克制(≥5)，std 默认(≥4)
  const highTh = profile && profile.depth === 'deep' ? 3 : (profile && profile.depth === 'lite' ? 5 : 4)

  // 2026-08-20 治理：relevance 判定校准。语义 = 「是否 AI 内容」：
  //   任一 AI 底线词命中（base≥1）→ 至少 medium（进 LLM 轻量判定）；
  //   零命中（base=0）→ low（非 AI，丢弃，不进今日关注）。
  //   原阈值 s>=2 要求≥2 个不同词，导致单体 AI 信号（仅 OpenAI/仅 AI 一次）被判 low 漏抓。
  let level = 'low'
  let reason = '非 AI 内容或与关注议题无关'
  if (s >= highTh) { level = 'high'; reason = `AI议题强命中(base=${base},focus=${focusBoost})` }
  else if (s >= 1) { level = 'medium'; reason = `AI议题命中(base=${base},focus=${focusBoost})` }
  else reason = `规则低相关(base=${base},focus=${focusBoost})`

  return { level, score: s, sceneTags, hits: sceneTags.length, contract: false, reason }
}

module.exports = { score, AI_BASE_KEYWORDS }
