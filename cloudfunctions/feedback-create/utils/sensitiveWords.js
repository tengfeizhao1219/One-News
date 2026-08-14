/**
 * 敏感词过滤表 — 权威单一真相源（原 feedback-create PRD §4.4）
 *
 * 说明：
 *  - 本表为「早先整理的敏感词汇过滤表」，派生自 feedback/create 的 KEYWORD_BLACKLIST（PRD §4.4）。
 *  - 作为 newsPipeline ⑥ 合规硬门禁的 COMPLIANCE_HARD_BLACKLIST（命中即丢弃，不进评分、不进缓存）；
 *    同时 feedback-create 仍使用同内容（保持两处一致，避免漂移）。
 *  - 覆盖五大类：涉黄 / 涉政敏感 / 暴力 / 辱骂 / 广告 spam。
 *  - 与 msgSecCheck（SecurityCheck，AI 语义审核）互补：
 *      msgSecCheck 负责大语义违规（需联网审核）；
 *      本表负责可客观判定的敏感词硬拦截（本地秒级、无网络依赖、兜底）。
 *  - 维护口径：两处副本（newsPipeline/utils/sensitiveWords.js 与 feedback-create/utils/sensitiveWords.js）
 *      保持内容一致；需在云端改词时两处同步更新（或后续并入公共 common/ 层统一打包）。
 */

const SENSITIVE_WORDS = [
  // ── 涉黄 ──
  '约炮', '一夜情', '嫖娼', '卖淫', '裸聊', '色情', '做爱', '性爱',
  // ── 涉政敏感 ──
  '六四', '法轮功', '李洪志', '刘晓波', '台独', '藏独', '疆独', '港独', '达赖',
  // ── 暴力/威胁 ──
  '砍死', '弄死', '杀你全家', '炸了', '恐怖袭击',
  // ── 辱骂 ──
  '傻逼', '脑残', '智障', '白痴', '贱人', '婊子', '操你妈', '草泥马', '狗日的',
  // ── 广告/引流 ──
  '加微信', '加qq', '加v信', '兼职刷单', '日赚', '月入十万', '点击链接', '复制口令', '扫二维码', '拉人进群',
]

/** 命中检测：返回命中的敏感词；未命中返回 null。大小写不敏感（英文统一小写匹配）。 */
function matchSensitiveWord(text) {
  if (!text) return null
  const hay = String(text).toLowerCase()
  for (const kw of SENSITIVE_WORDS) {
    if (hay.includes(kw)) return kw
  }
  return null
}

module.exports = { SENSITIVE_WORDS, matchSensitiveWord }
