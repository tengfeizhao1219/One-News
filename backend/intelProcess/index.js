// 情报处理引擎 intelProcess（T3.1 / P · LLM 阅读引擎）
// ============================================================
// ⚠️ 复用 One News rssFetcher 的 self-fan-out 分批范式（非其业务）：
//    全局开关 + 自愈建表 + 每批读 pending → 分层路由 → SOP 五步 →
//    写 intel_staged。intel_* 命名空间隔离，可整体摘除。
//
// 数据流（设计 §1.1 / §7.2 / §6.1）：
//   intel_ingest（原始，status=pending）→ intelProcess → intel_staged
//   （ProcessedItem，status=staged/released）→ 发布闸门 T4.1 置 isCurrent
//     指针 → intel_current（用户可见）
//
// 分层路由（设计 §6.6，非全量跑完整 SOP）：
//   - 廉价规则 + 信号词打分 → high / medium / low（低相关直接丢弃 70%+）
//   - high  → 完整 SOP 五步（强模型 intelChat）
//   - medium → 轻量摘要（一句话 + 场景映射，跳过实操/最小行动展开）
//   - low   → 置 status='low' 仅留痕，不进今日关注
//
// 数据质量闸门（2026-08-19 治理 前置「raw 加工清理」，设计在路由后、LLM 前）：
//   qualify() 做四道硬门槛，不合格直接丢弃（markIngest 'rejected' 留痕，不进 LLM / staged）：
//     ① 内容清洗：HTML 实体解码 + 清乱码/控制符 + 折叠空白（title/content/summary）
//     ② 空壳判定：有效正文 < minContent(60) 丢弃（HN 全空 / PH 仅 tagline）
//     ③ 新鲜度：publishedAt/fetchedAt 超 freshnessDays(7) 丢弃（旧文不混入今日）
//   LLM 全程使用清洗后的 clean 条目（title/content/summary），杜绝脏数据向下游扩散。
//
// LLM 通道（设计 §6.8，独立 intelProcess 云函数 + 独立 env key）：
//   复用 backend/common/intelLLM.js intelChat 多引擎降级链
//   （混元前置 → 智谱 → Qwen → DeepSeek）。
//   LLM Key 未配（T0.3 🚫 待 owner）→ 本轮静默降级跳过处理、不阻塞巡检。
//
// 特殊路由（设计 §6.7 硬约束）：命中「合同/API/接口/协议/价格/SLA 变更」
//   语义 → 先 commlog 广播留痕再进入今日关注。云端无法直达用户设备
//   127.0.0.1，先打日志级告警留痕，本地文件落地待 owner 拍部署形态。
//
// 部署注意：本函数 require('../common/intelLLM') 与 require('../common/ensureSchema')，
//   部署云函数时需将 backend/common/ 一并上传。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { ensureSchema } = require('../common/ensureSchema')
const { intelChat } = require('../common/intelLLM')
const router = require('../common/intelRouter')
const { qualify } = require('../common/intelClean')

// ─── 集合名（intel_* 命名空间）───
const INTEL_INGEST = 'intel_ingest'
const INTEL_STAGED = 'intel_staged'
const INTEL_PROFILE = 'intel_profile'

// ─── 阈值（对齐 intelRssPoll 分批范式）───
const BATCH_LIMIT = 20        // 单批处理条目数（防单实例串行超 60s）
// ─── 数据质量闸门（raw→处理层 硬门槛，2026-08-19 治理）───
const GATE = {
  minContent: 60,    // 有效正文最少字符数（空壳丢弃）
  freshnessDays: 7,  // 新鲜度窗口，超过判为陈旧丢弃
}

/**
 * 单条处理：路由 → SOP/轻量 → 写 intel_staged，并回写 ingest 消费状态。
 * 任何一步失败都不 throw，计入该条失败标记，不阻塞批次。
 */
async function processOne(item, profile) {
  const itemId = String(item.guid || item.itemId || '')
  if (!itemId) return { itemId: '', status: 'skip', reason: '无 guid' }

  // 已处理过则跳过（itemId 幂等去重，同篇不重处理 —— 设计 §6.6 缓存）
  const dup = await findStaged(itemId)
  if (dup) {
    await markIngest(itemId, 'done')
    return { itemId, status: 'skip', reason: 'already-staged' }
  }

  // ① 分层路由（廉价规则打分，不消耗强模型配额 —— 设计 §6.6）
  const route = router.score(item, profile)
  if (route.level === 'low') {
    await markIngest(itemId, 'low') // 留痕，不进今日关注
    return { itemId, status: 'low', relevance: 'low', reason: route.reason }
  }

  // ①.5 数据质量闸门（2026-08-19 治理）：清洗 + 硬门槛，不合格直接丢弃
  //   raw 层空壳/陈旧/脏文本在这里被拦下，不进 LLM、不进 staged，只留痕。
  const gate = qualify(item, GATE)
  if (!gate.pass) {
    await markIngest(itemId, 'rejected', { reason: gate.reasons.join('/'), gateLevel: route.level }) // 留痕不再重试，reason 落库可复盘
    console.log(`[intelProcess] 质量闸门拦截 ${itemId} (${route.level}) reason=${gate.reasons.join('/')}`)
    return { itemId, status: 'rejected', relevance: route.level, reason: gate.reasons.join('/') }
  }
  // 通过：后续 LLM 与 staged 全部改用清洗后的条目
  item = gate.clean

  // ② 组装 system prompt（角色 + 三重身份 + SOP 五步/轻量 + 固定模板）
  const { system, user } = buildPrompts(item, profile, route.level)

  // ③ LLM 调用（未配 Key → intelChat 内部降级返回 null，静默跳过不阻塞）
  const out = await intelChat({ systemPrompt: system, user, minAccept: 15, maxTokens: 900, tag: 'intelProcess/sop' })
  if (!out || !out.text) {
    await markIngest(itemId, 'pending') // 保持 pending，等 Key 配好重试
    return { itemId, status: 'skip', reason: 'no-llm-key-or-engine' }
  }

  // ④ 解析 LLM 输出 → 结构化 ProcessedItem（含场景标签命中计数）
  const parsed = parseSopOut(out.text, item, profile, route)

  // ④.5 产出质量闸门（2026-08-19 治理）：一句话定义必填，为空判定低质产出 → 不进今日关注，只留痕可复盘
  //   空 definition 会让调度侧落入「（定义待补充）」占位文案污染展示，这里源头拦截。
  if (!parsed.definition || !String(parsed.definition).trim()) {
    await markIngest(itemId, 'rejected', { reason: 'definition-empty', gateLevel: route.level })
    console.log('[intelProcess] 定义缺失拦截 ' + itemId + ' (' + route.level + ') — parsed.definition 为空，不进 staged')
    return { itemId, status: 'rejected', relevance: route.level, reason: 'definition-empty' }
  }

  const staged = {
    itemId,
    sourceId: String(item.sourceId || ''),
    title: String(item.title || ''),
    url: String(item.url || ''),
    relevance: route.level,
    sceneTags: parsed.sceneTags,
    sceneHits: parsed.sceneHits,
    sop: {
      source: { name: String(item.sourceName || ''), layer: String(item.layer || ''), publishedAt: String(item.publishedAt || ''), url: String(item.url || '') },
      definition: parsed.definition,
      whatHappened: parsed.whatHappened,
      sceneMapping: parsed.sceneMapping,
      practice: parsed.practice,
      minAction: parsed.minAction,
    },
    translated: route.level === 'high' ? parsed.translated : true, // 轻量默认已中文
    tryable: parsed.tryable,
    // T3.4 钩子：上手试试的真实调研+链接校验在联调阶段落地，见解析侧备注
    research: { status: 'todo', note: 'T3.4 联调阶段做链接校验，禁瞎编' },
    processedAt: new Date().toISOString(),
    modelUsed: out.engine || '',
    cost: route.level === 'high' ? 1 : 0, // 强模型计 1 次配额；轻量为规则的近似
    status: 'staged',
  }
  await upsertStaged(staged)
  await markIngest(itemId, 'done')
  return { itemId, status: 'ok', relevance: route.level, sceneHits: parsed.sceneHits, tryable: parsed.tryable }
}

/** 查 intel_staged 是否已存在（itemId 幂等去重） */
async function findStaged(itemId) {
  try {
    const res = await db.collection(INTEL_STAGED).where({ itemId }).limit(1).get()
    return (res.data && res.data[0]) || null
  } catch (e) { return null }
}

/** 写 / 覆盖 intel_staged 单条 */
async function upsertStaged(staged) {
  try {
    const doc = await findStaged(staged.itemId)
    if (doc && doc._id) {
      await db.collection(INTEL_STAGED).doc(doc._id).update({ data: staged })
    } else {
      await db.collection(INTEL_STAGED).add({ data: staged })
    }
  } catch (e) {
    console.warn(`[intelProcess] 写 intel_staged 失败(${staged.itemId}):`, e.message)
  }
}

/** 回写 intel_ingest 消费状态（pending → done/low，幂等）；extra 合并进 data（如被拦截的 reason） */
async function markIngest(itemId, status, extra = {}) {
  try {
    await db.collection(INTEL_INGEST).where({ guid: itemId }).update({
      data: { status, processedAt: new Date().toISOString(), ...extra },
    })
  } catch (e) { /* 非阻塞 */ }
}

/**
 * 组装 LLM system + user prompt。
 * - high：完整 SOP 五步（设计 §6.2 + 固定模板 §6.3）
 * - medium：轻量摘要（一句话 + 场景映射，跳过实操/最小行动展开，设计 §6.6）
 */
function buildPrompts(item, profile, level) {
  const identities = describeIdentities(profile)
  const sx = String(item.title || '') + '\n' + String(item.content || item.summary || '')
  const text = sx.slice(0, 2400)

  // ── 画像参数（Phase 5 / T5.2）：depth/langPref 强化或调整 prompt ──
  // depth: 'deep' 强化深度/落地粒度；'lite' 走更轻量路径；'std'（缺省）维持原状
  // langPref: 'en' 翻译/输出保留英文原文（不译中）；'zh' 中文优先；'mixed'（缺省）维持原行为
  const p = (profile && typeof profile === 'object') ? profile : {}
  const depth = p.depth === 'deep' ? 'deep' : (p.depth === 'lite' ? 'lite' : 'std')
  const langPref = p.langPref === 'en' ? 'en' : (p.langPref === 'zh' ? 'zh' : 'mixed')

  // 翻译偏好：原默认「英文专有名词保留原文（首现可括号注中文）」。
  //   langPref='en' → 额外强调「正文以英文原文为主，不译中，术语保留原文不括注」；
  //   langPref='zh' → 额外强调「正文以中文为主，英文术语首现括号注中文」；mixed 不追加。
  let translatePref = ''
  if (langPref === 'en') translatePref = '\n正文以英文原文为主，不强行译中；专有术语保留原文，无需括号注中文。'
  else if (langPref === 'zh') translatePref = '\n正文以中文为主；英文术语首现括号注中文，后续用中文。'

  const baseSystem =
`你是老赵（AI 情报官）的落地教练。角色 = AI 情报官 + 落地教练。老赵三重身份：${identities}
务实、直接给结论，不堆参数、不软文、不夸大、不含糊其辞。英文专有名词保留原文（首现可括号注中文），不意译夸张措辞。${translatePref}`

  // depth 强化/轻量（仅 high 完整 SOP 路径注入；medium 轻量本就跳过实操）。
  //   'deep' → 「最小行动」可落地深度，给出可复盘的细节步骤与产出物；
  //   'lite' → 压缩实操，只给一两个关键动作，减少展开。
  let depthHint = ''
  if (depth === 'deep') depthHint = '\n（深度档）「可以怎么做」「最小行动」须给到可复盘的细节步骤、所用工具/入口与产出物，不只罗列概念。'
  else if (depth === 'lite') depthHint = '\n（精简档）「可以怎么做」压缩到 1-2 个关键动作，「最小行动」给最轻一步即可。'

  if (level === 'medium') {
    return {
      system: baseSystem + `\n对下面的单条情报做「轻量摘要」：
先输出一行「发生了什么」：用大白话 2-3 句讲清楚这条情报/产品/事件是什么、发生了什么、为什么值得关注，术语首现括号解释，让不懂的人也能看懂。
再输出一句话定义（含能力边界）+ 一句「对老赵的意义」（命中至少一个身份）。不要实操步骤。${depth === 'lite' ? '（精简档，更短）' : ''}`,
      user: `情报原文：\n${text}`,
    }
  }

  const system = baseSystem + depthHint + `

对下面单条情报按 SOP 六步硬性结构输出（欠一步即视为不合格）：
0. 发生了什么（科普向，最关键）：用普通人都能听懂的话，分 2-4 段讲清楚这条情报/产品/事件「是什么、核心内容/发生了什么、为什么值得关注、背后怎么回事/工作原理或背景」。术语首现用括号一句话解释（如 RAG（检索增强生成，让 AI 先查资料再作答））；避免英文缩写轰炸和堆参数。约 200-400 字，让不关注这条新闻的行外人看完也能跟人讲明白。别只写成一句话。
1. 信息溯源：来源、发布时间、原文链接；来源存疑标「待验证」
2. 一句话定义：是什么 + 能做什么 + 能力边界，不夸大不堆参数（保持精简，供列表摘要用）
3. 场景映射：命中老赵三重身份中至少一个（工作/产品/家庭），结合真实上下文，不空泛
4. 可落地实操案例：工具 + 步骤 + 收益 + 坑点，老赵明天就能用
5. 今日/本周最小行动：一个具体可勾选可复盘的下一步

输出用如下固定 Markdown 模板（严格对齐，字段缺失视为失败）：
### [条目标题]
**发生了什么**：[科普向详细叙事，2-4 段，普通人都能懂，见步骤 0]
- **溯源**：[来源] · [发布时间] · [链接]
- **一句话**：[定义 + 能力边界]
- **对老赵的意义**：[工作/产品/家庭 至少一项映射，并给出身份名]
- **可以怎么做**：[工具 + 步骤 + 收益 + 坑点]
- **最小行动**：[今日/本周可做的一件事]
最后单独一行输出 JSON 供程序解析（务必严格 JSON）：
{"sceneTags":["work_rcbc"|"product_onenews"|"life"],"tryable":true|false}`
  return { system, user: `情报原文：\n${text}` }
}

/** 描述老赵三重身份（供 prompt），读取 intel_profile（Phase 5 之前用默认画像） */
function describeIdentities(profile) {
  if (profile && profile.identities) {
    const id = profile.identities
    const parts = []
    if (id.work) parts.push(`工作（${id.work}）`)
    if (id.product) parts.push(`产品（${id.product}）`)
    if (id.life) parts.push(`家庭/生活（${id.life}）`)
    if (parts.length) return parts.join('；')
  }
  return '工作（RCBC FRAML 合规 PM + TrustDecision 供应商对接）；产品（One News 小程序 PD+FE + AI 阅读引擎 + RSS + theme.json）；家庭/生活（装修、育儿、个人效率、自动化）'
}

/**
 * 解析 LLM 输出为结构化 ProcessedItem 字段。
 * 用最稳的正则切出五步字段；JSON 内嵌行提取 sceneTags/tryable。
 */
function parseSopOut(text, item, profile, route) {
  const t = String(text || '')
  const sceneTags = []
  const hitsIndicators = ['工作', '产品', '家庭', 'rcbc', 'framl', 'trustdecision', 'one news', 'onenews', '阅读引擎', 'theme.json', 'rss', '装修', '育儿', '自动化']
  let sceneHits = 0
  const profileHint = describeIdentities(profile)
  const hitMap = {
    work_rcbc: /rcbc|framl|合规|trustdecision|制裁|aml|反洗钱|供应商/i,
    product_onenews: /one news|onenews|阅读引擎|小程序|rss|theme|设计系统|信息流|摘要|情报/i,
    life: /装修|育儿|家居|家电|家庭|厨房|效率|自动化|脚本|节能/i,
  }
  for (const k of Object.keys(hitMap)) {
    const re = hitMap[k]
    const inBody = re.test(t) || re.test(String(item.title || ''))
    const inIdentity = re.test(profileHint)
    if (inBody || inIdentity) sceneTags.push(k)
  }
  // 场景命中强度 = 文本+标题里显式身份词的命中数（设计 §6.4 强度规则）
  hitsIndicators.forEach((kw) => { if (t.toLowerCase().includes(kw.toLowerCase())) sceneHits++ })

  // 提取 JSON 内嵌行（规则：单独一行以 { 开头、含 "tryable" 或 "sceneTags"）
  let tryable = false
  const jsonMatch = t.match(/^\s*\{[\s\S]*?\}\s*$/m)
  if (jsonMatch) {
    try {
      const j = JSON.parse(jsonMatch[0])
      if (j && Array.isArray(j.sceneTags)) sceneTags.length = 0, sceneTags.push(...j.sceneTags.filter(Boolean))
      if (typeof j.tryable === 'boolean') tryable = j.tryable
    } catch (e) { /* 解析失败则用正则兜底 */ }
  }
  if (!jsonMatch) {
    tryable = /tryable"?\s*:\s*true/i.test(t)
  }

  const sec = (re) => { const m = t.match(new RegExp(re + '[:：](.{0,600})', 'i')); return m ? m[1].replace(/\n+/g, ' ').trim() : '' }
  // 块级提取：取 startRe 匹配后的多段正文，直到遇到 endRe 为止（用于「发生了什么」多段科普叙事）
  const secBlock = (startRe, endRe) => {
    const t2 = String(t)
    const sm = t2.match(startRe)
    if (!sm) return ''
    let start = sm.index + sm[0].length
    let end = t2.length
    if (endRe) {
      const ei = t2.search(endRe)
      if (ei >= start) end = ei
    }
    return t2.slice(start, end).replace(/^[\s\n*-]+|[\s\n]+$/g, '').replace(/\n{2,}/g, '\n').trim()
  }
  // 发生了什么：优先取模板块（标题下第一块，至溯源前）；否则取「发生了什么:」到「对老赵的意义」/「定义」之前的文本
  const whatHappened =
    secBlock(/\*\*发生了什么\*\*\s*[:：]?\s*/, /[-*]\s*\*\*溯源\*\*/) ||
    secBlock(/发生了什么\s*[:：]/, /对老赵的意义|一句话|定义/) ||
    ''
  return {
    whatHappened,
    definition: sec('-?\\*\\*一句话\\*\\*') || sec('一句话') || sec('2\\)?[．.、]?\\s*一句话') || sec('定义'),
    sceneMapping: sec('-?\\*\\*对老赵的意义\\*\\*') || sec('对老赵的意义') || sec('3\\)?[．.、]?\\s*场景映射'),
    practice: sec('-?\\*\\*可以怎么做\\*\\*') || sec('可以怎么做') || sec('4\\)?[．.、]?\\s*可落地实操'),
    minAction: sec('-?\\*\\*最小行动\\*\\*') || sec('最小行动') || sec('5\\)?[．.、]?\\s*今日/本周最小行动'),
    sceneTags: sceneTags.length ? sceneTags : (route.level === 'low' ? [] : ['life']),
    sceneHits,
    tryable,
    translated: true,
  }
}

/**
 * 主入口 = self-fan-out 分批消费 intel_ingest(status=pending)。
 * 每批读 BATCH_LIMIT，处理不完 fire-and-forget 续跑（对齐 intelRssPoll 分片范式）。
 * event.batch=false / event.limit 可强制串行（联调用）。
 */
exports.main = async (event = {}) => {
  const now = new Date().toISOString()
  const force = event.force === true
  // 全局开关（对齐 worker：app.js 里 FEED_GLOBAL_ON）
  try {
    const cfg = await db.collection('intel_config').doc('intel_process_switch').get().catch(() => null)
    if (cfg && cfg.data && cfg.data.on === false && !force) {
      console.log('[intelProcess] 全局已关闭，本轮跳过')
      return { ok: true, skipped: true, reason: 'global-off' }
    }
  } catch (e) { /* 无开关则默认开 */ }

  await ensureSchema()

  // 读取画像（Phase 5 之前为空，用默认画像）
  let profile = null
  try {
    const p = await db.collection(INTEL_PROFILE).limit(1).get()
    profile = (p.data && p.data[0]) || null
  } catch (e) { profile = null }

  // 取待处理 pending 批次
  let todo = []
  try {
    const res = await db.collection(INTEL_INGEST)
      .where({ status: 'pending' })
      .orderBy('fetchedAt', 'asc')
      .limit(BATCH_LIMIT)
      .get()
    todo = res.data || []
  } catch (e) {
    console.warn('[intelProcess] 读 pending 批次失败:', e.message)
    return { ok: false, reason: 'read-pending-fail' }
  }

  if (!todo.length) {
    return { ok: true, processed: 0, note: '无待处理条目' }
  }

  // 本批串行处理（每批 ~20 条，单条 LLM ≤5s，最坏可控在 60s 内）
  const results = []
  for (const item of todo) {
    results.push(await processOne(item, profile))
  }
  const okCount = results.filter((r) => r.status === 'ok').length

  // 总量仍有很多 pending → self-fan-out 续跑（fire-and-forget，不阻塞返回）
  let remaining = 0
  try {
    const c = await db.collection(INTEL_INGEST).where({ status: 'pending' }).count()
    remaining = c.total || 0
  } catch (e) { remaining = 0 }
  if (remaining > 0 && !event.disableFanout) {
    console.log(`[intelProcess] 仍剩 ${remaining} 条 pending，自我分片续跑（fire-and-forget）`)
    cloud.callFunction({ name: 'intelProcess', data: { disableFanout: true } })
      .then(() => {}).catch(() => {})
  }

  return { ok: true, processed: todo.length, okCount, remaining, results }
}
