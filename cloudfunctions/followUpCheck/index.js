/**
 * followUpCheck 云函数 — 「关注后续」每日 AI 定时检索（§九 后端核心）
 * ============================================================
 * 功能：每天按用户设定的追踪时间（trackTime: 08:00/12:00/18:00/21:00），
 *       对每个「关注话题」联网检索最新进展，AI 判断是否有实质新内容：
 *         · 有 → 生成 update { date, summary, sourcesCount } 写入 follow_up 集合
 *                （前端「我的关注」拉取后显示红色「N 条新更新」）
 *         · 无 → 仅记录 lastCheckedDate（当天不再重复检索；不产生空更新，
 *                遵守 intel「有则汇报、无则不打扰」约定）
 *
 * 触发：定时器每天 08/12/18/21 四档（config.json triggers）；
 *       每档触发时，仅处理 trackTime 已到点 且 当天未检索 的话题（防重复/控成本）。
 *       event.force=true 忽略日期去重（仅调试用）。
 * owner 2026-09-08 调整：①移除「立即检索」单话题手动模式（前端入口已下线，检索只走每日定时档）；
 *       ②待检话题分页扫描（修复单次 1000 条上限截断漏检）；
 *       ③AI 判新兜底只认显式 "hasNew":true/false（修复 JSON 解析失败时 /true/i 误判
 *         以及 catch 作用域引用 j 导致 ReferenceError 炸掉整次运行的问题）。
 *
 * 检索链（复用 intelSearch 已验证的通道）：
 *   ① Tavily 搜索：「话题标题 + 最新进展/更新」（主通道）
 *   ② 智谱 GLM web_search（Tavily 失败兜底）
 *   ③ DeepSeek 判断相关性/新进展 + 生成 80-150 字摘要 + 统计来源数
 *
 * 成本控制：
 *   - 每天每话题最多检索 1 次（lastCheckedDate == 今天 → 跳过）
 *   - 单次运行预算：BATCH 上限 + 总耗时保护（timeout 120s）
 *   - 搜索/摘要 LLM 失败 → 记录 lastCheckedAt 但不写 updates（次日重试）
 *
 * 依赖 env：TAVILY_API_KEY / DEEPSEEK_API_KEY / ZHIPU_API_KEY（可选兜底）
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const https = require('https')

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''
const TAVILY_BASE = 'api.tavily.com'
const TAVILY_TIMEOUT = 10000

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = 'api.deepseek.com'
const DEEPSEEK_PATH = '/v1/chat/completions'
const DEEPSEEK_TIMEOUT = 15000

const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || ''
const ZHIPU_BASE = 'open.bigmodel.cn'
const ZHIPU_PATH = '/api/paas/v4/chat/completions'
const ZHIPU_MODEL = 'glm-4-flash'
const ZHIPU_TIMEOUT = 15000

const MAX_BATCH = 30            // 单次运行最多处理话题数（防超时）
const RUN_DEADLINE_MS = 90000   // 单次运行预算（config timeout 120s 内留余量）
const MAX_RETRY_SAME_DAY = 1    // 同天 LLM/搜索失败重试次数（随后续定时档）
const UPDATES_MAX_KEEP = 20     // 云端 updates 保留上限（旧更新裁剪，防数组无限膨胀）

// ─── 北京时间工具（SCF 环境是 UTC，需显式转北京）───
function beijingParts(ts) {
  const d = new Date((ts || Date.now()) + 8 * 3600 * 1000)
  const hh = ('0' + d.getUTCHours()).slice(-2)
  const mi = ('0' + d.getUTCMinutes()).slice(-2)
  return {
    date: d.toISOString().slice(0, 10), // YYYY-MM-DD（北京）
    datetime: d.toISOString().slice(0, 10) + ' ' + hh + ':' + mi, // YYYY-MM-DD HH:MM（北京，带时分）
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  }
}

/** 今天（北京）YYYY-MM-DD */
function todayStr() {
  return beijingParts(Date.now()).date
}

/** trackTime "HH:MM" 是否已到点（北京） */
function trackDue(hhmm, now) {
  if (!hhmm) return false
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim())
  if (!m) return false
  const h = Number(m[1])
  const min = Number(m[2])
  const bj = beijingParts(now)
  return bj.hour > h || (bj.hour === h && bj.minute >= min)
}

// ─── ① Tavily 搜索（主通道）───
function tavilySearch(query, days) {
  return new Promise((resolve) => {
    if (!TAVILY_API_KEY) return resolve({ ok: false, reason: 'no-tavily-key' })
    const body = JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: String(query || '').slice(0, 200),
      max_results: 5,
      search_depth: 'basic',
      include_answer: false,
      // 时间限定（owner 2026-09-03）：只搜近期（默认 14 天），过滤旧闻——
      // 关注页此前反复推送 2025 年 12 月旧闻，根因之一是搜索不限时间窗。
      days: (typeof days === 'number' && days > 0) ? days : 14,
    })
    const req = https.request({
      hostname: TAVILY_BASE,
      path: '/search',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: TAVILY_TIMEOUT,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const results = Array.isArray(data.results) ? data.results : []
          if (!results.length) return resolve({ ok: false, reason: 'tavily-empty:' + (data.error || 'no-results') })
          const sources = results.filter(x => x && x.url).map(x => ({
            title: String(x.title || '').slice(0, 120),
            url: String(x.url || ''),
            snippet: String(x.content || '').replace(/\s+/g, ' ').slice(0, 300),
          }))
          resolve({ ok: true, sources })
        } catch (e) {
          resolve({ ok: false, reason: 'tavily-parse:' + e.message })
        }
      })
      res.on('error', () => resolve({ ok: false, reason: 'tavily-net' }))
    })
    req.on('error', () => resolve({ ok: false, reason: 'tavily-req' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'tavily-timeout' }) })
    req.write(body)
    req.end()
  })
}

// ─── ② 智谱 web_search（兜底）───
function zhipuWebSearch(query) {
  return new Promise((resolve) => {
    if (!ZHIPU_API_KEY) return resolve({ ok: false, reason: 'no-zhipu-key' })
    const body = JSON.stringify({
      model: ZHIPU_MODEL,
      messages: [
        { role: 'system', content: '你是联网搜索助手。使用 web_search 工具搜索与用户问题相关的信息，基于搜索结果回答，并列出引用的来源链接（真实 URL）。' },
        { role: 'user', content: query },
      ],
      tools: [{ type: 'web_search', web_search: { enable: true, search_mode: 'auto' } }],
      temperature: 0.3,
      max_tokens: 1200,
    })
    const req = https.request({
      hostname: ZHIPU_BASE,
      path: ZHIPU_PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ZHIPU_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: ZHIPU_TIMEOUT,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const msg = data.choices && data.choices[0] && data.choices[0].message
          if (!msg) return resolve({ ok: false, reason: 'empty-response' })
          const answer = String(msg.content || '').trim()
          const rawRefs = (msg.web_search && msg.web_search.search_result)
            || (msg.search_result) || (data.search_result) || []
          const sources = []
          if (Array.isArray(rawRefs) && rawRefs.length) {
            rawRefs.filter(x => x && (x.link || x.url)).forEach(x => {
              const url = String(x.link || x.url || '')
              if (url) sources.push({ title: String(x.title || '').slice(0, 120), url })
            })
          }
          const noSearch = /无法.*(?:实时)?(?:网络)?搜索|不能.*搜索|知识(?:截止|更新).*(?:2023|2024)/i.test(answer)
          resolve(noSearch ? { ok: false, reason: 'zhipu-no-search' } : { ok: true, answer, sources })
        } catch (e) {
          resolve({ ok: false, reason: 'parse-fail:' + e.message })
        }
      })
      res.on('error', () => resolve({ ok: false, reason: 'net-error' }))
    })
    req.on('error', () => resolve({ ok: false, reason: 'req-error' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'timeout' }) })
    req.write(body)
    req.end()
  })
}

// ─── ③ DeepSeek 摘要 + 新进展判断 ───
function deepseekChat(systemPrompt, user, { maxTokens = 500, temperature = 0.3 } = {}) {
  return new Promise((resolve) => {
    if (!DEEPSEEK_KEY) return resolve(null)
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      temperature,
    })
    const req = https.request({
      hostname: DEEPSEEK_BASE,
      path: DEEPSEEK_PATH,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${DEEPSEEK_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: DEEPSEEK_TIMEOUT,
    }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          const txt = data.choices && data.choices[0] && data.choices[0].message
            ? String(data.choices[0].message.content || '').trim() : ''
          resolve(txt ? { text: txt } : null)
        } catch (e) { resolve(null) }
      })
      res.on('error', () => resolve(null))
    })
    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.write(body)
    req.end()
  })
}

/**
 * 判断搜索结果是否有「实质性新进展」并生成摘要。
 * @returns {Promise<{hasNew:boolean, summary:string, sourcesCount:number}|null>} null=LLM 失败
 */
async function judgeAndSummarize(topicTitle, knownSummary, historyUpdates, search) {
  const searchText = (search.sources || [])
    .map((s, i) => `${i + 1}. ${s.title} ${s.url}${s.snippet ? '\n   ' + s.snippet : ''}`).join('\n')
  const knownBlock = knownSummary
    ? `\n用户已知内容（关注该话题时的原文摘要，以下信息不算新进展）：\n${String(knownSummary).slice(0, 300)}`
    : ''
  const histBlock = (Array.isArray(historyUpdates) && historyUpdates.length)
    ? `\n用户历史已收到的进展推送（以下内容用户已看过，重复不算新进展）：\n${historyUpdates.map((h, i) => `${i + 1}. ${String(h.summary || '').slice(0, 200)}`).join('\n')}`
    : ''
  const system = `你是「话题进展追踪器」。用户关注了一个话题，以下是今天联网检索到的最新结果。
请判断：检索结果中是否有【超出用户已知内容 + 历史推送的新进展】（用户已关注过原事件、已收到过若干进展推送，只对「还没看过的、更晚发生的新事实」感兴趣）。
只输出 JSON：{"hasNew":true/false,"summary":"80-150字中文摘要，仅当hasNew=true时给出","sourcesCount":数字}
判定标准：
- hasNew=false：结果全部是 已知内容/历史推送 的重复、背景介绍、旧闻、无关内容 → 不打扰用户
- hasNew=true：存在【已知内容与历史推送都未提及的新事实】——时间上更晚的事件后续、新发布、新动态、新结论
- ⚠️ 特别警惕：若搜索结果描述的事件日期/内容与历史推送几乎相同（如同一场会晤、同一批宣布），即使措辞不同也算重复 → hasNew=false
- summary 只写【真正的新进展部分】，绝不复述已知/历史内容；要具体：发生了什么、谁、何时、影响
- sourcesCount = 提供新进展信息的来源条数（1-5）
不要输出其它内容。`
  const user = `关注话题：${topicTitle}${knownBlock}${histBlock}
联网搜索结果：
${searchText || '（无结构化结果）'}
搜索结果回答：${search.answer || ''}
请判断并输出 JSON。`
  const r = await deepseekChat(system, user, { maxTokens: 300, temperature: 0.2 })
  if (!r || !r.text) return null
  const raw = r.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const j = JSON.parse(raw)
    return {
      hasNew: j.hasNew === true,
      summary: String(j.summary || '').trim(),
      sourcesCount: Math.min(5, Math.max(1, Number(j.sourcesCount) || 1)),
    }
  } catch (e) {
    // owner 2026-09-08 修复：解析失败兜底两处问题——
    // ① 旧代码在此引用 try 作用域的 j → ReferenceError 会向上炸掉整次运行；
    // ② /true/i 全文匹配太宽松（正文出现 true 即误判 hasNew）。
    // 现在只认显式 "hasNew":true/false；true 还需能抽出 summary，否则按失败处理（下档重试）。
    if (/"hasNew"\s*:\s*false/i.test(raw)) return { hasNew: false, summary: '', sourcesCount: 1 }
    if (/"hasNew"\s*:\s*true/i.test(raw)) {
      const sm = raw.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/)
      if (sm && sm[1]) return { hasNew: true, summary: sm[1].slice(0, 300), sourcesCount: 1 }
    }
    return null
  }
}

/** 检索一个话题，返回 { hasNew, summary, sourcesCount } 或 null（失败） */
async function checkTopic(topic) {
  const title = topic.title || ''
  const known = topic.knownSummary || ''
  // 历史更新（已推送摘要）作为判重基线：与已知内容/历史重复 → hasNew=false
  const historyUpdates = Array.isArray(topic.updates) ? topic.updates.slice(0, 5) : []

  // ① 生成精确检索词：LLM 基于话题标题+已知内容，产出 2-4 个锁定话题本身的检索词。
  //    避免「标题 + 最新进展」的泛搜（易带回旧闻/他话题内容）。
  let queries = await buildTopicQueries(title, known)
  if (!queries || !queries.length) {
    // 兜底：LLM 失败时退回单标题检索（保证话题总能被检）
    queries = [`${title} 最新进展`]
  }

  // ② 多路搜索：每个检索词独立 Tavily（近 14 天），合并去重。
  const seenUrls = new Set()
  const allSources = []
  for (const q of queries) {
    let s = await tavilySearch(q, 14)
    if (!s.ok) {
      const z = await zhipuWebSearch(q)
      if (z.ok) s = z
      else continue // 单路失败不影响其它路
    }
    for (const src of (s.sources || [])) {
      if (src.url && !seenUrls.has(src.url)) {
        seenUrls.add(src.url)
        allSources.push(src)
      }
    }
  }
  if (!allSources.length) return { ok: false, reason: 'search-empty:' + queries.join('|') }

  console.log(`[followUpCheck] 话题「${title.slice(0, 20)}」检索词=${JSON.stringify(queries)} 命中来源=${allSources.length} 条`)
  const search = { sources: allSources, answer: '' }
  const judge = await judgeAndSummarize(title, known, historyUpdates, search)
  if (!judge) return { ok: false, reason: 'judge-fail' }
  return { ok: true, hasNew: judge.hasNew, summary: judge.summary, sourcesCount: judge.sourcesCount }
}

/**
 * 生成锁定话题的精确检索词（owner 2026-09-03 颗粒度细化）。
 * 输入：话题标题 + 关注时已知内容（原文摘要）。
 * 输出：2-4 个检索词（含话题核心实体 + 事件方向 + 后续/进展意图），
 *       每个都必须锚定「这个话题本身」，禁止泛化到无关话题。
 * @returns {Promise<string[]|null>} 检索词数组；LLM 失败返回 null（调用方走单标题兜底）
 */
async function buildTopicQueries(topicTitle, knownSummary) {
  const knownBlock = knownSummary
    ? `\n话题已知内容（背景，用于理解话题具体指什么，不要把它本身当搜索词）：\n${String(knownSummary).slice(0, 250)}`
    : ''
  const system = `你是「精确搜索词构造器」。给定一个用户关注的话题（可能是一条新闻标题），请构造 2-4 个
适合联网搜索的检索词，用于追踪该话题的【后续进展/最新更新】。
要求：
- 每个检索词都必须锚定该话题的核心主体与事件，不允许泛化（例：话题是"普京会晤莫迪"，可扩出
  "俄印峰会""莫迪 普京 新德里 会晤"，但绝不能扩成"普京"或"印度外交"这种无主体约束的词）。
- 检索词要体现"追踪后续/进展/更新"的意图，可以带具体方向词（声明/结果/后续/回应/最新）但必须以话题实体收束。
- 每个检索词 10-30 字，中文为主；最多 4 个。
只输出 JSON 数组：["检索词1","检索词2"]，不要输出其它内容。`
  const user = `关注话题标题：${topicTitle}${knownBlock}
请给出追踪该话题后续进展的检索词。`
  const r = await deepseekChat(system, user, { maxTokens: 200, temperature: 0.3 })
  if (!r || !r.text) return null
  const raw = r.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const arr = JSON.parse(raw)
    const list = (Array.isArray(arr) ? arr : []).map(String).filter(s => s && s.length >= 4 && s.length <= 60)
    if (!list.length) return null
    return list.slice(0, 4)
  } catch (e) {
    // 解析失败：尝试按行/逗号切
    const fallback = raw.split(/[\n,，]/).map(s => s.replace(/^\s*[\d.)、-]+\s*/, '').trim()).filter(s => s && s.length >= 4 && s.length <= 60 && !s.startsWith('[') && !s.endsWith(']'))
    return fallback.length ? fallback.slice(0, 4) : null
  }
}

/** 拉取待检话题：活跃关注 + trackTime 到点 + 今天未检索（或 force）。
 *  owner 2026-09-08：改为分页扫描（每页 100，直到批次满或扫完全集）——
 *  修复旧实现单次 .limit(1000) 在活跃关注超 1000 时静默截断漏检的问题。 */
async function listDueTopics(force) {
  const today = todayStr()
  const now = Date.now()
  const due = []
  const PAGE = 100
  let skip = 0
  let exhausted = false
  while (!exhausted && due.length < MAX_BATCH) {
    const res = await db.collection('follow_up')
      .where({ isActive: true })
      .skip(skip)
      .limit(PAGE)
      .get()
    const all = res.data || []
    if (all.length < PAGE) exhausted = true
    skip += all.length
    for (const d of all) {
      if (!d.itemId || !d.title) continue
      if (!force) {
        if (!trackDue(d.trackTime, now)) continue
        if (d.lastCheckedDate === today) continue // 今天已检索过
      }
      due.push(d)
      if (due.length >= MAX_BATCH) break
    }
  }
  return due
}

exports.main = async (event = {}) => {
  const startedAt = Date.now()
  const force = event.force === true
  const today = todayStr()

  try {
    // owner 2026-09-08：移除 event.itemId 单话题手动检索模式——
    // 「立即检索」前端入口已下线，检索只能走每日定时档（成本可控，避免无节流直打 Tavily/DeepSeek）。
    const due = await listDueTopics(force)
    if (!due.length) {
      return { code: 0, data: { checked: 0, skipped: 0, newUpdates: 0, message: 'no due topics' } }
    }

    let checked = 0
    let newUpdates = 0
    let failed = 0
    const results = []

    for (const topic of due) {
      if (Date.now() - startedAt > RUN_DEADLINE_MS) {
        results.push({ itemId: topic.itemId, skipped: true, reason: 'deadline' })
        break
      }
      const r = await checkTopic(topic)
      checked++
      if (r && r.ok && r.hasNew) {
        const entry = {
          date: beijingParts().datetime,  // 2026-08-31: 带时分（关注列表显示具体时间）
          summary: String(r.summary || '').slice(0, 300),
          sourcesCount: r.sourcesCount || 1,
          read: false,
          checkedAt: Date.now(),
        }
        try {
          // updates 追加 + 上限裁剪（保留最新 UPDATES_MAX_KEEP 条，防数组无限膨胀）
          const cur = topic.updates || []
          const next = [entry].concat(cur).slice(0, UPDATES_MAX_KEEP)
          await db.collection('follow_up').doc(topic._id).update({
            data: {
              updates: next,
              lastCheckedDate: today,
              lastCheckedTime: Date.now(),
              lastResult: 'new',
            },
          })
          newUpdates++
          results.push({ itemId: topic.itemId, status: 'new', summary: entry.summary.slice(0, 60) })
        } catch (e) {
          failed++
          results.push({ itemId: topic.itemId, status: 'write-fail', reason: e.message })
        }
      } else if (r && r.ok) {
        // 无新进展：只记检索时间（不产生空更新）
        try {
          await db.collection('follow_up').doc(topic._id).update({
            data: { lastCheckedDate: today, lastCheckedTime: Date.now(), lastResult: 'none' },
          })
          results.push({ itemId: topic.itemId, status: 'none' })
        } catch (e) {
          failed++
          results.push({ itemId: topic.itemId, status: 'write-fail', reason: e.message })
        }
      } else {
        // 检索失败：记录失败次数（不记 lastCheckedDate → 次日/下档可重试）
        failed++
        const retry = (Number(topic.checkFailCount) || 0) + 1
        await db.collection('follow_up').doc(topic._id).update({
          data: { checkFailCount: retry, lastFailReason: (r && r.reason) || 'unknown' },
        }).catch(() => {})
        results.push({ itemId: topic.itemId, status: 'fail', reason: (r && r.reason) || 'unknown' })
      }
    }

    return {
      code: 0,
      data: {
        checked,
        newUpdates,
        failed,
        results,
        durationMs: Date.now() - startedAt,
      },
    }
  } catch (err) {
    console.error('[followUpCheck] 异常:', err && err.message)
    return { code: -1, message: '检索失败: ' + (err && err.message) }
  }
}
