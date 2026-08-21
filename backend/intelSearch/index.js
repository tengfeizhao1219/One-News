// intelSearch —— AI 情报官 · 详情页话题搜索（owner 2026-08-21 拍板）
// ============================================================
// 能力：详情页搜索入口，用户输入话题后：
//   ① 相关性判断（宽泛：AI 相关 / 与当前新闻主题相关）→ 不相关返回友好提示
//   ② 智谱 GLM web_search 联网搜索
//   ③ 总结回答（腾讯混元为主，智谱备选）
//   ④ 返回 answer + sources（引用来源列表）
//
// 接口契约见 intel-docs/情报详情页话题搜索_技术设计.md（与前端对齐的唯一契约）。
//
// 依赖：
//   - common/intelLLM（混元/智谱 chat，用于相关性判断与总结）
//   - process.env.ZHIPU_API_KEY（智谱 web_search，需在函数 env 配置，与 refreshNews 同 key）
// ============================================================
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const https = require('https')
const { intelChat } = require('../common/intelLLM')
const { ensureSchema } = require('../common/ensureSchema')

// ─── DeepSeek 直连（2026-08-21：judge/summarize 主用，1-2s，绕过混元/智谱慢链）───
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || ''
const DEEPSEEK_BASE = 'api.deepseek.com'
const DEEPSEEK_PATH = '/v1/chat/completions'
const DEEPSEEK_MODEL = 'deepseek-chat'
const DEEPSEEK_TIMEOUT = 15000

// ─── Tavily 搜索（2026-08-21 主搜索通道：1-3s，专为 LLM 设计）───
const TAVILY_API_KEY = process.env.TAVILY_API_KEY || ''
const TAVILY_BASE = 'api.tavily.com'
const TAVILY_TIMEOUT = 10000

// ─── 智谱 web_search 配置（兜底，复用 refreshNews/zhipuSearch 范式）────────
const ZHIPU_API_KEY = process.env.ZHIPU_API_KEY || ''
const ZHIPU_BASE = 'open.bigmodel.cn'
const ZHIPU_PATH = '/api/paas/v4/chat/completions'
const ZHIPU_MODEL = 'glm-4-flash'
const ZHIPU_TIMEOUT = 20000

// ─── 当前新闻读取（与 intelGetDetail 同源：staged → brief items）────
async function loadNews(itemId) {
  // 1) staged
  try {
    const r = await db.collection('intel_staged').where({ itemId }).limit(1).get()
    if (r.data && r.data[0]) return r.data[0]
  } catch (e) { /* 继续 */ }
  // 2) brief items（自包含 sop）
  try {
    const cur = await db.collection('intel_current').where({ isCurrent: true }).limit(1).get()
    if (cur.data && cur.data[0]) {
      const hit = (cur.data[0].items || []).find(it => it && it.itemId === itemId)
      if (hit) return hit
    }
  } catch (e) { /* 继续 */ }
  return null
}

/** 提取新闻上下文（标题 + 发生了什么 + 定义） */
function newsContext(news) {
  const sop = (news && news.sop) || {}
  const src = sop.source || {}
  const title = news.title || ''
  const what = String(sop.whatHappened || '').replace(/\*\*/g, '').slice(0, 400)
  const def = String(sop.definition || '').slice(0, 150)
  return { title, what, def, srcName: src.name || news.sourceId || '' }
}

// ─── ① 相关性判断（宽泛）──────────────
/** AI 相关关键词（快路径预判）：命中直接判相关，避免每次走 LLM（慢/不稳定） */
const AI_KEYWORDS = [
  'AI', '人工智能', '大模型', '模型', 'GPT', 'GLM', 'LLM', 'DeepSeek', '智谱', 'OpenAI', 'Anthropic',
  'Claude', 'Gemini', 'Qwen', '通义', '文心', '豆包', 'Kimi', 'MiniMax', '混元', '机器学习', '深度学习',
  '神经网络', '算法', '算力', 'GPU', '数据', '训练', '推理', 'Agent', '智能体', 'RAG', 'Prompt', '提示词',
  '开源', '编程', '代码', '软件', '开发者', '工具', '应用', '行业', '技术', '芯片', '语义', '生成', '多模态',
  '大模型', '聊天机器人', 'Copilot', 'AI编程', '自动化', '机器学习',
  // 2026-08-21：技术/编程/开发类也判相关（与 AI 新闻主题强关联：Bun/Node/框架/API 等）
  '编程语言', '运行时', '框架', '开发', '前端', '后端', 'API', 'SDK', '开源项目', '程序员',
  'Bun', 'Node', 'Python', 'JavaScript', 'TypeScript', 'Java', 'Go', 'Rust', '数据库',
  '编译器', '测试', '部署', '云服务', '产品', '发布', '更新', '版本', '教程', '指南',
  'Web', '应用', '平台', '工具链', '性能', '安全', '隐私', '芯片', '硬件', '机器人',
]
function quickRelevance(query) {
  const q = String(query || '').toLowerCase()
  // 明确无关词（排除误判）
  const irrelevantWords = ['房价', '股票', '美食', '旅游', '八卦', '娱乐', '体育', '足球', '篮球', '育儿', '装修', '相亲', '购物']
  if (irrelevantWords.some(w => q.includes(w))) return null // 需 LLM 确认
  if (AI_KEYWORDS.some(k => q.includes(k.toLowerCase()))) return true
  return null // 未命中 → 交 LLM
}

/** DeepSeek 直连 chat（OpenAI 兼容，1-2s，绕过混元前置慢链） */
function deepseekChat(systemPrompt, user, { maxTokens = 500, temperature = 0.3 } = {}) {
  return new Promise((resolve) => {
    if (!DEEPSEEK_KEY) return resolve(null)
    const body = JSON.stringify({
      model: DEEPSEEK_MODEL,
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
          resolve(txt ? { text: txt, engine: 'DeepSeek' } : null)
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

async function judgeRelevance(query, ctx) {
  // 快路径：AI 关键词命中直接相关（省 LLM 调用，稳定）
  const quick = quickRelevance(query)
  if (quick === true) return { relevant: true, reason: 'AI 相关话题' }
  const system = `你是情报相关性判断器。判断用户搜索的话题是否与 AI 相关，或与给定新闻的主题相关（宽泛标准）。
判断规则（满足任一即可判相关）：
1. 话题属于 AI 相关（AI 技术/模型/产品/行业/应用/工具/论文/公司动态等）
2. 话题与新闻主题相关（技术上下游、行业影响、同类对比、背景延伸等）
只有完全不相关的（如房价、美食、娱乐八卦等与 AI 和新闻都无关的）才判不相关。
只输出 JSON：{"relevant": true|false, "reason": "一句话理由"}，不要输出其它内容。`
  const user = `当前新闻：${ctx.title}
新闻内容摘要：${ctx.what}
用户搜索话题：${query}`
  const r = await intelChat({ systemPrompt: system, user, minAccept: 10, maxTokens: 100, temperature: 0, tag: 'intelSearch-judge' })
  console.log('[intelSearch][judge] r=', JSON.stringify(r))
  if (!r || !r.text) return { relevant: true, reason: '', _debug: 'LLM-null' }
  // 2026-08-21 修复：LLM 常输出 ```json 包裹 → JSON.parse 失败；先剥代码块再解析
  const rawText = r.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
  try {
    const j = JSON.parse(rawText)
    return { relevant: j.relevant !== false, reason: j.reason || '' }
  } catch (e) {
    // 解析失败：保守放行（无法确认不相关就允许搜索），避免误拦 AI 相关话题
    return { relevant: true, reason: '' }
  }
}

// ─── ② Tavily 联网搜索（主通道，2026-08-21）────────
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
            source: '',
            snippet: String(x.content || '').replace(/\s+/g, ' ').slice(0, 300),
          }))
          resolve({ ok: true, answer: '', sources })
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

// ─── ②b 智谱 web_search 联网搜索（兜底）────────
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
      max_tokens: 2000,
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
          // 引用来源：智谱 GLM web_search 的引用内嵌在回答的 Markdown 链接里（[title](url)），
          //   从 answer 提取；另兼容 search_result 数组（若未来返回结构变化）
          const rawRefs = (msg.web_search && msg.web_search.search_result)
            || (msg.search_result)
            || (data.search_result)
            || (data.web_search && data.web_search.search_result)
            || []
          const sources = []
          if (Array.isArray(rawRefs) && rawRefs.length) {
            rawRefs.filter(x => x && (x.link || x.url)).forEach(x => {
              const url = String(x.link || x.url || '')
              if (url) sources.push({ title: String(x.title || '').slice(0, 120), url, source: String(x.source || x.site_name || '').slice(0, 60) })
            })
          }
          // Markdown 链接提取兜底：[title](url)
          const mdRe = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
          let mm
          while ((mm = mdRe.exec(answer)) !== null) {
            const title = mm[1].replace(/\*+/g, '').trim()
            const url = mm[2].split(/[)\s]/)[0]
            if (url && !sources.some(x => x.url === url)) {
              sources.push({ title: title.slice(0, 120), url, source: '' })
            }
            if (sources.length >= 8) break
          }
          // 检测智谱"未真正联网"的兜底回答（web_search 偶发不触发搜索）
          const noSearch = /无法.*(?:实时)?(?:网络)?搜索|不能.*搜索|知识(?:截止|更新).*(?:2023|2024)|无法访问互联网|太过宽泛|太宽泛|没有具体指向|不够具体/i.test(answer)
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

// ─── ②c 搜索词改写（2026-08-21：模糊 query 结合新闻主题，避免搜出无关结果）───
//   例：新闻=DeepSeek 发布，query="和其他的有什么区别"
//   → 改写为 "DeepSeek 与其他大模型（GPT-4/Claude/Gemini）的区别对比"
async function buildSearchQuery(query, ctx) {
  // 区别/对比/优缺点类 → 必须 LLM 改写（拼接会产生"标题+和其他的区别"这种半截句）
  const needsRewrite = /(?:区别|对比|优缺点|优势|劣势|怎么样|如何|怎么|哪些|和其他的|和.*比|比较)/i.test(query)
  if (!needsRewrite && /(?:是什么|介绍|最新|发布|影响|发展|趋势|原理|用法|教程|使用|案例|性能|价格|下载|安装)/i.test(query) && ctx.title) {
    // 含主体的明确 query → 拼接新闻主体增强（省一次 LLM）
    const subject = String(ctx.title || '').replace(/\s+/g, ' ').slice(0, 40)
    return `${subject} ${query}`
  }
  // 残缺/对比类 query（"和其他的有什么区别""这个怎么样"）→ LLM 改写
  const system = `你是搜索词优化器。用户想了解某条新闻的进一步信息，输入了搜索意图（可能很简短或残缺）。
结合「当前新闻」把用户意图改写成一个具体、完整、适合搜索引擎的搜索词（10-25 个字），
必须包含新闻主体，让搜索引擎能搜到真正相关的内容。
只输出改写后的搜索词，不要解释。`
  const user = `当前新闻：${ctx.title}
新闻摘要：${ctx.what}
用户搜索意图：${query}
改写后的搜索词：`
  const r = await deepseekChat(system, user, { maxTokens: 60, temperature: 0.3 })
  const rewritten = r && r.text ? r.text.replace(/["'\n\r]+/g, '').trim() : ''
  if (rewritten && rewritten.length >= 6 && rewritten.length <= 60) return rewritten
  // LLM 失败 → 用新闻标题拼接兜底
  return `${String(ctx.title || '').replace(/\s+/g, ' ').slice(0, 40)} ${query}`
}

// ─── ③ 总结回答（DeepSeek 为主）───
async function summarize(query, ctx, search) {
  const searchText = (search.sources || [])
    .map((s, i) => `${i + 1}. ${s.title} ${s.url}${s.snippet ? '\n   ' + s.snippet : ''}`).join('\n')
  const system = `你是 AI 情报官，基于联网搜索结果回答用户关于「${query}」的进一步了解需求。
要求：
- 客观、基于搜索结果与当前新闻，不编造事实
- 组织清晰：先直接回答核心，再补充关键细节/影响
- 200-450 字
- 结尾另起一行输出「参考来源：」并列出引用序号
- 输出纯文本：禁止任何 markdown 标记（禁止 **、*、#、-、\`、[链接](url)），
  段落间用空行分隔，小标题直接写文字不加符号`
  const user = `当前新闻：${ctx.title}
新闻摘要：${ctx.what}
联网搜索结果：
${searchText || '（无结构化结果，基于回答内容）'}
搜索结果回答：${search.answer || ''}

请基于以上信息回答用户话题「${query}」。`
  const r = await deepseekChat(system, user, { maxTokens: 900, temperature: 0.4 })
  if (!r || !r.text) return r ? { text: null, engine: r.engine } : { text: null, engine: '' }
  // 清洗兜底：即使模型未遵守 prompt，也剥离 markdown 标记，前端零二次处理
  const text = String(r.text)
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return { text, engine: r.engine }
}

// ─── 主入口 ─────────────────────────────
exports.main = async (event = {}) => {
  const startMs = Date.now()
  try { await ensureSchema() } catch (e) { /* 自愈建表非阻塞 */ }

  const itemId = String((event && event.itemId) || '').trim()
  const query = String((event && event.query) || '').trim()
  if (!itemId || !query) {
    return { code: -1, message: '缺少参数 itemId/query', errorCode: 'BAD_PARAM' }
  }
  if (query.length > 60) {
    return { code: -1, message: '搜索话题过长（≤60 字）', errorCode: 'QUERY_TOO_LONG' }
  }

  // 读当前新闻
  const news = await loadNews(itemId)
  if (!news) return { code: -1, message: '未找到该情报', errorCode: 'NOT_FOUND' }
  const ctx = newsContext(news)

  // ① 相关性判断（宽泛）
  const tJudge = Date.now()
  const judge = await judgeRelevance(query, ctx)
  console.log('[intelSearch] judge 耗时:', Date.now() - tJudge + 'ms', '| relevant:', judge.relevant)
  if (!judge.relevant) {
    return {
      code: 0,
      data: {
        relevant: false,
        hint: '这个话题和这条新闻关系不大哦，可以搜索 AI 相关或本条新闻相关的话题～',
        reason: judge.reason || '',
      },
    }
  }

  // ② 搜索词改写（模糊 query 结合新闻主题，搜得准）
  const searchQuery = await buildSearchQuery(query, ctx)

  // ② 联网搜索（主 Tavily 1-3s → 兜底智谱 web_search）
  const tSearch = Date.now()
  let search = await tavilySearch(searchQuery)
  console.log('[intelSearch] 搜索耗时:', Date.now() - tSearch + 'ms | ok:', search.ok, '| sources:', (search.sources||[]).length)
  if (!search.ok) {
    console.warn('[intelSearch] tavily 失败:', search.reason, '→ 兜底智谱 web_search')
    search = await zhipuWebSearch(query)
  }
  if (!search.ok) {
    console.warn('[intelSearch] web_search 全部失败:', search.reason)
    return {
      code: 0,
      data: { relevant: true, answer: null, error: 'search_unavailable', hint: '这个话题联网搜索暂时没找到结果，可以换个更具体的说法再试试～' },
    }
  }

  // ③ 总结回答（混元为主，智谱备选）；8s 超时兜底直接用搜索回答，避免整函数超时
  let sum = null
  const tSum = Date.now()
  try {
    sum = await Promise.race([
      summarize(query, ctx, search),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ])
  } catch (e) { sum = null }
  console.log('[intelSearch] summarize 耗时:', Date.now() - tSum + 'ms', '| sum:', sum ? '成功' : 'null(兜底)')
  // 总结失败 → 不把来源页内容拼进正文（来源已在 sources 折叠展示，避免「来源当正文」）
  const result = {
    code: 0,
    data: {
      relevant: true,
      answer: (sum && sum.text) || '',
      sources: search.sources || [],
      engine: (sum && sum.engine) || 'tavily',
      query,
    },
  }

  return result
}
