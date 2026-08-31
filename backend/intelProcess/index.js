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
//   （混元前置 → 智谱 → DeepSeek → ys365，2026-08-24 移除 Qwen）。
//   LLM Key 未配（T0.3 🚫 待 owner）→ 本轮静默降级跳过处理、不阻塞巡检。
//
// 特殊路由（设计 §6.7 硬约束）：命中「合同/API/接口/协议/价格/SLA 变更」
//   语义 → 先 commlog 广播留痕再进入今日关注。云端无法直达用户设备
//   127.0.0.1，先打日志级告警留痕，本地文件落地待 owner 拍部署形态。
//
// 部署注意：本函数 require('./common/intelLLM') 与 require('./common/ensureSchema')，
//   部署云函数时需将 backend/common/ 一并上传。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const { ensureSchema } = require('./common/ensureSchema')
const { intelChat } = require('./common/intelLLM')
const router = require('./common/intelRouter')
const { qualify } = require('./common/intelClean')

// ─── 集合名（intel_* 命名空间）───
const INTEL_INGEST = 'intel_ingest'
const INTEL_STAGED = 'intel_staged'
const INTEL_PROFILE = 'intel_profile'
// ③ 修复：scoreSourceQuality 用到的源集合常量此前未声明（跑第 180/198 行抛 ReferenceError 被外层吞掉，
//    源质量打分整体失效）。真实集合名见 backend/seedSources.js: INTEL_SOURCE_COLLECTION='intel_sources'。
const INTEL_SOURCES = 'intel_sources'

// ─── 阈值（对齐 intelRssPoll 分批范式）───
const BATCH_LIMIT = 10        // 单批处理条目数（防单实例串行超 60s）
// ─── 数据质量闸门（raw→处理层 硬门槛，2026-08-19 治理）───
const GATE = {
  minContent: 60,    // 有效正文最少字符数（空壳丢弃）
  freshnessDays: 1,  // 新鲜度窗口（owner 2026-08-19 收紧 7→1：历史数据不混入当天 brief）
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
  // 2026-08-20：per-source 新鲜度（官方低频源 freshnessDays=7，新闻源默认 1）
  const gateCfg = Number(item.freshnessDays) > 0 || Number(item.minContent) > 0
    ? Object.assign({}, GATE,
        Number(item.freshnessDays) > 0 ? { freshnessDays: Number(item.freshnessDays) } : {},
        Number(item.minContent) > 0 ? { minContent: Number(item.minContent) } : {})
    : GATE
  const gate = qualify(item, gateCfg)
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
  // P1 优化：medium 轻量路径 maxTokens 400（只需简短摘要），high 完整 SOP 900
  const out = await intelChat({
    systemPrompt: system, user,
    minAccept: 60,
    maxTokens: route.level === 'medium' ? 520 : 900,
    tag: 'intelProcess/sop',
  })
  if (!out || !out.text) {
    // 2026-08-19 复盘：LLM 失败重试上限——连续 3 次仍失败则 rejected 留痕，避免永久 pending 死循环
    const prevRetry = Number(item.retryCount) || 0
    const retryCount = prevRetry + 1
    if (retryCount >= 3) {
      await markIngest(itemId, 'rejected', { reason: 'llm-fail-retry-exhausted', retryCount })
      return { itemId, status: 'rejected', reason: 'llm-fail-retry-exhausted', retryCount }
    }
    await markIngest(itemId, 'pending', { retryCount }) // 保持 pending，等 Key 配好/重试
    return { itemId, status: 'skip', reason: 'no-llm-key-or-engine', retryCount }
  }

  // ④ 解析 LLM 输出 → 结构化 ProcessedItem（含场景标签命中计数）
  const parsed = parseSopOut(out.text, item, profile, route)

  // ④.5 产出质量闸门（2026-08-19 治理）：一句话定义必填，为空判定低质产出 → 不进今日关注，只留痕可复盘
  //   空 definition 会让调度侧落入「（定义待补充）」占位文案污染展示，这里源头拦截。
  if (!parsed.definition || !String(parsed.definition).trim()) {
    // 2026-08-20 修复：LLM 输出格式漂移时用摘要/标题兜底，不误拦截合法条目（原直接 rejected）
    const fb = String(item.summary || item.content || '').trim().replace(/\s+/g, ' ').slice(0, 100)
    if (fb) {
      parsed.definition = fb
      console.log('[intelProcess] definition 兜底 ' + itemId + ' (' + route.level + ') 用摘要')
    } else {
      await markIngest(itemId, 'rejected', { reason: 'definition-empty', gateLevel: route.level })
      console.log('[intelProcess] 定义缺失拦截 ' + itemId + ' (' + route.level + ') — 无摘要可兜底，不进 staged')
      return { itemId, status: 'rejected', relevance: route.level, reason: 'definition-empty' }
    }
  }

  // ④.6 中文化兜底（2026-08-21 优化）：一句话定义/标题为英文时补一次轻量翻译
  //   glm-4-flash 对英文源常直接输出英文句子——prompt 已强制中文，这里兜底存量/漏网
  if (isMostlyEnglish(parsed.definition)) {
    const tz = await translateZh(parsed.definition)
    if (tz) { parsed.definition = tz; console.log('[intelProcess] definition 英文→中文兜底 ' + itemId) }
  }
  if (!parsed.titleCn && isMostlyEnglish(String(item.title || ''))) {
    const tz = await translateZh(String(item.title))
    if (tz) { parsed.titleCn = tz; console.log('[intelProcess] 标题英文→中文兜底 ' + itemId) }
  }

  const staged = {
    itemId,
    sourceId: String(item.sourceId || ''),
    title: String((parsed && parsed.titleCn) || item.title || ''), // 2026-08-20: 英文源标题翻译为中文（titleCn），原文存 sop.source.titleEn
    url: String(item.url || ''),
    relevance: route.level,
    freshnessDays: Number(item.freshnessDays) > 0 ? Number(item.freshnessDays) : undefined, // 2026-08-20: per-source 新鲜度透传（dispatcher passFreshness 覆盖 7 天默认，低频官方源 30 天不误杀）
    sceneTags: parsed.sceneTags,
    sceneHits: parsed.sceneHits,
    sop: {
      source: { name: String(item.sourceName || ''), layer: String(item.layer || ''), publishedAt: String(item.publishedAt || ''), url: String(item.url || ''), titleEn: String(item.title || '') },
      definition: parsed.definition,
      whatHappened: parsed.whatHappened,
      whatHappenedBlocks: parsed.whatHappenedBlocks, // 2026-08-21 方案A：LLM 直接输出的结构化块（含 predict 类型），不再文本正则切分
      sceneMapping: parsed.sceneMapping,
      sceneMappingLines: parsed.sceneMappingLines,   // 2026-08-21 方案A：落到你这里结构化 lines（segments+bold），前端直接渲染
      practice: parsed.practice,
      minAction: parsed.minAction,
      plainTalk: parsed.plainTalk,                   // 2026-08-21：大白话解读（仅专业/深度文档非空）
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

/**
 * ④ 每源每批次质量打分（2026-08-19 owner 拍板）：
 *    quality = 10×(staged/processed) − 3×(rejected/processed)，clamp 0-10。
 *    样本 ≥3 才打分；低于 6 分自动停用该源（status=retired, enabled=false，以后不再抓取），
 *    滚动保存最近 5 次分数便于复盘/人工恢复。
 */
async function scoreSourceQuality(todo, results) {
  try {
    const stats = {}
    for (let i = 0; i < todo.length; i++) {
      const src = todo[i].sourceId || 'unknown'
      const r = results[i] || {}
      stats[src] = stats[src] || { processed: 0, staged: 0, low: 0, rejected: 0 }
      const s = stats[src]
      s.processed++
      if (r.status === 'ok') s.staged++
      else if (r.status === 'low') s.low++
      else if (r.status === 'rejected') s.rejected++
    }
    for (const [src, s] of Object.entries(stats)) {
      if (s.processed < 3) continue // 样本太少不打分，避免单条坏批次误杀
      const quality = Math.max(0, Math.min(10,
        Math.round((10 * (s.staged / s.processed) - 3 * (s.rejected / s.processed)) * 10) / 10))
      const doc = await db.collection(INTEL_SOURCES).where({ key: src }).limit(1).get().catch(() => null)
      const srcDoc = (doc && doc.data && doc.data[0]) || null
      if (!srcDoc) continue
      const prev = Array.isArray(srcDoc.qualityScores) ? srcDoc.qualityScores : []
      // 2026-08-21（owner 拍板）：滚动窗口 = 近 42 次评分（每天 3 批次 × 两周），停用看平均分
      const scores = [...prev, quality].slice(-42)
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length
      const patch = {
        qualityScore: quality,
        qualityAvg: Math.round(avg * 10) / 10,
        qualityScores: scores,
        lastQualityAt: new Date().toISOString(),
      }
      // 2026-08-21 优化（owner 拍板）：停用判断用「近 42 次评分（约两周）平均分」而非单轮分——
      //   单轮低分可能源于重抓/批次波动/解析失败（如 arxiv 单轮全 rejected 但 avg 9.3），
      //   用滚动平均避免误伤；avg 连续低质才停用。
      //   至少累计 5 次评分才启用停用判断（新源/刚恢复源先积累样本，防单次波动误杀）。
      if (scores.length >= 5 && avg < 6) {
        patch.enabled = false
        patch.status = 'retired'
        patch.retireReason = `avg<6(${Math.round(avg * 10) / 10}): 近${scores.length}次=[${scores.slice(-10).join(',')}] 本轮 staged=${s.staged}/${s.processed}, rejected=${s.rejected}`
        console.warn(`[intelProcess] 源 ${src} 平均质量分 ${Math.round(avg * 10) / 10}<6 自动停用（近 ${scores.length} 次: ${scores.join(',')}）`)
      }
      await db.collection(INTEL_SOURCES).where({ key: src }).update({ data: patch }).catch(() => {})
    }
  } catch (e) {
    console.warn('[intelProcess] 源质量打分失败（非阻塞）:', e.message)
  }
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
  // P1 优化（2026-08-19）：medium 轻量路径只需简短摘要，内容切片减半省输入 token
  const text = sx.slice(0, level === 'medium' ? 1200 : 2400)

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
  //   'deep' → 「想试试」可落地深度，给出可复盘的细节步骤与产出物；
  //   'lite' → 压缩实操，只给一两个关键动作，减少展开。
  let depthHint = ''
  if (depth === 'deep') depthHint = '\n（深度档）「可以怎么做」「想试试」须给到可复盘的细节步骤、所用工具/入口与产出物，不只罗列概念。'
  else if (depth === 'lite') depthHint = '\n（精简档）「可以怎么做」压缩到 1-2 个关键动作，「想试试」给最轻一步即可。'

  if (level === 'medium') {
    return {
      system: baseSystem + `\n对下面单条情报做「轻量摘要」，**只输出一个 JSON 对象**（不要 markdown 代码块、不要任何解释文字、不要输出 JSON 以外的内容）。字段全部使用字符串/布尔/数组，结构扁平：
{
  "titleCn": "中文标题（把本条标题翻译成自然通顺的中文）",
  "whatHappened": "发生了什么正文：**严格基于情报原文客观转述**，把核心事实、关键数字、机制讲清楚，像如实复述新闻本身；禁止以介绍者视角说话（不要出现「他/该公司/我们」「专业解读」「大白话」等字样）。总 180-320 字，按逻辑分 2-3 段，段与段之间用【换行+空行】分隔；语言风格贴合内容（技术→冷静专业/社区→轻松），句式多样化",
  "aiPrediction": "结尾若确有未来影响才写这一段（推测性措辞，可能会…，不要写成既成事实；没有未来影响则为空字符串）。**这一段不要写进 whatHappened**",
  "plainTalk": "大白话解读（给不懂 AI 的普通读者看）：**先判断原文是否专业且有深度**——若原文包含普通读者不借助解读就无法理解的专业内容（论文/技术原理/方法论/术语密集）才写；用通俗的比喻和日常语言讲清这篇讲了什么、对普通人意味着什么（150-250字）；若原文是普通新闻/浅层动态/无专业门槛 → 空字符串（不要硬写）",
  "definition": "一句话定义（是什么 + 能做什么 + 能力边界，不夸大不堆参数，供列表摘要用）。**必须用自然通顺的中文**：英文源先翻译成中文，专有术语保留原文首次出现括号注中文；输出英文视为不合格",
  "sceneMapping": "落到你这里（场景映射）：**先判断关联性**——仅当与老赵行业/职位/关注议题**强相关且能具体点出关联点**时才写；第一行点明相关性（关键概念用 **加粗** 强调），后续每行一个使用场景（关键动作加粗），用换行分隔；弱相关/无法关联 → 空字符串，禁止强行关联凑数",
  "practice": "可以怎么做：1-2 句能落地的做法（工具/动作/收益），无则空字符串",
  "minAction": "想试试：轻松引导口吻（想体验的话，可以试试…），给 1 条最轻步骤，无则空字符串",
  "tryable": true,
  "sceneTags": []
}
约束：
- 所有字段都要输出，值不确定时用空字符串，不要省略字段
- sceneTags 必须与 sceneMapping 严格对应：sceneMapping 为空 → []；非空 → 从映射文本推导，含「工作/合规/FRAML/供应商」→ "work"；含「产品/One News/小程序/阅读引擎」→ "product"；含「家庭/生活/装修/育儿」→ "life"（可多选，未命中则为空数组，禁止硬套标签）
- 严格 JSON：必须可被 JSON.parse 解析；缩进无关紧要；不要输出 JSON 以外的任何文字`,
      user: `情报原文：\n${String(text || '').replace(/\uFFFD/g, '')}`,
    }
  }

  const system = baseSystem + depthHint + `

对下面单条情报按完整 SOP 处理，**只输出一个 JSON 对象**（不要 markdown 代码块、不要任何解释文字、不要输出 JSON 以外的任何内容）。字段全部使用字符串/布尔/数组，结构扁平：
{
  "titleCn": "中文标题（把本条标题翻译成自然通顺的中文）",
  "whatHappened": "发生了什么正文：**严格基于情报原文客观转述**，把核心事实、关键数据、机制、背景讲清楚，像如实复述新闻本身；禁止以介绍者视角说话（不要出现「他/该公司做了…」「我们来看…」「专业解读」「大白话」等字样），不添加原文没有的观点。按原文逻辑分 2-4 段，段与段之间用【换行+空行】分隔；术语保留原文，贴合内容性质选择语气（技术发布→冷静专业；行业动态→洞见；警示类→谨慎），句式多样化，总长 300-550 字",
  "aiPrediction": "结尾若确有未来影响才写这一段（推测性措辞，可能会…，不要写成既成事实；没有未来影响则为空字符串）。**这一段不要写进 whatHappened**",
  "plainTalk": "大白话解读（给不懂 AI 的普通读者看）：**先判断原文是否专业且有深度**——若原文包含普通读者不借助解读就无法理解的专业内容（论文/技术原理/方法论/术语密集）才写；用通俗的比喻和日常语言讲清这篇讲了什么、对普通人意味着什么（150-250字）；若原文是普通新闻/浅层动态/无专业门槛 → 空字符串（不要硬写）",
  "definition": "一句话定义：是什么 + 能做什么 + 能力边界，不夸大不堆参数（保持精简，供列表摘要用）。**必须用自然通顺的中文输出**：对英文源先翻译成中文，专有术语保留原文并在首次出现时括号注中文；输出英文句子视为不合格",
  "sceneMapping": "落到你这里（场景映射）：**先判断关联性**——仅当与老赵行业/职位/关注议题**强相关且能具体点出关联点**时才写；第一行点明相关性（关键概念用 **加粗** 强调），后续每行一个使用场景（关键动作加粗），用换行分隔；弱相关/无法关联 → 空字符串，禁止强行关联凑数",
  "practice": "可以怎么做：工具 + 步骤 + 收益 + 坑点，老赵明天就能用",
  "minAction": "想试试：**轻松引导语气（owner 拍板，非命令式）**——仅当存在现在就能上手尝试的具体功能/产品/新特性时，用「想体验的话，可以试试…」口吻给 1 条，具体到「打开哪里 → 做什么 → 得到什么」；无则空字符串。**禁止命令式措辞**（不得出现「本周X前」「必须」「请尽快」等）；行业动态/收购/融资/观点类新闻 → 空字符串，禁止硬造",
  "tryable": true,
  "sceneTags": []
}
约束：
- 所有字段都要输出，值不确定时用空字符串，不要省略字段
- sceneTags 必须与 sceneMapping 严格对应：sceneMapping 为空 → []；非空 → 从映射文本推导，含「工作/合规/FRAML/供应商」→ "work"；含「产品/One News/小程序/阅读引擎」→ "product"；含「家庭/生活/装修/育儿」→ "life"（可多选，未命中则为空数组，禁止硬套标签）
- 严格 JSON：必须可被 JSON.parse 解析；缩进无关紧要；不要输出 JSON 以外的任何文字${depthHint}`
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
/** 判断文本是否主要为英文（无中文字符且含英文单词 → 需翻译） */
function isMostlyEnglish(s) {
  const t = String(s || '').trim()
  if (!t) return false
  if (/[\u4e00-\u9fa5]/.test(t)) return false
  return /[A-Za-z]{4,}/.test(t)
}

/** 轻量翻译（中文化兜底，2026-08-21）：失败返回 null 保留原文 */
async function translateZh(text) {
  if (!text) return null
  const out = await intelChat({
    systemPrompt: '你是翻译助手。把用户给的英文翻译成自然通顺的中文：专有术语/产品名保留原文，首次出现时用括号注中文；不要加任何解释或引号，只输出译文。',
    user: String(text),
    minAccept: 30,
    maxTokens: 200,
    tag: 'intelProcess/translate',
  })
  return (out && out.text && String(out.text).trim()) ? String(out.text).trim() : null
}

/**
 * 解析 LLM 输出为结构化 ProcessedItem 字段（2026-08-21 方案 A：全 JSON 结构化）。
 * LLM 被要求只输出一个 JSON 对象（见 buildPrompts），这里：
 *   1) 剥 markdown 代码块/杂散文本，取最后一个合法 JSON 对象
 *   2) JSON.parse + 字段校验/归一
 *   3) 计算 sceneHits（场景命中强度，rank 用）——纯文本统计，不依赖 LLM
 * 不再使用任何章节正则（旧 sec/secBlock/SEP_RE 全部废弃）。
 */
function parseSopOut(text, item, profile, route) {
  const t = String(text || '').trim()
  console.log('[parseSopOut] LLM 原始输出前300字:', JSON.stringify(t.slice(0, 300)))
  const empty = {
    whatHappened: '', whatHappenedBlocks: [],
    definition: '', sceneMapping: '', sceneMappingLines: [],
    practice: '', minAction: '', plainTalk: '',
    sceneTags: [], sceneHits: 0, tryable: false, titleCn: '', translated: true,
  }
  if (!t) return empty

  // 1) 提取最后一个合法 JSON 对象（剥 ```json 代码块、杂散前后文）
  let jsonStr = ''
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\s*```/i)
  if (fenced && fenced[1]) jsonStr = fenced[1]
  else {
    const all = [...t.matchAll(/\{[\s\S]*?\}/g)]
    for (let i = all.length - 1; i >= 0; i--) {
      const cand = all[i][0]
      try { JSON.parse(cand); jsonStr = cand; break } catch (e) { /* 继续找更早的 */ }
    }
  }
  if (!jsonStr) {
    // 终极兜底：全文从第一个 { 到最后一个 }（LLM 可能在 JSON 前后夹带文字）
    const s = t.indexOf('{'), e = t.lastIndexOf('}')
    if (s >= 0 && e > s) jsonStr = t.slice(s, e + 1)
  }
  let j = null
  if (jsonStr) {
    try { j = JSON.parse(jsonStr) } catch (e) { console.warn('[parseSopOut] JSON 解析失败，返回空结构:', (e && e.message) || e) }
  }
  if (!j || typeof j !== 'object') return empty

  /** 「无」/「无（…）」/空 → 归一为空串 */
  const normNone = (v) => {
    const s = String(v || '').trim()
    if (!s) return ''
    if (/^无[。）)]?$/.test(s)) return ''
    if (/^（?无关联）?$/.test(s)) return ''
    return s
  }
  const clean = (v) => String(v || '').replace(/\uFFFD/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim()

  // 2) whatHappened：字符串正文 + aiPrediction 独立字段 → blocks（结构化，供前端渲染）
  //    兼容旧数组形态（LLM 过渡期可能仍输出 [{type,text}]）
  let blocks = []
  if (Array.isArray(j.whatHappened)) {
    blocks = j.whatHappened
      .map((b) => ({
        type: b && (b.type === 'predict' || b.type === 'def' || b.type === 'plain') ? b.type : 'text',
        text: clean(b && b.text),
      }))
      .filter((b) => b.text)
  } else {
    const whStr = clean(j.whatHappened)
    if (whStr) {
      const paras = whStr.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean)
      blocks = (paras.length ? paras : [whStr]).map((p) => ({ type: 'text', text: p }))
    }
  }
  // aiPrediction：独立字段 → 追加为最后一个 predict 块（仅当有内容且不是首段）
  const pred = clean(j.aiPrediction)
  if (pred) {
    if (blocks.length === 0) blocks = [{ type: 'predict', text: pred }]
    else blocks.push({ type: 'predict', text: pred })
  }
  // 兜底：predict 在第一段 → 降级为 text（LLM 误标）
  if (blocks.length > 1 && blocks[0].type === 'predict') blocks[0].type = 'text'
  const whatHappened = blocks.map((b) => b.text).join('\n\n')

  // 3) sceneMapping：字符串（LLM 输出）→ 按行 + **加粗** 拆结构化 lines（前端直接渲染）
  //    兼容旧对象形态 {relevant, lines:[{segments}]}（过渡期）
  let sceneMapping = ''
  let sceneMappingLines = []
  if (j.sceneMapping && typeof j.sceneMapping === 'object') {
    const sm = j.sceneMapping
    const smRelevant = sm.relevant !== false
    const smLines = (Array.isArray(sm.lines) ? sm.lines : [])
      .map((ln) => ({
        segments: (Array.isArray(ln && ln.segments) ? ln.segments : [{ text: clean(ln && ln.text), bold: false }])
          .map((sg) => ({ text: clean(sg && sg.text), bold: sg && sg.bold === true }))
          .filter((sg) => sg.text),
      }))
      .filter((ln) => ln.segments.length)
    sceneMapping = smRelevant ? (smLines.map((ln) => ln.segments.map((sg) => sg.text).join('')).join('\n')) : ''
    sceneMappingLines = smRelevant ? smLines : []
  } else {
    const smStr = String(j.sceneMapping || '').trim()
    // 「无」→ 空（弱相关不强行关联）
    const normed = /^无[。）)]?$/.test(smStr) || /^（?无关联）?$/.test(smStr) ? '' : smStr
    if (normed) {
      sceneMapping = normed
      sceneMappingLines = normed.split('\n').map((line) => {
        const segments = []
        const parts = line.split(/\*\*(.+?)\*\*/g)
        parts.forEach((p, i) => { if (p) segments.push({ text: p.trim(), bold: i % 2 === 1 }) })
        return { segments: segments.filter((sg) => sg.text) }
      }).filter((ln) => ln.segments.length)
    }
  }

  // 4) 场景标签 + 命中强度（rank 用，纯文本统计）
  // 2026-08-31 修复：不再信任 LLM 固定输出的 sceneTags（此前 prompt 示例硬编码 work_rcbc → 每篇都命中"工作"）。
  // 改为从 sceneMapping 文本推导：映射为空 → []；非空按关键词归到 work/product/life，未命中则为空数组。
  const mappingText = String(j.sceneMapping || '').toLowerCase()
  const sceneTags = []
  if (mappingText) {
    if (/工作|合规|framl|trustdecision|供应商|银行|风控/.test(mappingText)) sceneTags.push('work')
    if (/产品|one news|onenews|小程序|阅读引擎|theme|rss/.test(mappingText)) sceneTags.push('product')
    if (/家庭|生活|装修|育儿|个人效率|自动化/.test(mappingText)) sceneTags.push('life')
  }
  const hitsIndicators = ['工作', '产品', '家庭', 'rcbc', 'framl', 'trustdecision', 'one news', 'onenews', '阅读引擎', 'theme.json', 'rss', '装修', '育儿', '自动化']
  const corpus = (t + ' ' + String(item.title || '')).toLowerCase()
  let sceneHits = 0
  hitsIndicators.forEach((kw) => { if (corpus.includes(kw.toLowerCase())) sceneHits++ })

  // 5) 其余字段 + 兼容：definition 缺时用 whatHappened 首段兜底（保证列表摘要有内容）
  let definition = clean(j.definition)
  if (!definition && blocks.length) definition = blocks[0].text.slice(0, 60)

  return {
    whatHappened,
    whatHappenedBlocks: blocks,
    definition,
    sceneMapping,
    sceneMappingLines,
    practice: clean(j.practice),
    minAction: normNone(j.minAction),
    plainTalk: clean(j.plainTalk),
    sceneTags: sceneTags.length ? sceneTags : ['life'],
    sceneHits,
    tryable: j.tryable === true,
    titleCn: clean(j.titleCn),
    translated: true,
  }
}

/**
 * 主入口 = self-fan-out 分批消费 intel_ingest(status=pending)。
 * 每批读 BATCH_LIMIT，处理不完 fire-and-forget 续跑（对齐 intelRssPoll 分片范式）。
 * event.batch=false / event.limit 可强制串行（联调用）。
 */
exports.main = async (event = {}) => {
  // ── 运维 action：rebuildBlocks（2026-08-21 方案A 后简化）
  // 用途：兼容旧数据——已无结构化 blocks 的 staged，从 whatHappened 文本按空行切 text 段落补上；
  //      新数据（方案A JSON）自带 blocks，跳过不动。
  if (event.action === 'rebuildBlocks') {
    let rebuilt = 0, failed = 0
    try {
      const res = await db.collection(INTEL_STAGED).limit(1000).get()
      for (const d of res.data || []) {
        const sop = (d && d.sop) || {}
        if (Array.isArray(sop.whatHappenedBlocks) && sop.whatHappenedBlocks.length) continue
        const raw = String(sop.whatHappened || '').trim()
        if (!raw) continue
        const paras = raw.split(/\n{2,}/).map(x => x.replace(/\*\*/g, '').trim()).filter(Boolean)
        const blocks = paras.length ? paras.map(p => ({ type: 'text', text: p })) : [{ type: 'text', text: raw }]
        try {
          await db.collection(INTEL_STAGED).doc(d._id).update({
            data: { sop: Object.assign({}, sop, { whatHappenedBlocks: blocks }) },
          })
          rebuilt++
        } catch (e) { failed++ }
      }
    } catch (e) {
      return { ok: false, reason: 'scan-fail:' + (e.message || e) }
    }
    return { ok: true, action: 'rebuildBlocks', rebuilt, failed }
  }

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

  // 2026-08-21 回退（owner 拍板）：移除「逐批只留本批」清理逻辑——
  //   该逻辑每次处理时移除旧中间数据，导致详情页查不到历史条目、数据被清空。
  //   详情数据已随 brief 自包含（intelDispatcher items 带完整 sop），staged 增量保留不清理。

  // 本批处理（P1 优化：>48h 的旧 pending 直接拒绝不进 LLM，防积压旧条白烧 token；
  //  P2 优化：同批内 2 条并发，300s 窗口吞吐×2）
  const STALE_PENDING_MS = 48 * 3600 * 1000
  const results = []
  for (let i = 0; i < todo.length; i += 2) {
    const chunk = todo.slice(i, i + 2)
    const rs = await Promise.all(chunk.map(async (item) => {
      if (item.fetchedAt) {
        const t = new Date(item.fetchedAt).getTime()
        if (!Number.isNaN(t) && Date.now() - t > STALE_PENDING_MS) {
          const id = String(item.guid || item.itemId || '')
          await markIngest(id, 'rejected', { reason: 'stale-pending(>48h)' })
          return { itemId: id, status: 'rejected', reason: 'stale-pending(>48h)' }
        }
      }
      return processOne(item, profile)
    }))
    results.push(...rs)
  }
  const okCount = results.filter((r) => r.status === 'ok').length

  // ④ 2026-08-19 owner 拍板：每源每批次质量打分（0-10，staged 占比 - 拒绝惩罚），
  //    低于 6 分自动停用该源（以后不再抓取）
  await scoreSourceQuality(todo, results)

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
