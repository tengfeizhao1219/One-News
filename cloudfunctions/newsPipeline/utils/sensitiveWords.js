/**
 * 敏感词过滤表 — 公共层权威单一真相源（原 feedback-create PRD §4.4）
 *
 * 覆盖五大类：涉黄 / 涉政敏感 / 暴力 / 辱骂 / 广告 spam。
 * 与 msgSecCheck（SecurityCheck，AI 语义审核）互补：
 *   - msgSecCheck 负责大语义违规（需联网审核）；
 *   - 本表负责可客观判定的敏感词硬拦截（本地秒级、无网络依赖、兜底）。
 *
 * ⚠️ 维护方式（重要）：
 *   - 本文件是「唯一真相源」，只在此处增删敏感词。
 *   - 云函数以单函数目录为根打包（CloudBase 不含兄弟目录），各函数内
 *     utils/sensitiveWords.js 是【本文件经 tools/sync-common.sh 生成的平铺副本】，
 *     部署时保持函数自包含（详见 scripts/deploy-cloudfunctions.sh v4.1 注释）。
 *   - 改词后跑一次：bash tools/sync-common.sh  即可同步到各函数副本。
 *   - 【不要】直接手改各函数 utils/ 下的副本（会被下一次同步覆盖）。
 *
 * 用途：
 *   - newsPipeline ⑥ 合规硬门禁 COMPLIANCE_HARD_BLACKLIST（命中即丢弃）；
 *   - feedback-create 意见反馈内容过滤（命中即拒绝）。
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
