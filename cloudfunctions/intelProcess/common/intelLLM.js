/**
 * intelLLM.js — AI 情报官 LLM 调用封装（Phase 3 地基 / P 角色）
 * ============================================================
 * 复用 One News `common/contentFetcher.js` `interpretNews` 的多引擎降级链（非其业务）：
 *   智谱 GLM → Qwen → DeepSeek（OpenAI 兼容 chat/completions）+ 混元云开发内置兜底。
 * 与 interpretNews 的差异：本模块只提供「通用 chat 通道」，不绑定新闻解读读法路由
 *   （interpretLens）/【一页说】观点段/qualityScorer 信号。SOP 五步 prompt、路由、画像
 *   关联由 intelProcess（T3.x）负责组装。intel_ 命名空间隔离，可整体摘除。
 *
 * 配置读取（与 One News 一致，避免双 key 体系）：
 *   - 智谱：config.zhipuSummary.{ apiKey, baseUrl, model }
 *   - Qwen：process.env.DASHSCOPE_API_KEY || config.qwen.{apiKey, model}
 *   - DeepSeek：process.env.DEEPSEEK_API_KEY || config.deepseek.{apiKey, model}
 *   - 混元：config.hunyuan.{ enabled, model, timeout }（云开发内置 createModel，免费额度）
 * 依赖：any OpenAI 兼容 /v1/chat/completions；纯 Node https，零第三方依赖。
 */

const DEFAULT_SYSTEM = '你是务实的 AI 情报助理，直接给结论，不堆参数、不软文、不夸大。'

/** OpenAI 兼容单引擎请求（带强制超时兜底，防半开连接挂起——复用 One News 修复后的逻辑） */
function requestOpenAI(eng, body) {
  return new Promise((resolve) => {
    const https = require('https')
    const url = new URL(eng.baseUrl)
    const payload = JSON.stringify(body)
    let settled = false
    const finish = (out) => { if (!settled) { settled = true; resolve(out) } }
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${eng.apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: eng.timeout,
    }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try {
          const resp = JSON.parse(data)
          const txt = resp.choices && resp.choices[0] && resp.choices[0].message
            ? String(resp.choices[0].message.content || '').trim() : null
          finish(txt ? { text: txt } : { text: null, reason: '空响应体' })
        } catch (e) { finish({ text: null, reason: '响应JSON解析失败' }) }
      })
    })
    const forceTimer = setTimeout(() => { req.destroy(); finish({ text: null, reason: '强制超时(半开连接兜底)' }) }, eng.timeout + 500)
    req.on('error', (e) => { clearTimeout(forceTimer); finish({ text: null, reason: '网络错误:' + (e && (e.code || e.message) || e) }) })
    req.on('timeout', () => { clearTimeout(forceTimer); req.destroy(); finish({ text: null, reason: '连接超时' }) })
    req.on('close', () => clearTimeout(forceTimer))
    req.write(payload)
    req.end()
  })
}

/** 混元云开发内置通道（免费额度兜底） */
function requestHunyuan(config, systemPrompt, userText, minAccept, isAvailable) {
  return new Promise((resolve) => {
    if (!config.enabled) return resolve(null)
    if (!isAvailable.cloudAi) {
      console.warn('[intelLLM] wx-server-sdk 无 cloud.ai()，跳过混元')
      return resolve(null)
    }
    const timeoutMs = config.timeout || 8000
    const timer = setTimeout(() => { console.warn('[intelLLM] 混元调用超时'); resolve(null) }, timeoutMs)
    isAvailable.cloud.ai().createModel('cloudbase').generateText({
      model: config.model || 'hy3',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }).then((result) => {
      clearTimeout(timer)
      const txt = (result && result.text ? String(result.text) : '').trim()
      if (txt && txt.length >= minAccept) resolve({ text: txt })
      else resolve(null)
    }).catch((err) => {
      clearTimeout(timer)
      console.warn(`[intelLLM] 混元调用失败，降级下一引擎:`, err && err.message || err)
      resolve(null)
    })
  })
}

/**
 * 通用多引擎 chat：按序尝试 智谱/Qwen/DeepSeek/混元，任一成功即返回。
 * @param {Object} opts
 * @param {string} opts.systemPrompt system 角色
 * @param {string} opts.user - user 内容
 * @param {number} [opts.minAccept=20] - 接受的最小输出长度（过短视为失败）
 * @param {number} [opts.maxTokens=900] - 输出上限 token
 * @param {number} [opts.temperature=0.7]
 * @param {string} [opts.tag] - 日志标签（如 intelProcess/sop）
 * @returns {Promise<{text:string, engine: '智谱'|'Qwen'|'DeepSeek'|'混元'}|null>}
 */
async function intelChat(opts = {}) {
  const { systemPrompt = DEFAULT_SYSTEM, user = '', minAccept = 20, maxTokens = 900, temperature = 0.7, tag = 'intel' } = opts
  if (!user || !String(user).trim()) return null
  const config = readConfig()
  const engines = []
  // 智谱：优先复用 One News 云函数环境变量 ZHIPU_API_KEY（T0.3 owner 拍板复用既有 key），
  // 其次读 config.zhipuSummary；baseUrl 缺省智谱官方兼容端点
  const zs = config.zhipuSummary || {}
  const zsKey = process.env.ZHIPU_API_KEY || zs.apiKey || ''
  if (zsKey) engines.push({ name: '智谱', apiKey: zsKey, baseUrl: zs.baseUrl || 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: zs.model || 'glm-4-flash', timeout: 20000 })
  const dashKey = process.env.DASHSCOPE_API_KEY || (config.qwen && config.qwen.apiKey) || ''
  if (dashKey) engines.push({ name: 'Qwen', apiKey: dashKey, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: (config.qwen && config.qwen.model) || 'qwen3.7-flash', timeout: 20000 })
  const dsKey = process.env.DEEPSEEK_API_KEY || (config.deepseek && config.deepseek.apiKey) || ''
  if (dsKey) engines.push({ name: 'DeepSeek', apiKey: dsKey, baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: (config.deepseek && config.deepseek.model) || 'deepseek-chat', timeout: 20000 })

  const bodyFor = (eng) => JSON.stringify({
    model: eng.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: user },
    ],
    max_tokens: maxTokens,
    temperature,
  })

  const hunyuanCfg = config.hunyuan || {}
  const isAvailable = { cloudAi: false }
  try {
    const cloud = require('wx-server-sdk')
    if (cloud && typeof cloud.init === 'function' && typeof cloud.ai === 'function') {
      try { cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 }); isAvailable.cloudAi = true } catch (e) { /* 忽略 */ }
    }
  } catch (e) { /* 无 wx-server-sdk */ }

  // 混元前置（免费额度优先，节省外部 Key 配额）——与 One News 8/13 方案①一致
  const providers = engines.map((e) => ({ kind: 'openai', eng: e, body: bodyFor(e) }))
  const hyEnabled = hunyuanCfg.enabled === true
  if (hyEnabled) {
    providers.unshift({ kind: 'hunyuan' })
  }

  if (providers.length === 0) {
    console.warn(`[intelLLM] ${tag} 未配置任何引擎，跳过 LLM 调用`)
    return null
  }

  for (const p of providers) {
    try {
      if (p.kind === 'hunyuan') {
        const r = await requestHunyuan(hunyuanCfg, systemPrompt, user, minAccept, isAvailable)
        if (r) { console.log(`[intelLLM] ${tag} 混元成功（${r.text.length}字）`); return Object.assign(r, { engine: '混元' }) }
      } else {
        const body = JSON.parse(p.body)
        const r = await requestOpenAI(p.eng, body)
        if (r && r.text && r.text.length >= minAccept) { console.log(`[intelLLM] ${tag} ${p.eng.name} 成功（${r.text.length}字）`); return Object.assign(r, { engine: p.eng.name }) }
        console.warn(`[intelLLM] ${tag} ${p.eng.name} 失败（${r && r.reason || '过短'}），尝试下一引擎`)
      }
    } catch (e) {
      console.warn(`[intelLLM] ${tag} 引擎异常（${e && e.message || e}），尝试下一引擎`)
    }
  }
  return null
}

/** 读取 LLM 配置（延迟 require，避免浏览器/纯 Node 环境加载失败） */
let _config = null
function readConfig() {
  if (_config) return _config
  try { _config = require(configResolver())() } catch (e) { _config = {} }
  return _config
}
function configResolver() {
  return () => { try { return require('../../common/../../config') } catch (e) { try { return require('../config') } catch (e2) { return {} } } }
}

module.exports = { intelChat, DEFAULT_SYSTEM }
