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
 *       也可由前端手动触发（event.force=true 忽略日期去重，调试用），
 *       或按单话题手动检索（event.itemId 精确检索当前用户某条关注，前端「立即检索最新进展」）。
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
function tavilySearch(query) {
  return new Promise((resolve) => {
    if (!TAVILY_API_KEY) return resolve({ ok: false, reason: 'no-tavily-key' })
    const body = JSON.stringify({
      api_key: TAVILY_API_KEY,
      query: String(query || '').slice(0, 200),
      max_results: 5,
      search_depth: 'basic',
      include_answer: false,
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
async function judgeAndSummarize(topicTitle, knownSummary, search) {
  const searchText = (search.sources || [])
    .map((s, i) => `${i + 1}. ${s.title} ${s.url}${s.snippet ? '\n   ' + s.snippet : ''}`).join('\n')
  const knownBlock = knownSummary
    ? `\n用户已知内容（关注该话题时的原文摘要，以下信息不算新进展）：\n${String(knownSummary).slice(0, 300)}`
    : ''
  const system = `你是「话题进展追踪器」。用户关注了一个话题，以下是今天联网检索到的最新结果。
请判断：检索结果中是否有【超出用户已知内容的新进展】（用户已关注过原事件，只对「之后又发生了什么」感兴趣）。
只输出 JSON：{"hasNew":true/false,"summary":"80-150字中文摘要，仅当hasNew=true时给出","sourcesCount":数字}
判定标准：
- hasNew=false：结果全部是用户已知内容的重复/背景介绍/旧闻/无关内容 → 不打扰用户
- hasNew=true：存在【已知内容未提及的新事实】——新发布、新动态、新结论、事件后续发展、新影响
- summary 只写【新进展部分】，复述已知内容的部分不要写；要具体：发生了什么、谁、何时、影响
- sourcesCount = 提供新进展信息的来源条数（1-5）
不要输出其它内容。`
  const user = `关注话题：${topicTitle}${knownBlock}
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
    // JSON 解析失败 → 尝试抽取 hasNew
    return { hasNew: /true/i.test(raw), summary: String(j.summary || raw).slice(0, 150), sourcesCount: 1 }
  }
}

/** 检索一个话题，返回 { hasNew, summary, sourcesCount } 或 null（失败） */
async function checkTopic(topic) {
  const query = `${topic.title} 最新进展 后续 更新`.slice(0, 200)
  let search = await tavilySearch(query)
  if (!search.ok) {
    const z = await zhipuWebSearch(query)
    if (z.ok) search = z
    else return { ok: false, reason: search.reason + '/' + (z && z.reason) }
  }
  const judge = await judgeAndSummarize(topic.title, topic.knownSummary || '', search)
  if (!judge) return { ok: false, reason: 'judge-fail' }
  return { ok: true, hasNew: judge.hasNew, summary: judge.summary, sourcesCount: judge.sourcesCount }
}

/** 拉取待检话题：活跃关注 + trackTime 到点 + 今天未检索（或 force） */
async function listDueTopics(force) {
  const today = todayStr()
  const res = await db.collection('follow_up')
    .where({ isActive: true })
    .limit(1000)
    .get()
  const all = res.data || []
  const now = Date.now()
  const due = []
  for (const d of all) {
    if (!d.itemId || !d.title) continue
    if (!force) {
      if (!trackDue(d.trackTime, now)) continue
      if (d.lastCheckedDate === today) continue // 今天已检索过
    }
    due.push(d)
    if (due.length >= MAX_BATCH) break
  }
  return due
}

/**
 * 单话题手动检索（前端「立即检索最新进展」入口）：
 * 按 openid + itemId 精确定位用户自己的关注，忽略 trackTime/日期去重（用户主动触发）。
 * @returns {Promise<Array>} 0 或 1 个 topic 文档
 */
async function findTopicByItemId(openid, itemId) {
  if (!openid || !itemId) return []
  const res = await db.collection('follow_up')
    .where({ _openid: openid, itemId: String(itemId), isActive: true })
    .limit(1)
    .get()
  return (res.data || []).slice(0, 1)
}

exports.main = async (event = {}) => {
  const startedAt = Date.now()
  const force = event.force === true
  const today = todayStr()
  const openid = cloud.getWXContext().OPENID

  try {
    let due
    if (event.itemId) {
      // 单话题手动检索：仅当前用户自己的关注（OPENID 隔离），忽略日期/时间去重
      if (!openid) {
        return { code: 0, data: { checked: 0, newUpdates: 0, message: 'no openid context' } }
      }
      due = await findTopicByItemId(openid, event.itemId)
      if (!due.length) {
        return { code: 0, data: { checked: 0, newUpdates: 0, message: 'topic not found or not followed' } }
      }
    } else {
      due = await listDueTopics(force)
    }
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
          await db.collection('follow_up').doc(topic._id).update({
            data: {
              updates: _.push([entry]),
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
