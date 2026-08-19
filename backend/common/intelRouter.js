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
const AI_BASE_KEYWORDS = [
  'llm', '大模型', '人工智能', '智能体', 'ai agent', 'agent', '机器学习', '神经网络',
  'deepseek', 'gpt', 'openai', 'chatgpt', 'copilot', '文心', '通义', '豆包', 'kimi',
  '混元', '生成式', '推理模型', '多模态', 'aigc', '自动驾驶', '具身智能', '机器人',
  '芯片', '算力', 'rag', '语音识别', '视频创作', '开源模型', 'agi', 'ai 视频',
  'ai 助手', 'ai 工具', 'ai 创作', 'ai 模型', '模型',
]

/** 关键词命中判定：多词全词匹配，单中文词直接包含，单英文词按词边界 */
function hit(body, kw) {
  const k = String(kw).toLowerCase()
  if (k.includes(' ')) return body.split(/\W+/).includes(k)
  if (/^[a-z][a-z0-9-]*$/.test(k)) return body.split(/\W+/).includes(k) || body.includes(k)
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
  const highTh = profile && profile.depth === 'deep' ? 3 : (profile.depth === 'lite' ? 5 : 4)

  let level = 'low'
  let reason = '非 AI 内容或与关注议题无关'
  if (s >= highTh) { level = 'high'; reason = `AI议题强命中(base=${base},focus=${focusBoost})` }
  else if (s >= 2) { level = 'medium'; reason = `AI议题中命中(base=${base},focus=${focusBoost})` }
  else reason = `规则低相关(base=${base},focus=${focusBoost})`

  return { level, score: s, sceneTags, hits: sceneTags.length, contract: false, reason }
}

module.exports = { score, AI_BASE_KEYWORDS }
