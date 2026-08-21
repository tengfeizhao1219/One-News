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
      whatHappenedBlocks: structureWhatHappened(parsed.whatHappened), // 2026-08-20 v5：结构化块（后端解析，前端不依赖文本分节）
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
      system: baseSystem + `\n对下面的单条情报做「轻量摘要」：
先输出「发生了什么」（**段落间用空行分隔**，总 180-320 字）：**严格基于情报原文客观转述发生了什么**——把原文的核心事实、关键数字、机制讲清楚，**像如实复述新闻本身**；**禁止出现「他/该公司/我们」「专业解读」「大白话」等介绍性口吻或标签字样**，不要以"我/我给你讲"的视角说话；结尾若确有未来影响可加一段——该段必须放在**所有正文段落之后**（最后一段），段首单独一行用「（AI 预测）：」作标记（该标记仅供程序识别，不要展开成正文文字）；**严禁把「（AI 预测）」放在第一段或正文段落开头**。**语言风格贴合内容**（技术→冷静专业/社区→轻松），句式多样化，避免八股腔。**禁止只写一句话、禁止写成一整段不换行。**
再输出一句话定义（含能力边界）。**必须用自然通顺的中文**：对英文源先翻译成中文，专有术语保留原文并在首次出现时括号注中文；输出英文句子视为不合格。
再输出「对老赵的意义」：**先判断关联性**——仅当与老赵初始化的行业/职位/关注议题**强相关且能具体点出关联点**时才写，结构清晰（第一行点明相关性，后续每行一个使用场景，关键处加粗）；弱相关输出「无」（前端隐藏），禁止强行关联凑数。${depth === 'lite' ? '（精简档，更短）' : ''}
再输出「可以怎么做」：给 1-2 句能落地的做法（工具/动作/收益），若无明显可做点输出「无」。
再输出「想试试」：**轻松引导语气（owner 拍板，非命令式）**——仅当本条存在一个现在就能上手尝试的具体功能/产品/新特性时，用「想体验的话，可以试试…」这类口吻给 1 条最轻步骤；否则输出「无」，禁止硬造。${depth === 'lite' ? '（精简档：可以怎么做/想试试各压到一句话）' : ''}
最后单独一行输出 JSON 供程序解析：{"titleCn":"中文标题（把本条标题翻译成自然通顺的中文）","sceneTags":["work_rcbc"|"product_onenews"|"life"],"tryable":true|false}`,
      user: `情报原文：\n${String(text || '').replace(/\uFFFD/g, '')}`,
    }
  }

  const system = baseSystem + depthHint + `

对下面单条情报按 SOP 六步硬性结构输出（欠一步即视为不合格）：
0. 发生了什么（最关键，结构要求见下）：**严格基于情报原文客观转述发生了什么**，把核心事实、关键数字、机制、背景讲清楚，像如实复述新闻本身；**禁止以介绍者视角说话**——不要出现「他/该公司做了…」「我们来看…」「专业解读」「大白话」等字样或口吻，不添加原文没有的观点。**段落之间必须用空行分隔**，总长 300-550 字：
   - 正文段落：按原文逻辑分 2-4 段客观陈述（谁、发生了什么、关键数据/机制/背景），术语保留原文，贴合内容性质选择语气（技术发布→冷静专业；行业动态→洞见；警示类→谨慎），句式多样化。
   - 结尾若确有未来影响：可加一段——放在**所有正文段落之后**（最后一段），段首单独一行「（AI 预测）：」标记（仅供程序识别，不展开成正文文字），用推测性措辞（"可能会…"），不要写成既成事实；**严禁把「（AI 预测）」放在第一段或正文段开头**。
1. 信息溯源：来源、发布时间、原文链接；来源存疑标「待验证」
2. 一句话定义：是什么 + 能做什么 + 能力边界，不夸大不堆参数（保持精简，供列表摘要用）。**必须用自然通顺的中文输出**：对英文源先翻译成中文，专有术语保留原文并在首次出现时括号注中文；输出英文句子视为不合格
3. 场景映射（落到你这里）：**先判断关联性**——仅当本条与老赵初始化的行业/职位/关注议题**强相关且能具体点出关联点**时才写；弱相关或无法具体关联时输出「无」（前端自动隐藏该区块），禁止强行关联凑数。**结构清晰**：第一行「相关性」用一句话点明关联点（关键概念用 **加粗** 强调）；接下来每行一条「使用场景/可以做的事」，用换行分隔，关键动作加粗。不要几句话揉成一团、不要无换行。
4. 可落地实操案例：工具 + 步骤 + 收益 + 坑点，老赵明天就能用
5. 想试试（**轻松引导语气，owner 2026-08-19 拍板**）：仅当本条存在一个老赵**现在就能上手尝试**的具体功能/产品/新特性（如新发布模型可直接调用、新工具可注册体验、新功能可在产品里打开）时，给 1 条可落地案例，用**朋友推荐般的轻松引导口吻**（如「想体验的话，可以试试…」「上手很顺手」「会更省事」），具体到「打开哪里 → 做什么 → 得到什么」；**禁止命令式措辞**——不得出现「本周X前」「必须」「请尽快」等催促/命令语气；若本条是行业动态/收购/融资/观点类新闻，或无明显可试点 → 输出「无」，禁止硬造尝试建议。

输出用如下固定 Markdown 模板（严格对齐，字段缺失视为失败）：
### [条目标题]
**发生了什么**：[科普向详细叙事，3-5 段，普通人都能懂，见步骤 0]
- **溯源**：[来源] · [发布时间] · [链接]
- **一句话**：[定义 + 能力边界]
- **对老赵的意义**：[仅强相关时写，否则「无」]
- **可以怎么做**：[工具 + 步骤 + 收益 + 坑点]
- **想试试**：[仅存在可立即上手的案例时写，否则「无」]
最后单独一行输出 JSON 供程序解析（务必严格 JSON）：
{"titleCn":"中文标题（把本条标题翻译成自然通顺的中文）","sceneTags":["work_rcbc"|"product_onenews"|"life"],"tryable":true|false}`
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

function parseSopOut(text, item, profile, route) {
  const t = String(text || '')
  let parsedTitleCn = ''

  /** 「无」/「无（…）」/空 → 归一为空串（弱相关不强行关联；想试试不可落地则留空） */
  function normNone(v) {
    const s = String(v || '').trim()
    if (!s) return ''
    if (/^无[。）)]?$/.test(s)) return ''
    if (/^（?无关联）?$/.test(s)) return ''
    return s
  }

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
  const jsonMatch = t.match(/^\s*\{[\s\S]*?\}\s*$/m) || (() => {
    // 容错（2026-08-21）：LLM 常把 JSON 混在正文里，搜全文含 titleCn 的最后一个 JSON 块
    const all = [...t.matchAll(/\{[\s\S]*?"titleCn"[\s\S]*?\}/g)]
    return all.length ? all[all.length - 1] : null
  })()
  if (jsonMatch) {
    try {
      const j = JSON.parse(jsonMatch[0])
      if (j && Array.isArray(j.sceneTags)) sceneTags.length = 0, sceneTags.push(...j.sceneTags.filter(Boolean))
      if (typeof j.tryable === 'boolean') tryable = j.tryable
      if (j && typeof j.titleCn === 'string' && j.titleCn.trim()) parsedTitleCn = j.titleCn.trim()
    } catch (e) { /* 解析失败则用正则兜底 */ }
  }
  if (!jsonMatch) {
    tryable = /tryable"?\s*:\s*true/i.test(t)
  }

  // 2026-08-20 修复：LLM（智谱 glm-4-flash）medium 路径常输出「一句话定义：\n正文」——旧正则 .{0,600}
  //   不跨行，冒号后紧跟 \n → 捕获空串 → definition-empty 误杀全部 medium 条目。改为跨行捕获，
  //   在「空行 或 下一个章节标签行（对老赵的意义/可以怎么做/想试试/最小行动/场景映射/溯源等）」处截断，
  //   避免吞掉后续章节内容（单行无空行场景同样安全）。
  // 2026-08-21：加强——章节标签允许被「」/()/*** 包裹（medium 自由文本常输出「可以怎么做」：），
  //   截断前瞻允许任意位置出现下一个章节标签（不要求行首/空行，兼容单行连写）。
  const sec = (re) => {
    const m = t.match(new RegExp(re + '\\s*(?:「|」|\\(|\\)|\\*)*\\s*[:：]([\\s\\S]{0,600}?)(?=\\n\\s*\\n|(?:再输出|最后输出)?\\s*[-*「」]*\\s*\\*{0,2}(?:对老赵的意义|可以怎么做|想试试|最小行动|场景映射|溯源|发生了什么|一句话|定义)\\s*(?:「|」|\\(|\\)|\\*)*\\s*[:：]|$)', 'i'))
    return m ? m[1].replace(/\n+/g, ' ').trim() : ''
  }
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
    return t2.slice(start, end).replace(/^[\s\n*-]+|[\s\n]+$/g, '').replace(/\n{3,}/g, '\n\n').trim() // 2026-08-20: 保留段落分隔(双换行)，不再压平成单段
  }
  // 发生了什么：优先取模板块（标题下第一块，至溯源前）；否则取「发生了什么:」到「对老赵的意义」/「定义」之前的文本
  const whatHappened =
    secBlock(/\*\*发生了什么\*\*\s*[:：]?\s*/, /[-*]\s*\*\*溯源\*\*/) ||
    secBlock(/发生了什么\s*[:：]/, /对老赵的意义|一句话|定义/) ||
    ''
  return {
    whatHappened,
    definition: sec('-?\\*\\*一句话定义\\*\\*') || sec('一句话定义') || sec('-?\\*\\*一句话\\*\\*') || sec('一句话') || sec('2\\)?[．.、]?\\s*一句话') || sec('定义'),
    // 「落到你这里」/「想试试」：仅强相关才产出；「无」归一为空（前端按空值隐藏区块，不强行关联）
    sceneMapping: normNone(sec('-?\\*\\*对老赵的意义\\*\\*') || sec('对老赵的意义') || sec('3\\)?[．.、]?\\s*场景映射')),
    practice: sec('-?\\*\\*可以怎么做\\*\\*') || sec('可以怎么做') || sec('4\\)?[．.、]?\\s*可落地实操'),
    minAction: normNone(sec('-?\\*\\*想试试\\*\\*') || sec('想试试') || sec('-?\\*\\*最小行动\\*\\*') || sec('最小行动') || sec('5\\)?[．.、]?\\s*今日/本周最小行动')),
    sceneTags: sceneTags.length ? sceneTags : (route.level === 'low' ? [] : ['life']),
    sceneHits,
    tryable,
    titleCn: parsedTitleCn, // 2026-08-20 修复：processOne 引用跨函数未定义变量 parsedTitleCn → 作为返回字段
    translated: true,
  }
}

/**
 * 2026-08-20 v5：whatHappened 结构化解析（后端侧，前端不依赖文本解析）。
 * 把「发生了什么」拆成结构化块：正文自然段落 + 大白话/AI 预测/定义（用标记段识别），
 * 避免 LLM 章节识别漂移导致前端拿不到分节。返回 [{ type:'text'|'plain'|'predict'|'def', text }]。
 */
function structureWhatHappened(raw) {
  raw = String(raw || '').trim()
  if (!raw) return []
  // 标记段识别（2026-08-21）：两种形式——
  //   A) **大白话** / **（AI 预测）** / **定义**：星号包裹（任意位置）
  //   B) 行首独立「（AI 预测）：」/「AI 预测：」（新 prompt 段落标记，供 UI 提示不显示文字）
  // 只匹配段落标记，不匹配正文中出现的"定义/预测"等普通词汇（B 形式要求行首）。
  // 实现：exec 迭代收集所有标记（位置+label），再按位置切分（避免 split 多捕获组错乱）。
  const SEP_RE = /\*\*\s*(?:（|\(|\s)*(大白话|AI\s*预测|预测|定义|一句话定义|大白话版|用大白话说)(?:\s|）|\)|\*)*\s*\*\*?\s*[:：]?\s*|(?:^|\n)\s*(?:（|\(|\[)?(AI\s*预测|大白话)(?:）|\)|\])?\s*[:：]?\s*/g
  const markers = []
  let mm
  while ((mm = SEP_RE.exec(raw)) !== null) {
    markers.push({ index: mm.index, label: (mm[1] || mm[2] || '').trim(), matchLen: mm[0].length })
    if (mm.index === SEP_RE.lastIndex) SEP_RE.lastIndex++
  }
  const blocks = []
  const pushText = (txt) => {
    const t = String(txt || '').replace(/\*\*/g, '').trim()
    if (!t) return
    blocks.push({ type: 'text', text: t })
  }
  // 开头正文：第一个标记前的文本，按换行拆自然段落
  const head = String(raw.slice(0, markers.length ? markers[0].index : raw.length)).trim()
  if (head) {
    const paras = head.split(/\n+\s*/).map(x => x.trim()).filter(Boolean)
    if (paras.length >= 2) paras.forEach(p => pushText(p))
    else pushText(head)
  }
  // 标记块：marker → 类型，内容 = 该标记到下一标记之间的文本（截断后续章节标记，清星号）
  for (let i = 0; i < markers.length; i++) {
    const label = markers[i].label
    // 内容起点：标记结束后的紧邻冒号（同一行内）；无冒号 → 标记匹配结束处。
    // 注意：不能全文找下一个冒号（会误定位到 JSON 输出里的冒号）。
    const markEnd = markers[i].index + markers[i].matchLen
    const afterMark = raw.slice(markEnd, Math.min(markEnd + 20, raw.length))
    const colonPos = afterMark.indexOf(':') >= 0 ? afterMark.indexOf(':') : afterMark.indexOf('：')
    const contentStart = colonPos >= 0 ? markEnd + colonPos + 1 : markEnd
    // 用 next 标记位置作为内容终点
    const end = i + 1 < markers.length ? markers[i + 1].index : raw.length
    let content = String(raw.slice(contentStart, end) || '').trim()
    // 截断：后续章节标记 / JSON 输出起始（LLM 定义段后常直接跟 {"titleCn"...}） / 空行
    const cut = content.search(/\*{1,2}(?:对老赵的意义|可以怎么做|想试试|最小行动|场景映射|溯源|发生了什么)\s*\*{0,2}\s*[:：]?|\n\s*\n|\n\s*\{["\\']/)
    if (cut >= 0) content = content.slice(0, cut).trim()
    content = content.replace(/\*\*/g, '').trim()
    if (content) {
      let type = 'text'
      if (/大白话|用大白话说/.test(label)) type = 'plain'
      else if (/AI\s*预测|预测/.test(label)) type = 'predict'
      else if (/定义/.test(label)) type = 'def'
      blocks.push({ type, text: content })
    }
  }
  // 2026-08-21 兜底：AI 预测块必须位于最后一段才保留 predict 样式，
  // 否则降级为普通正文（LLM 曾把「（AI 预测）」误标在正文第一段开头 → 整段正文被误判）
  if (blocks.length > 1) {
    const lastIdx = blocks.length - 1
    for (let i = 0; i < lastIdx; i++) {
      if (blocks[i].type === 'predict') blocks[i].type = 'text'
    }
  }
  // 无任何标记 → 退回纯段落（按换行/句号兜底分段）
  if (blocks.length <= 1) {
    const byNewline = raw.split(/\n+\s*/).map(x => x.trim().replace(/\*\*/g, '')).filter(Boolean)
    if (byNewline.length >= 2) return byNewline.map(t => ({ type: 'text', text: t }))
    const parts2 = raw.split(/(?<=[。！？；])\s*/).map(x => x.trim()).filter(Boolean)
    const merged = []
    let cur = ''
    for (const p of parts2) {
      cur = (cur ? cur + ' ' : '') + p
      if (cur.length >= 40) { merged.push(cur); cur = '' }
    }
    if (cur) merged.push(cur)
    return (merged.length >= 2 ? merged : [raw]).map(t => ({ type: 'text', text: t }))
  }
  return blocks
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
