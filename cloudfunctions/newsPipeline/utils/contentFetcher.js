/**
 * 新闻正文抓取模块（refreshNews 专用，v5.8）
 * ============================================================
 * 背景：refreshNews 超时改为 60s 后，可以在刷新时就抓取新闻正文，
 *       用户打开详情页直接命中 content，无需实时抓取。
 *
 * 优先级：聚合官方内容接口（/toutiao/content）→ 网页抓取（带 UA）→ 空
 *
 * 依赖：newsCleaner.js（清洗）、config.js（JUHE_API_KEY）
 * ============================================================
 */

const { cleanNewsContent, validateCleanedContent } = require('./newsCleaner')
const config = require('../config')
// 读法路由（轻量路线，2026-08-12 owner 拍板）：把 qualityScorer 落库信号 → 解读读法 + 是否加【一页说】
const { resolveInterpretPlan, splitOpinionFromText } = require('./interpretLens')

// 抓取超时（refreshNews 有 60s 预算，单条抓取给 6s）
const FETCH_TIMEOUT_MS = 6000
const MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 // 2MB
// B-14: 单条 enrich 总超时兜底（12s）——网页抓取 + AI 摘要合计不超过此值，防拖慢 worker 池/首屏
const ITEM_TIMEOUT_MS = 12000
// 解读独立预算（owner 8/13 选方案②）：解读需多引擎降级链，12s 太紧会把混元/Qwen/DeepSeek 挤压掉；
// 提到 25s 让「混元→智谱→Qwen→DeepSeek」都有机会兜底。摘要仍用 12s（IT_ITEM_TIMEOUT_MS）。
const INTERPRET_TIMEOUT_MS = 25000

// 浏览器 UA（避免反爬）
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

/**
 * 从 URL 抓取网页 HTML（带 UA / Accept 头 + 跟随重定向 + 2MB 上限）
 * @param {string} url
 * @returns {Promise<string|null>}
 */
function fetchWebPage(url) {
  if (!url) return Promise.resolve(null)

  const protocol = url.startsWith('https') ? require('https') : require('http')

  return new Promise((resolve) => {
    const req = protocol.get(url, {
      timeout: FETCH_TIMEOUT_MS,
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
      },
    }, (res) => {
      // 跟随一次重定向（301/302）
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        const nextUrl = new URL(res.headers.location, url).toString()
        return resolve(fetchWebPage(nextUrl))
      }

      const contentType = res.headers['content-type'] || ''
      if (res.statusCode !== 200 || (!contentType.includes('html') && !contentType.includes('text'))) {
        res.resume()
        resolve(null)
        return
      }

      const chunks = []
      let total = 0
      res.on('data', chunk => {
        total += chunk.length
        if (total > MAX_DOWNLOAD_BYTES) {
          req.destroy()
          resolve(Buffer.concat(chunks).toString('utf8'))
          return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })

    req.end()
  })
}

/**
 * 定位正文容器（v6.3: 严格限定，避免延伸阅读/相关推荐混入）
 */
function locateBodyHtml(html) {
  const patterns = [
    // 中新网（chinanews.com.cn）正文容器
    /<div[^>]*class=["'][^"']*content_maincontent_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    // 优先：严格语义标签
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    // IT之家 / 聚合数据 特定容器
    /<div[^>]*id=["']paragraph["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_body[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class=["'][^"']*post_content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*id=["']content["'][^>]*>([\s\S]*?)<\/div>/i,
    // 更严格的 class 匹配：只取 article-content 而非 article-*
    /<div[^>]*class=["']article-content["'][^>]*>([\s\S]*?)<\/div>/i,
    // 兜底：更宽松的 article 类容器（排最后，仅在前述全部失败时使用）
    /<div[^>]*class=["'][^"']*article[^"']*["'][^>]*>([\s\S]*?)<\/div>/i,
  ]
  for (const re of patterns) {
    const m = html.match(re)
    if (m && m[1]) {
      // v6.3(V5-FS-02-⑥): 在容器内截断"延伸阅读/相关推荐"之后的全部内容
      return trimExtraneousContent(m[1])
    }
  }
  return null
}

/**
 * v6.3(V5-FS-02-⑥): 截断正文容器内"延伸阅读/相关推荐"及之后的内容
 * 解决 IT之家等来源正文末尾混入其他新闻段落的问题
 */
function trimExtraneousContent(html) {
  if (!html) return null
  // 匹配"延伸阅读""相关推荐""推荐阅读"等区域标记（含 HTML 标签包裹形态）
  const cutoffPatterns = [
    /<[^>]*class=["'][^"']*(?:related|recommend|extend|extra)[^"']*["'][^>]*>/i,
    /(?:延伸阅读|相关推荐|推荐阅读|相关新闻|热门推荐|猜你喜欢|更多阅读)[：:]/i,
    /<h\d[^>]*>(?:延伸阅读|相关推荐|推荐阅读|相关新闻)[\s\S]*?<\/h\d>/i,
    // IT之家: "广告声明：文内含有的对外跳转链接..." 之后的内容
    /广告声明[：:][\s\S]*?(?:链接|二维码|口令)/i,
  ]
  for (const pattern of cutoffPatterns) {
    const idx = html.search(pattern)
    if (idx > 100) { // 只在正文足够长（>100字符）时才截断，避免误伤短正文
      return html.slice(0, idx).trim()
    }
  }
  return html
}

/**
 * 提取 <p> 段落（过滤过短噪音）
 */
function extractParagraphs(containerHtml) {
  if (!containerHtml) return []
  const paras = []
  const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi
  let m
  while ((m = pRe.exec(containerHtml)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length >= 15) paras.push(text)
  }
  return paras
}

/**
 * 从 HTML 提取正文纯文本
 */
function extractContentFromHtml(html) {
  if (!html) return null
  const cleaned = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, ' ')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
  let paras = extractParagraphs(locateBodyHtml(cleaned))
  if (paras.length < 2) paras = extractParagraphs(cleaned)
  if (paras.length === 0) return null
  return paras.join('\n')
}

/**
 * 从 juhe id 解析 uniquekey
 * id 格式：juhe_${category}_${uniquekey}
 */
function parseJuheKey(id) {
  if (!id || typeof id !== 'string') return null
  const prefix = 'juhe_'
  if (!id.startsWith(prefix)) return null
  const first = id.indexOf('_', prefix.length)
  if (first === -1) return null
  return id.slice(first + 1) || null
}

/**
 * 调用聚合官方内容接口获取正文
 * @param {string} uniquekey
 * @param {Object} [options] - { title, source } 供清洗去重
 * @returns {Promise<string|null>}
 */
function fetchJuheContent(uniquekey, options = {}) {
  if (!config.juhe.apiKey || !uniquekey) return Promise.resolve(null)

  return new Promise((resolve) => {
    const https = require('https')
    const querystring = require('querystring')
    const postData = querystring.stringify({
      key: config.juhe.apiKey,
      uniquekey,
    })

    const req = https.request(config.juhe.contentUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
      timeout: FETCH_TIMEOUT_MS,
    }, (res) => {
      // B-14: HTTP 状态码非 2xx 直接降级
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        resolve(null)
        return
      }

      let body = ''
      // B-14: 响应体大小上限（8MB），防异常大响应拖垮内存
      const MAX_BODY_BYTES = 8 * 1024 * 1024
      let bytes = 0
      res.on('data', chunk => {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) {
          req.destroy()
          resolve(null)
          return
        }
        body += chunk
      })
      res.on('end', () => {
        try {
          const result = JSON.parse(body)
          // B-11: error_code 兼容字符串/数字（聚合接口偶发返回字符串 "0"）
          if (Number(result.error_code) !== 0 || !result.result || !result.result.content) {
            resolve(null)
            return
          }
          const cleaned = cleanNewsContent(result.result.content, {
            maxLength: 3000,
            title: options.title,
            source: options.source,
          })
          const validation = validateCleanedContent(cleaned)
          if (!validation.valid) {
            resolve(null)
            return
          }
          resolve(cleaned)
        } catch (e) {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.write(postData)
    req.end()
  })
}

/**
 * 为单条新闻获取正文（聚合官方接口 → 网页抓取 → 空）
 * @param {Object} item - { id, title, source, sourceUrl }
 * @returns {Promise<string>} 清洗后的正文；失败返回 ''
 */
async function fetchContentForItem(item) {
  let best = ''
  // 1. 聚合官方内容接口（juhe 按 uniquekey 取正文）
  const juheKey = parseJuheKey(item.id)
  if (juheKey) {
    const juheContent = await fetchJuheContent(juheKey, { title: item.title, source: item.source })
    // 仅接受有效正文（>=50字），短摘要/限流空响应不视为可用
    if (juheContent && juheContent.length >= 50) best = juheContent
  }

  // 2. 网页抓取补全（v6.6 / 2026-08-12：与官方源 A2 同源思路）
  //    根因：聚合接口（juhe）常只返回短摘要、或免费版限流(100次/分)返回空，
  //          导致正文过短/缺失 → interpretNews 跳过或解读质量差 → 大面积无 AI 解读正文。
  //    修复：正文 < 200 字时按 sourceUrl 抓源站网页正文补全，取较长者，
  //          保证 interpretNews 有足够输入 → 提升 AI 解读覆盖率（contentSource 变 ai_interpretation，过 R1 门禁）。
  //    tianxing 无 content 字段、id 非 juhe_ → 直接走此分支（唯一正文来源）。
  //    版权合规：抓到的源站正文仅作 AI 加工源，news_cache 不落库原文。
  if (best.length < 200 && item.sourceUrl) {
    try {
      const html = await fetchWebPage(item.sourceUrl)
      if (html) {
        const extracted = extractContentFromHtml(html)
        if (extracted) {
          const cleaned = cleanNewsContent(extracted, {
            maxLength: 3000,
            title: item.title,
            source: item.source,
          })
          const validation = validateCleanedContent(cleaned)
          if (validation.valid && cleaned.length > best.length) best = cleaned
        }
      }
    } catch (err) {
      // 忽略单条抓取失败
    }
  }

  return best
}

/**
 * FS-05 v2（2026-08-09 owner 拍板）：判定"假 desc"
 * 聚合接口常返回日期/来源名/几个标点，长度可能 20-50 字符，原 `summary === title` 漏判。
 * 严格规则：空 / 等于标题 / 长度<20 / 剥数字标点后中文<5 / 等于来源名 → 一律视为无效。
 * 提到顶层 + 导出，供 index.js 写库逻辑复用（防止老假 desc 赢过新首段）。
 * @param {string} s
 * @param {object} ctx - { title, source }
 * @returns {boolean}
 */
function isInvalidDesc(s, ctx) {
  if (!s) return true
  if (ctx && ctx.title && s === ctx.title) return true
  if (s.length < 20) return true
  // 剥数字/标点/空白/常见日期字符后,剩余中文 < 5 → 视为日期/标点
  const stripped = s.replace(/[\d\s\-/:.\u3000,，。、年月日时分秒]+/g, '')
  if (stripped.length < 5) return true
  if (ctx && ctx.source && s === ctx.source) return true
  return false
}

/**
 * FS-05 v2:首段二次校验（content 兜底用）= 假 desc 反义
 */
function isValidParagraph(s, ctx) {
  return !isInvalidDesc(s, ctx)
}

module.exports = {
  enrichNewsList,
  fetchContentForItem,
  fetchJuheContent,
  fetchWebPage,
  extractContentFromHtml,
  parseJuheKey,
  summarizeWithZhipu,
  interpretNews,    // B-COMPLIANCE-1 A（2026-08-11 owner 拍板）：AI 独立解读通道，供降级源（聚合/天行）补 content 解读
  isInvalidDesc,    // FS-05 v2:导出供 index.js 写库逻辑复用
  isValidParagraph, // FS-05 v2:导出供 index.js 写库逻辑复用
}

/**
 * B-COMPLIANCE-1 A（2026-08-11 owner 拍板）：AI 独立解读（非摘要）
 * 目的：聚合/天行等"降级源"（无 AI 搜索、只抓到原文全文）的新闻，详情页被 R1 拦截后是空卡。
 *       这里对抓到的原文 content 再做一次"AI 独立解读"，产出 200-500 字解读写回 content，
 *       并标记 contentSource='ai_interpretation'，让 R1 放行、详情页出真解读（而非"卡片搬运"）。
 * 与 summarizeWithZhipu 的区别：解读≠摘要 —— 不复述原文、需基于事实组织重写、可加背景/影响分析，
 * 长度 200-500 字（摘要仅 100-150 字）。
 * 成本：仅降级源（聚合/天行）才调用，AI 源（智谱搜索）已自带 ai_interpretation content，不重复。
 * 失败兜底：返回 null → 调用方不写 content 的 ai_interpretation 标记 → 走 R1 拦截返回 summary。
 * 引擎链：智谱 → Qwen → DeepSeek（外部 Key）→ 混元兜底（免费额度，最后才用）。
 * @param {string} content - 抓到的原文全文（聚合/天行源）
 * @param {string} title - 新闻标题
 * @param {Array<{title,source,url}>} [references] - 可选信源 URL 列表，辅助解读可溯源
 * @param {Object} [signals] - 可选评分信号（qualityScorer 落库字段：finalScore/category/title/summary），
 *                             用于「读法路由」决定解读风格与是否加【一页说】观点段。缺省 → depth 读法（不退化）。
 * @returns {Promise<{text:string,aiOpinion:string,lensId:string,lensName:string,withOpinion:boolean,routeReason:string,tMin:number,tMax:number}|null>}
 *          成功返回解读对象：text=正文（已剥离【一页说】内联标记），aiOpinion=【一页说】观点独立字段（无观点时为空串），
 *          其余为读法路由元信息，供日志/可观测；失败/过短/无配置返回 null。
 */
function interpretNews(content, title, references, signals) {
  const hunyuanCfg = (config.hunyuan || {})
  const engines = []
  // 复用与摘要一致的引擎链：智谱 → Qwen → DeepSeek → 混元兜底
  // 2026-08-12 修订：解读超时从 8s 提到 12s——解读 prompt 要求 200-600 字独立成文，
  // 8s 太短（三引擎全挂日志密集的根因之一），12s 与 ITEM_TIMEOUT_MS 对齐。
  const zhipuCfg = (config.zhipuSummary || {})
  if (zhipuCfg.apiKey) {
    engines.push({ name: '智谱', apiKey: zhipuCfg.apiKey, baseUrl: zhipuCfg.baseUrl, model: zhipuCfg.model || 'glm-4-flash', timeout: 8000 })
  }
  const dashKey = process.env.DASHSCOPE_API_KEY || (config.qwen && config.qwen.apiKey) || ''
  if (dashKey) {
    engines.push({ name: 'Qwen', apiKey: dashKey, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: (config.qwen && config.qwen.model) || 'qwen3.7-flash', timeout: 8000 })
  }
  const deepseekKey = process.env.DEEPSEEK_API_KEY || (config.deepseek && config.deepseek.apiKey) || ''
  if (deepseekKey) {
    engines.push({ name: 'DeepSeek', apiKey: deepseekKey, baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: (config.deepseek && config.deepseek.model) || 'deepseek-chat', timeout: 8000 })
  }
  // 解读输入门槛：正文太短（< 50 字）不值得解读
  if (!content || content.trim().length < 50) return Promise.resolve(null)
  const input = content.slice(0, (config.zhipuSummary && config.zhipuSummary.maxInputChars) || 2000)

  // 解读长度随原文长度伸缩，上限约 600 字
  const srcLen = (content || '').trim().length
  let tMin, tMax
  if (srcLen < 300) { tMin = 180; tMax = 280 }
  else if (srcLen < 800) { tMin = 300; tMax = 430 }
  else if (srcLen < 1600) { tMin = 450; tMax = 580 }
  else { tMin = 520; tMax = 600 }

  // 读法路由（2026-08-12 owner 拍板「轻量路线」）：
  // 依据 qualityScorer 已落库信号（finalScore/category）选读法 + 决定是否加【一页说】观点段。
  // signals 缺省时降级为「中等价值」→ depth 读法，保证老调用方（3 参）行为不退化。
  const plan = resolveInterpretPlan(signals || { title }, { srcLen, tMin, tMax })
  // 读法会按 lengthFactor 收缩字数（速览天然短），故以 plan 的区间为准
  tMin = plan.tMin
  tMax = plan.tMax
  const maxTokens = Math.min(1600, Math.ceil(tMax * 2.3))
  // 合格门槛（owner 8/13 选方案③）：在「混元前置 + 25s 预算」基础上进一步放宽，
  // 地板 90→50、长文系数 0.35→0.25；旧 max(90,tMin*0.35) 长文门槛 312 字仍误杀混元 200-280 字解读。
  // 现 max(50, tMin*0.25)：长文门槛降至 ~130 字，短文地板 50 字，解读覆盖率向摘要看齐。
  const minAccept = Math.max(50, Math.round(tMin * 0.25))

  const INTERPRET_PROMPT = plan.prompt

  // 混元兜底（云开发内置，免费额度；与摘要共用同一 createModel 通道）
  function tryHunyuan() {
    if (!hunyuanCfg.enabled) return Promise.resolve(null)
    return new Promise((resolve) => {
      let cloud
      try {
        cloud = require('wx-server-sdk')
        if (!cloud || typeof cloud.init !== 'function' || typeof cloud.ai !== 'function') {
          console.warn('[interpret] 混元不可用：wx-server-sdk 无 cloud.ai()，降级下一引擎')
          resolve(null); return
        }
        cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
      } catch (e) {
        console.warn('[interpret] 混元初始化失败（无法加载 wx-server-sdk）：' + (e && e.message || e) + '，降级下一引擎')
        resolve(null); return
      }
      const userContent = `新闻标题：${title || ''}\n\n新闻原文：\n${input}`
      const model = cloud.ai().createModel('cloudbase')
      const timeoutMs = hunyuanCfg.timeout || 8000
      const timer = setTimeout(() => { console.warn(`[interpret] 混元解读超时(>${timeoutMs}ms)，降级下一引擎`); resolve(null) }, timeoutMs)
      model.generateText({
        model: hunyuanCfg.model || 'hy3',
        messages: [
          { role: 'system', content: INTERPRET_PROMPT },
          { role: 'user', content: userContent },
        ],
      }).then((result) => {
        clearTimeout(timer)
        const txt = (result && result.text ? result.text : '').trim()
        if (txt && txt.length >= minAccept) {
          // 切出【一页说】观点成独立字段 aiOpinion，正文剥离内联标记（owner 8/12 拍板：观点卡独立呈现）
          const { body, opinion } = splitOpinionFromText(txt)
          // 可观测性（2026-08-13 owner 推进项②）：补全混元解读成功日志，
          // 否则 tryHunyuan 失败静默 resolve(null)，无法从 CLS 确认「混元解读是否真的接管」。
          console.log(`[interpret] 混元解读成功（${txt.length}字｜读法=${plan.lensName}）`)
          resolve({
            text: body,
            aiOpinion: plan.withOpinion ? opinion : '',
            lensId: plan.lensId, lensName: plan.lensName,
            withOpinion: plan.withOpinion, routeReason: plan.routeReason,
            tMin: plan.tMin, tMax: plan.tMax,
          })
        } else {
          console.warn(`[interpret] 混元解读为空/过短(<${minAccept})，降级下一引擎`)
          resolve(null)
        }
      }).catch((err) => {
        clearTimeout(timer)
        console.warn(`[interpret] 混元引擎调用失败：${err && err.message ? err.message : err}，降级下一引擎`)
        resolve(null)
      })
    })
  }

  if (engines.length === 0 && !hunyuanCfg.enabled) {
    console.warn('[interpret] 未配置任何解读引擎，跳过 AI 独立解读')
    return Promise.resolve(null)
  }
  // 有序降级链（owner 8/13 选方案①：混元前置）：混元(云开发内置·免费额度·快) → 智谱 → Qwen → DeepSeek
  // 混元平台托管鉴权、零密钥、免费额度，且中文解读质量稳定、延迟低；置于首位的理由：
  //  - 25s 预算内优先用免费额度跑通，绝大多数条目首引擎即成，省外部 Key 配额；
  //  - 混元失败再降智谱→Qwen→DeepSeek（付费外部 Key），任一成功即返回。
  const providers = engines.map((eng) => ({ kind: 'openai', eng }))
  const zhipuIdx = engines.findIndex((e) => e.name === '智谱')
  if (hunyuanCfg.enabled) {
    // 插入到智谱之前（即在整个链首位），实现「混元前置」
    if (zhipuIdx >= 0) providers.splice(zhipuIdx, 0, { kind: 'hunyuan' })
    else providers.unshift({ kind: 'hunyuan' })
  }
  return (async () => {
    for (const p of providers) {
      const r = p.kind === 'openai' ? await tryOneEngine(p.eng) : await tryHunyuan()
      if (r) return r
    }
    return null
  })()

  // 单引擎尝试（2 次重试）；不再链式 forward，由外层 providers 列表统一编排顺序
  function tryOneEngine(eng) {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        model: eng.model,
        messages: [
          { role: 'system', content: INTERPRET_PROMPT },
          { role: 'user', content: `新闻标题：${title || ''}\n\n新闻原文：\n${input}` },
        ],
        max_tokens: maxTokens,  // 解读长度随原文伸缩，上限约 600 字（中文 ~2.3 token/字）
        temperature: 0.7, // 解读需有观点、可读性强，适度放开创造性
      })
      const doRequest = () => new Promise((r) => {
        // 2026-08-13 修复「AI 解读挂起根因」：
        // Node HTTPS 在「半开连接」（服务端已收包但未响应/连接中断未触发 FIN）下，
        // req.setTimeout 的 'timeout' 事件偶发不触发 → doRequest 内 Promise 永不 settle →
        // 降级链永远走不到 → 外层 12s race 掐断全失败。
        // 修复：独立强制超时兜底（Promise.race + req.destroy()），无论 'timeout' 事件是否触发，
        //      到点必 destroy 掐断 + resolve(null)，让降级链能执行。
        // 2026-08-13 owner 推进项②：doRequest 返回 {text, reason}，失败时记录原因供 CLS 诊断闭环。
        const https = require('https')
        const url = new URL(eng.baseUrl)
        let settled = false
        const finish = (out) => { if (!settled) { settled = true; r(out) } }
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${eng.apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: eng.timeout,
        }, (res) => {
          let data = ''
          res.on('data', chunk => { data += chunk })
          res.on('end', () => {
            try {
              const resp = JSON.parse(data)
              const txt = resp.choices && resp.choices[0] && resp.choices[0].message
                ? resp.choices[0].message.content.trim()
                : null
              finish(txt ? { text: txt } : { text: null, reason: '空响应体' })
            } catch (e) { finish({ text: null, reason: '响应JSON解析失败' }) }
          })
        })
        // 独立强制超时：不依赖 req.on('timeout') 事件（半开连接下不可靠）
        const forceTimer = setTimeout(() => { req.destroy(); finish({ text: null, reason: '强制超时(半开连接兜底)' }) }, eng.timeout + 500)
        req.on('error', (e) => { clearTimeout(forceTimer); finish({ text: null, reason: '网络错误:' + (e && e.code || e.message || e) }) })
        req.on('timeout', () => { clearTimeout(forceTimer); req.destroy(); finish({ text: null, reason: '连接超时' }) })
        req.on('close', () => clearTimeout(forceTimer))
        req.write(body)
        req.end()
      })
      ;(async () => {
        let lastReason = '未知'
        for (let attempt = 0; attempt < 2; attempt++) {
          const out = await doRequest()
          if (out.text && out.text.length >= minAccept) {
            // 切出【一页说】观点成独立字段 aiOpinion，正文剥离内联标记
            const { body, opinion } = splitOpinionFromText(out.text)
            resolve({
              text: body,
              aiOpinion: plan.withOpinion ? opinion : '',
              lensId: plan.lensId, lensName: plan.lensName,
              withOpinion: plan.withOpinion, routeReason: plan.routeReason,
              tMin: plan.tMin, tMax: plan.tMax,
            })
            return
          }
          if (out.text) lastReason = `文本过短(${out.text.length}<${minAccept})`
          else lastReason = out.reason || '空响应'
          if (attempt < 1) await new Promise(res => setTimeout(res, 500))
        }
        console.warn(`[interpret] ${eng.name} 解读失败（${lastReason}），尝试下一引擎`)
        resolve(null)
      })()
    })
  }
}

/**
 * 调用智谱 GLM-4-Flash 生成新闻摘要（v6.2：从百炼 DashScope 切换为智谱）
 * 未配置 ZHIPU_API_KEY 时返回 null。
 * 正文长度门槛降至 10 字（v6.2：提高 AI 摘要覆盖率）。
 * FS-04（2026-08-09 owner 拍板）：三级摘要降级 —— 智谱 → Qwen → DeepSeek
 *  8/9 08:00 跑批 life/international 摘要缺失根因：智谱超时 + Qwen 403 配额耗尽 + DeepSeek 402 余额不足。
 *  原代码只挂 2 引擎，搜索阶段降级 DeepSeek 但摘要阶段没接 → 现补全为 3 引擎，DeepSeek 补位。
 * @param {string} content - 清洗后的正文
 * @param {string} title   - 新闻标题
 * @returns {Promise<string|null>} 100-300 字中文摘要
 */
function summarizeWithZhipu(content, title) {
    // config 模块级引用（顶部 require ../config）
  // DG-03（2026-08-06）：双引擎摘要 —— 智谱（ZHIPU_API_KEY）优先，通义 Qwen（DASHSCOPE_API_KEY）兜底
  // FS-04（2026-08-09）：补全 DeepSeek 引擎 —— OpenAI 兼容协议，与 Qwen 模式一致
  // FS-06（2026-08-09）：混元引擎初版前置 —— 云开发内置免费额度（无密钥）
  // FS-CF1（2026-08-10 owner 指示）：混元降级到最后一位（外部 Key 链 → 混元兜底），省 10亿 免费额度
  const hunyuanCfg = (config.hunyuan || {})
  const zhipuCfg = (config.zhipuSummary || {})
  const engines = []
  if (zhipuCfg.apiKey) {
    engines.push({ name: '智谱', apiKey: zhipuCfg.apiKey, baseUrl: zhipuCfg.baseUrl, model: zhipuCfg.model || 'glm-4-flash', timeout: zhipuCfg.timeout || 8000 })
  }
  const dashKey = process.env.DASHSCOPE_API_KEY || (config.qwen && config.qwen.apiKey) || ''
  if (dashKey) {
    engines.push({ name: 'Qwen', apiKey: dashKey, baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: (config.qwen && config.qwen.model) || 'qwen-turbo', timeout: 8000 })
  }
  // FS-04：DeepSeek 摘要引擎（OpenAI 兼容协议，与 search 链共用同一个 Key + base）
  // 8/9 凌晨根因：搜索阶段能降级到 DeepSeek，但摘要函数未挂 → AI 摘要永远走不到 DeepSeek。
  // 现补上：DeepSeek 在前两个都失败时接管，避免再次出现"AI 摘要无结果"。
  const deepseekKey = process.env.DEEPSEEK_API_KEY || (config.deepseek && config.deepseek.apiKey) || ''
  if (deepseekKey) {
    engines.push({ name: 'DeepSeek', apiKey: deepseekKey, baseUrl: 'https://api.deepseek.com/v1/chat/completions', model: (config.deepseek && config.deepseek.model) || 'deepseek-chat', timeout: 8000 })
  }
  // 正文门槛 10 字（提高 AI 摘要覆盖率）
  if (!content || content.trim().length < 10) return Promise.resolve(null)
  const input = content.slice(0, (zhipuCfg.maxInputChars) || 2000)

  // FS-06：混元引擎 —— 云开发内置，无需 API Key（微信AI小程序成长计划免费额度），现为最后兜底
  // 经 cloud.ai().createModel('cloudbase').generateText() 调用，平台托管鉴权。
  // ⚠️ dynamic require：本地沙箱/未部署云环境时无 wx-server-sdk → try/catch 静默跳过，
  //    完全不影响原 智谱/Qwen/DeepSeek 链。前置：owner 在 CloudBase 控制台 AI+ 勾选 hy3。
  function tryHunyuan() {
    if (!hunyuanCfg.enabled) return Promise.resolve(null)
    return new Promise((resolve) => {
      let cloud
      try {
        cloud = require('wx-server-sdk')
        if (!cloud || typeof cloud.init !== 'function' || typeof cloud.ai !== 'function') {
          console.warn('[summarize] wx-server-sdk 版本过低或无 cloud.ai()，跳过混元')
          resolve(null); return
        }
        cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 60000 })
      } catch (e) {
        console.warn('[summarize] 无法加载 wx-server-sdk（本地/沙箱环境），跳过混元引擎：' + e.message)
        resolve(null); return
      }
      const prompt = '你是新闻摘要助手。基于用户提供的新闻正文，生成 100-150 字的中文摘要。要求：突出核心事件、关键信息与各方反应，不重复标题，不使用"本文""据报道"等套话，直接输出摘要正文，内容完整、以句号自然收尾。'
      const userContent = `新闻标题：${title || ''}\n\n新闻正文：\n${input}`
      const model = cloud.ai().createModel('cloudbase')
      const timeoutMs = hunyuanCfg.timeout || 8000
      const timer = setTimeout(() => { console.warn('[summarize] 混元摘要超时，降级下一引擎'); resolve(null) }, timeoutMs)
      model.generateText({
        model: hunyuanCfg.model || 'hy3',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: userContent },
        ],
      }).then((result) => {
        clearTimeout(timer)
        const summary = (result && result.text ? result.text : '').trim()
        if (summary && summary.length >= 30) {
          console.log(`[summarize] 混元摘要成功（${summary.length}字）`)
          resolve(summary)
        } else {
          console.warn('[summarize] 混元摘要为空/过短，降级下一引擎')
          resolve(null)
        }
      }).catch((err) => {
        clearTimeout(timer)
        console.warn(`[summarize] 混元引擎调用失败：${err && err.message ? err.message : err}，降级下一引擎`)
        resolve(null)
      })
    })
  }

  if (engines.length === 0 && !hunyuanCfg.enabled) {
    console.warn('[summarize] 未配置任何摘要引擎（混元未启用 + 无外部 Key），跳过 AI 摘要')
    return Promise.resolve(null)
  }

  // 有序降级链（owner 8/13 拍板·摘要同步修复）：混元(云开发内置·免费额度·快) → 智谱 → Qwen → DeepSeek
  // 混元平台托管鉴权、零密钥、免费额度，且中文摘要质量稳定、延迟低；置于首位：
  //  - 12s 预算内优先用免费额度跑通，绝大多数条目首引擎即成，省外部 Key 配额；
  //  - 混元失败再降智谱→Qwen→DeepSeek（付费外部 Key），任一成功即返回。
  // 此前「智谱打头」+ 12s race 把智谱 8s×3 重试吃满，永远轮不到混元/Qwen/DeepSeek 兜底 → 摘要大面积 null。
  const providers = engines.map((eng) => ({ kind: 'openai', eng }))
  const zhipuIdx = engines.findIndex((e) => e.name === '智谱')
  if (hunyuanCfg.enabled) {
    // 插入到智谱之前（即在整个链首位），实现「混元前置」（与 interpretNews 8/13 修复一致）
    if (zhipuIdx >= 0) providers.splice(zhipuIdx, 0, { kind: 'hunyuan' })
    else providers.unshift({ kind: 'hunyuan' })
  }
  return (async () => {
    for (const p of providers) {
      const s = p.kind === 'openai' ? await tryOneEngine(p.eng) : await tryHunyuan()
      if (s) return s
    }
    return null
  })()

  // 单引擎尝试（3 次重试，指数退避）；不再链式 forward，由外层 providers 列表统一编排顺序
  function tryOneEngine(eng) {
    return new Promise((resolve) => {
      const body = JSON.stringify({
        model: eng.model,
        messages: [
          {
            role: 'system',
            content: '你是新闻摘要助手。基于用户提供的新闻正文，生成 100-150 字的中文摘要。要求：突出核心事件、关键信息与各方反应，不重复标题，不使用"本文""据报道"等套话，直接输出摘要正文，内容完整、以句号自然收尾。',
          },
          {
            role: 'user',
            content: `新闻标题：${title || ''}\n\n新闻正文：\n${input}`,
          },
        ],
        max_tokens: 600,  // DG-10: 300→600，100-300 字摘要（中文 ~2 token/字）
        temperature: 0.3,
      })
      const doRequest = () => new Promise((r) => {
        const https = require('https')
        const url = new URL(eng.baseUrl)
        const req = https.request({
          hostname: url.hostname,
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${eng.apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: eng.timeout,
        }, (res) => {
          let data = ''
          res.on('data', chunk => { data += chunk })
          res.on('end', () => {
            try {
              const resp = JSON.parse(data)
              const summary = resp.choices && resp.choices[0] && resp.choices[0].message
                ? resp.choices[0].message.content.trim()
                : null
              r(summary ? { text: summary } : { text: null, reason: '空响应体' })
            } catch (e) { r({ text: null, reason: '响应JSON解析失败' }) }
          })
        })
        req.on('error', (e) => r({ text: null, reason: '网络错误:' + (e && e.code || e.message || e) }))
        req.on('timeout', () => { req.destroy(); r({ text: null, reason: '连接超时' }) })
        req.write(body)
        req.end()
      })
      ;(async () => {
        let lastReason = '未知'
        for (let attempt = 0; attempt < 3; attempt++) {
          const out = await doRequest()
          if (out.text && out.text.length >= 30) { resolve(out.text); return }
          if (out.text) lastReason = `文本过短(${out.text.length}<30)`
          else lastReason = out.reason || '空响应'
          if (attempt < 2) await new Promise(r => setTimeout(r, 500 * Math.pow(3, attempt)))
        }
        console.warn(`[summarize] ${eng.name} 摘要失败（${lastReason}），尝试下一引擎`)
        resolve(null)
      })()
    })
  }
}

// v6.2：保留旧函数名兼容（contentFetcher 内部已改用 summarizeWithZhipu）
// 外部 getNewsDetail 可能仍引用旧名，保留别名
const summarizeWithDashscope = summarizeWithZhipu

/**
 * 批量 enrich：抓正文 + AI 摘要（并发控制）
 * v6.1：为每条记录标记 summarySource（'ai' | 'desc' | 'title'），供前端判断是否 AI 摘要。
 * v6.5：新增 skipFetch 参数——智谱 AI 搜索返回的新闻自带 content，跳过网页抓取。
 * v6.6：新增 skipAiSummary 参数——智谱 prompt 已内联 summary（AI 来源），跳过二次 AI 摘要。
 * B-14：并发数从 config.rateLimit 读取（可调），并为单条处理加超时兜底——
 *        避免单条慢请求（网页抓取/AI 摘要）拖垮整个 worker 池、拖慢首屏。
 * @param {Array<Object>} newsList - 待处理新闻列表
 * @param {number} [concurrency] - 并发数（控制外部 API 压力；缺省读 config.rateLimit.enrichConcurrency，默认 8）
 * @param {boolean} [skipFetch=false] - 是否跳过网页抓取（智谱已自带正文）
 * @param {boolean} [skipAiSummary=false] - 是否跳过 AI 摘要生成（智谱已内联 summary）
 * @param {number} [deadline=0] - P0-2：enrich 阶段硬期限（毫秒时间戳，0=不限制）。
 *   剩余预算不足时优先保「正文抓取」（详情页缓存命中依赖 content），跳过 AI 摘要；
 *   剩余 <3s 时不再启动新条目，确保整函数 60s 内必有写入。
 * @returns {Promise<Array<Object>>} 每项追加 content / 更新 summary / 标记 summarySource
 */
async function enrichNewsList(newsList, concurrency, skipFetch = false, skipAiSummary = false, deadline = 0, onEnriched) {
  // FS-CF3（2026-08-10 owner 确认方案A「先快返回+分批增量」）：新增可选 onEnriched 回调。
  // 语义：每完成一条 enrich（成功态）立即 await onEnriched(enriched)，用于"边抓边单条写库"，
  // 让前端短轮询按 createdAt 增量读到逐条新数据。失败/被跳过条目不回调（不写库）。
  // 缺省时行为与旧版完全一致（不回调，enrichNewsList 仍为纯函数），向后兼容。
  // B-COMPLIANCE-1 S1（2026-08-10 owner 拍板）：透传 references 字段（智谱/AI 搜索链返回的来源 URL 列表），
  // 用于详情页"原文回源"展示（详见 PRD §3.2 / getNewsDetail index.js L589 透传）。
  // 缺省/非 AI 源（聚合/天行）时 references 为空数组，详情页"原文回源"按钮自动隐藏。

  // B-14: 并发数可配置（默认 8，防外部 API 压力 + 拖慢首屏）
  if (!concurrency || concurrency < 1) {
    concurrency = (config.rateLimit && config.rateLimit.enrichConcurrency) || 8
  }

  // 先统一清洗标题（防御性：避免上游数据源遗漏 HTML 实体）
  const { cleanTitle } = require('./newsCleaner')
  const cleanedNewsList = newsList.map(item => ({
    ...item,
    title: cleanTitle(item.title || ''),
  }))

  const result = new Array(cleanedNewsList.length)
  let cursor = 0

  async function worker() {
    while (cursor < cleanedNewsList.length) {
      // P0-2：剩余预算 < 3s 不再启动新条目（保写入，防整函数 60s 超时 0 写入）
      if (deadline && Date.now() + 3000 > deadline) break
      const idx = cursor++
      const item = cleanedNewsList[idx]
      // v8 路线1：官方源（contentSource='official_rss'）特殊处理
      //   - RSS content ≥ 200 字 → 直接用作 AI 解读输入（部分源 RSS 带 content:encoded 全文）
      //   - RSS content < 200 字（通常只有 description 导语）→ 按 sourceUrl 抓源站 HTML 提取正文补全（A2 方案）
      //   - AI 摘要照常（owner 拍板摘要优先级：AI > 源摘要 > 首段 > 标题）
      //   - 落库前原文清空（news_cache 不缓存官方正文全文，仅 summary + sourceUrl + AI 加工产物）
      const isOfficialRss = item.contentSource === 'official_rss'
      try {
        // 1. 抓正文
        // AI 独立解读模式（skipFetch=true）：直接使用 AI 生成的 content，不再抓原文覆盖
        // （版权策略：AI 解读 ≠ 原文复述，抓原文覆盖会破坏版权规避效果）
        let content
        if (skipFetch) {
          content = item.content || ''
        } else if (isOfficialRss) {
          // A2 方案（2026-08-12 owner 拍板）：官方源 RSS 通常只有短导语（description），
          // 无 content:encoded 全文 → AI 解读输入不足 → 解读质量差/跳过。
          // 解决：content ≥ 200 字视为有足够正文（部分源 RSS 带全文），直接用；
          //       content < 200 字 → 按 sourceUrl 抓取源站 HTML 提取正文补全。
          // 版权合规：抓到的正文仅作 AI 加工源数据（interpretNews 输入），
          //           AI 加工产物（解读正文）可落库展示；原文不缓存、不落 news_cache。
          const rssContent = (item.content || '').trim()
          if (rssContent.length >= 200) {
            content = rssContent
          } else {
            console.log(`[enrich] ${item.id || ''} 官方源 content 过短（${rssContent.length}字），按 sourceUrl 抓源站正文补全：${item.sourceUrl || ''}`)
            try {
              content = await Promise.race([
                fetchContentForItem(item),
                new Promise(resolve => setTimeout(() => resolve(''), ITEM_TIMEOUT_MS)),
              ])
              if (!content || content.trim().length < 50) {
                console.warn(`[enrich] ${item.id || ''} 源站正文抓取失败/过短（${(content||'').length}字），回退 RSS 导语`)
                content = rssContent
              } else {
                console.log(`[enrich] ${item.id || ''} 源站正文抓取成功（${content.length}字），用于 AI 解读`)
              }
            } catch (fetchErr) {
              console.warn(`[enrich] ${item.id || ''} 源站正文抓取异常，回退 RSS 导语:`, fetchErr && fetchErr.message)
              content = rssContent
            }
          }
        } else {
          // 统一链路（owner 8/13）：item.content 已在质量门控前置抓正文阶段补全；
          // 若已 ≥200 字则直接复用，不再重复抓（防与上游正文补全重复请求源站）。
          const existing = (item.content || '').trim()
          if (existing.length >= 200) {
            content = existing
          } else {
            content = await Promise.race([
              fetchContentForItem(item),
              new Promise(resolve => setTimeout(() => resolve(''), ITEM_TIMEOUT_MS)),
            ])
          }
        }
        const enriched = { ...item, content, contentSource: item.contentSource || 'fetched' }
        // B-COMPLIANCE-1 S1：透传 references（智谱/AI 搜索链的来源 URL 列表）到 enriched，
        // 写库时由 batchInsert 写入 news_cache.references 字段，详情页 getNewsDetail 读出供前端展示。
        if (Array.isArray(item.references) && item.references.length > 0) {
          enriched.references = item.references
        }
        // ── 3. AI 摘要（列表展示关键字段，优先于解读执行；混元前置保证快速成功）──
        // 2026-08-13 修复：原摘要引擎链「智谱打头」+ 12s race 把智谱 8s×3 重试吃满，
        // 永远轮不到混元/Qwen/DeepSeek 兜底 → 摘要大面积返回 null 退化成首段（summarySource='content'）。
        // 现与解读一致改为「混元前置」（见 summarizeWithZhipu），且摘要先于解读执行，
        // 避免被解读 25s 预算挤掉（列表展示靠摘要，解读是详情页加分项，best-effort 即可）。
        // 2. 判断原始 summary 来源（description 或标题兜底）
        // FS-05（2026-08-09 owner 拍板）：聚合接口常返回"假 desc"（日期/来源名/几个标点），
        // 原判定 `rawSummary === item.title` 只过滤"== 标题"，对"假 desc"无效。
        // 修复：增加"内容质量"判定 —— 长度 < 20 / 仅日期 / 仅标点 / 等于来源 → 视为无效，summarySource='title' 走首段兜底。
        // FS-05 v2:改为调顶层 isInvalidDesc(item, { title, source })
        const rawSummary = (item.summary || '').trim()
        const descCtx = { title: item.title, source: item.source }
        let summarySource = isInvalidDesc(rawSummary, descCtx) ? 'title' : 'desc'

        // AI 摘要（v6.6：skipAiSummary 时跳过——智谱已内联 summary，标记为 'ai'）
        if (skipAiSummary) {
          // 智谱 prompt 已内联 summary，且经过 AI 生成 → 标记为 'ai'
          if (rawSummary && rawSummary.length >= 20 && rawSummary !== item.title) {
            summarySource = 'ai'
          }
        } else if (content && content.length > 10) {
          // P0-2：剩余预算不足跑摘要（<8s）→ 跳过 AI 摘要，保留 content（详情页优先正文，摘要仅列表展示用）
          if (!deadline || Date.now() + 8000 <= deadline) {
            // B-14: AI 摘要同样加超时兜底（12s）；混元前置后首引擎免费额度快速命中，极少走到外部 Key 链
            const aiSummary = await Promise.race([
              summarizeWithZhipu(content, item.title),
              new Promise(resolve => setTimeout(() => resolve(null), ITEM_TIMEOUT_MS)),
            ])
            if (aiSummary && aiSummary.length >= 30) {
              // owner 8/13 #1：去掉「比例门槛」——只要产出 ≥60 字真实摘要即采用，
              // 60 字下限已能滤掉 30 字假摘要，不再用占比卡长文。
              if (aiSummary.length >= 60) {
                enriched.summary = aiSummary
                summarySource = 'ai'
              } else {
                console.warn(`[enrich] ${item.id || ''} AI 摘要过短(<60字)，降级兜底`)
              }
            }
          } else {
            console.warn(`[enrich] ${item.id || ''} 预算不足跳过 AI 摘要（保留 content，summarySource=${summarySource}）`)
          }
        }

        // ── 2/4. AI 独立解读（详情页加分项，best-effort：预算不足时跳过，不挤占摘要）──
        // B-COMPLIANCE-1 A（2026-08-11 owner 拍板）：AI 独立解读通道
        // 触发条件 = content 不是 AI 解读来源（enriched.contentSource !== 'ai_interpretation'），
        // 即：AI 源（智谱搜索）content 自带 'ai_interpretation' → 跳过（已解读）；
        //     降级源/原文（聚合/天行/抓取的全文 contentSource='fetched' 等）→ 对原文 interpretNews
        //     产出独立解读，成功则覆盖 content + 标记 'ai_interpretation'，让详情页 R1 放行出真解读
        //     （否则被 R1 拦截 → 空卡/卡片搬运）；失败则 content 维持原文，由 R1 拦截兜底返回 summary。
        // v8 路线1 + 2026-08-12 修订：官方源（official_rss）同样走 interpretNews——
        //   A.4/A.5 允许官方 RSS 抓正文作 AI 加工源；AI 解读是加工产物（非原文复述），可落库展示。
        //   但 contentSource **保持 'official_rss'**（前端「出处 ↗」+ R1 放行依赖它），
        //   解读正文写 content、观点写 aiOpinion；解读失败则 content 维持原文（版权红线：落库前清空）。
        // 2026-08-13 修复：解读需 25s 预算，置于摘要之后并加预算守卫——剩余 <28s 直接跳过，
        // 确保摘要（列表关键字段）已先跑完、不被解读挤掉；解读失败则 content 维持原文走 R1 兜底。
        if (enriched.contentSource !== 'ai_interpretation' && content && content.trim().length >= 50) {
          // 预算守卫：解读需 25s，剩余 <28s 跳过（保摘要已先完成）
          if (!deadline || Date.now() + 28000 <= deadline) {
            const interpretation = await Promise.race([
              interpretNews(content, item.title, enriched.references, item),
              new Promise(resolve => setTimeout(() => resolve(null), INTERPRET_TIMEOUT_MS)),
            ])
            if (interpretation && interpretation.text) {
              enriched.content = interpretation.text
              // 官方源保留 'official_rss'（前端出处 ↗），普通源标记 'ai_interpretation'
              if (!isOfficialRss) {
                enriched.contentSource = 'ai_interpretation'
              }
              // owner 8/12 拍板：把【一页说】观点拆成独立字段，供前端做独立卡片
              enriched.aiOpinion = interpretation.aiOpinion || ''
              console.log(`[enrich] ${item.id || ''} AI 独立解读成功（${interpretation.text.length}字｜读法=${interpretation.lensName}｜观点=${interpretation.withOpinion ? '有' : '无'}｜${interpretation.routeReason}｜src=${isOfficialRss ? 'official' : 'normal'}）`)
            } else {
              console.warn(`[enrich] ${item.id || ''} AI 解读失败/过短，保持原文走 R1 兜底`)
            }
          } else {
            console.warn(`[enrich] ${item.id || ''} 预算不足跳过 AI 解读（已保摘要，content 维持原文）`)
          }
        }

        // FS-03（2026-08-07 owner 裁定）：四级摘要降级 —— AI 摘要 → 原摘要(desc) → 正文第一段(content) → 标题(title)
        // FS-05（2026-08-09 owner 拍板）：兜底条件扩展 —— 任何"无 AI 摘要 + 有正文"都走首段，
        // 不再要求 summarySource === 'title'。修复场景：聚合接口返回"假 desc"（日期/来源名/标点），
        // 原本被判为有效 desc → 跳过兜底 → 前端直接展示假 desc。
        // 现在：summarySource !== 'ai' 且有 content → 一律取首段。
        // FS-09（2026-08-10 owner 反馈）：首段不合格时不能直接退 title ——
        // 很多新闻正文第一段是日期/来源/导语（如"2026年8月10日"、"本报讯"、"（记者 XXX）"），
        // 被判无效后应继续扫描后续段落，取第一个合格段落作为 content 档；
        // 只有所有段落都不合格才退 title 档。否则"有足够正文却展示标题"。
        if (summarySource !== 'ai' && content && content.length > 10) {
          const paragraphs = content
            .split('\n')
            .map(function (s) { return s.trim() })
            .filter(function (s) { return s.length > 0 })
          // FS-09（2026-08-10 owner 反馈）：首段不合格时不能直接退 title ——
          // 很多新闻正文第一段是日期/来源/导语（如"2026年8月10日"、"本报讯"、"（记者 XXX）"），
          // 被判无效后应继续扫描后续段落，取第一个合格段落作为 content 档；
          // 只有所有段落都不合格才退 title 档。否则"有足够正文却展示标题"。
          let contentParagraph = ''
          for (let pi = 0; pi < paragraphs.length; pi++) {
            if (isValidParagraph(paragraphs[pi], descCtx)) {
              contentParagraph = paragraphs[pi]
              break
            }
          }
          if (contentParagraph) {
            // FE-20260810-003：移除 150 字硬截断 —— 首段完整写库展示（句子不中途断裂）
            enriched.summary = contentParagraph
            summarySource = 'content'
          } else {
            // 所有段落都不合格（极端情况）→ 退到 title 档，由前端展示标题
            enriched.summary = item.title || ''
            summarySource = 'title'
          }
        }

        // v8 路线1 + 2026-08-12 修订（版权红线 A.4/A.5）：
        // 官方源 content（原文全文）仅作 AI 加工源数据。落库时区分两种情况：
        //   - AI 解读成功（content 已被 interpretNews 替换为加工产物）→ 保留 content 展示解读正文；
        //   - AI 解读失败（content 仍是原文全文）→ 先清空 raw 全文，再由下方「保正文兜底」回填短文本。
        // 2026-08-14 owner 拍板：凡通过质量门的新闻必须带正文（哪怕较短），禁止空 body；
        //   红线仍成立——只回填 AI 解读/AI 摘要/源站短导语(desc)/标题 等短文本，绝不回填 raw 全文。
        if (isOfficialRss && content && enriched.content === content) {
          enriched.content = ''
        }

        // ── #2 合规（owner 8/13 拍板：AI 摘要+解读处理完成即删 raw 原文）──
        // content 落库优先级：ai_interpretation(含官方 official_rss 解读产物) > ai_summary > 清空(绝不存 raw)
        // 官方源解读失败已在上方清空 content（仅留 summary+sourceUrl 跳源站）；此处兜底非官方源。
        if (enriched.contentSource !== 'ai_interpretation' && enriched.contentSource !== 'official_rss') {
          if (summarySource === 'ai' && enriched.summary) {
            enriched.content = enriched.summary
            enriched.contentSource = 'ai_summary'
            console.log(`[enrich] ${item.id || ''} 无 AI 解读→回退 AI 摘要为 content（ai_summary）`)
          } else if ((enriched.content || '').trim().length > 0) {
            console.warn(`[enrich] ${item.id || ''} 无 AI 产物，清空 raw 原文（不落库，合规删除）`)
            enriched.content = ''
          }
        }

        // 收尾归一化：防止任何路径把「已清空 content」仍标为 fetched（标签必须反映实际落库内容）
        if (enriched.contentSource === 'fetched' && (enriched.content || '').trim().length === 0) {
          enriched.contentSource = ''
        }
        if (enriched.contentSource === 'fetched' && summarySource === 'ai' && enriched.summary) {
          enriched.content = enriched.summary
          enriched.contentSource = 'ai_summary'
        }

        // ── 保正文兜底（owner 8/14 拍板）──
        // 凡通过质量门的新闻必须带正文，哪怕较短，禁止空 body（否则详情页空卡）。
        // 前提：上方已确保 raw 全文不入 content（官方解读失败清空 / 非官方无产物清空）。
        // 此处只回填「短文本」：AI 摘要 > 源站短导语(desc) > 标题；contentSource 必须落在
        // R1 放行名单（ai_interpretation / official_rss / ai_summary），否则详情页 R1 会把 body 清空。
        if (!(enriched.content || '').trim()) {
          const bodyFallback = (summarySource === 'ai' && enriched.summary)
            ? enriched.summary
            : (enriched.summary && enriched.summary !== item.title ? enriched.summary : (item.title || ''))
          if (bodyFallback) {
            enriched.content = bodyFallback
            enriched.contentSource = isOfficialRss ? 'official_rss' : 'ai_summary'
            console.log(`[enrich] ${item.id || ''} 保正文兜底：回填${isOfficialRss ? '官方短导语' : 'AI摘要/导语'}（非 raw 全文，contentSource=${enriched.contentSource}）`)
          }
        }

        enriched.summarySource = summarySource
        result[idx] = enriched
        // FS-CF3：成功项回调 → 调用方可立即单条写库（分批增量通道）
        if (typeof onEnriched === 'function') {
          try {
            await onEnriched(enriched)
          } catch (cbErr) {
            // 回调失败不阻断流水线（写库异常由 batchInsert 内部兜底计数）
            console.warn(`[enrich] ${item.id || ''} onEnriched 回调失败:`, cbErr && cbErr.message || cbErr)
          }
        }
      } catch (err) {
        result[idx] = { ...item, summarySource: 'title' } // 失败保留原样（不入库，不回调）
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, cleanedNewsList.length) }, () => worker())
  await Promise.all(workers)
  return result
}
