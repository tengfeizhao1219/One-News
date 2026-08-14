/**
 * feedback/create — 提交留言 / 回复（RQ-22-FS）
 *
 * 接口约定（开发交接单 FS §四 · PRD §5.2）：
 *   入参：{ content, parentId? }
 *   出参：成功 { code: 0, data: {...} }
 *         违规 { code: 'BLOCKED', data: { reason } }
 *
 * 流程：
 *   1. 获取 openid，校验参数
 *   2. 频率限制（30s/条）
 *   3. 关键词黑名单过滤
 *   4. AI 语义校验（智谱 GLM-4-Flash → 降级 DeepSeek；超时/失败仅黑名单兜底放行）
 *   5. 昵称生成（微信用户+随机4位 / 作者「一页君」，同 openid 复用）
 *   6. 写入 feedback 集合（parentId 区分留言/回复，rootId 楼中楼归属）
 *
 * @module feedback/create
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// ── 常量 ──────────────────────────────────────────────

const RATE_LIMIT_MS = 30 * 1000        // 30s 限频
const AI_TIMEOUT_MS = 8000             // AI 校验超时
const MAX_REPLY_DEPTH = 4              // 楼中楼最深 4 级（超出后 rootId 沿用顶层，前端收平）

const ZHIPU_MODEL = 'glm-4-flash'
const ZHIPU_BASE = 'open.bigmodel.cn'
const ZHIPU_PATH = '/api/paas/v4/chat/completions'
const DEEPSEEK_BASE = 'api.deepseek.com'
const DEEPSEEK_PATH = '/chat/completions'

// ── 关键词黑名单（PRD §4.4 · 敏感词过滤表） ─────────────
// 覆盖五大类：涉黄 / 涉政 / 暴力 / 辱骂 / 广告 spam
// 权威单一真相源：utils/sensitiveWords.js（与 newsPipeline ⑥ 硬门禁共用，避免漂移）

const { SENSITIVE_WORDS, matchSensitiveWord } = require('./utils/sensitiveWords')

// ── 作者识别（PRD §4.3.2 · 已确认） ────────────────────
// 环境变量 AUTHOR_OPENID（云开发控制台 → 云函数 feedback/* → 环境变量）

function getAuthorOpenid() {
  return (process.env.AUTHOR_OPENID || '').trim()
}

function isAuthorOpenid(openid) {
  const author = getAuthorOpenid()
  return !!author && openid === author
}

// ── 关键词过滤 ────────────────────────────────────────

function keywordFilter(content) {
  const hit = matchSensitiveWord(content)
  if (hit) {
    return { passed: false, reason: `内容包含违规词「${hit}」` }
  }
  return { passed: true, reason: '' }
}

// ── AI 校验（智谱优先 → DeepSeek 降级） ────────────────

function httpsRequest({ hostname, path, headers, body, timeout }) {
  const https = require('https')
  return new Promise((resolve) => {
    const req = https.request({ hostname, path, method: 'POST', headers, timeout }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => {
        try { resolve({ ok: true, body: JSON.parse(data) }) }
        catch (e) { resolve({ ok: false, body: data }) }
      })
    })
    req.on('error', () => resolve({ ok: false, body: '' }))
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, body: '' }) })
    req.write(body)
    req.end()
  })
}

const MODERATION_SYSTEM_PROMPT = [
  '你是内容安全审核助手。判断用户留言是否包含违规内容。',
  '违规类型：涉黄、涉政敏感、暴力恐吓、辱骂人身攻击、广告 spam 引流。',
  '仅返回 JSON：{"safe": true/false, "reason": "简述违规原因"}，不要输出其他内容。',
  'safe=true 表示安全，safe=false 表示违规。',
].join(' ')

async function aiValidateWithZhipu(content) {
  const apiKey = process.env.ZHIPU_API_KEY || ''
  if (!apiKey) return { ok: false, reason: 'no_zhipu_key' }

  const body = JSON.stringify({
    model: ZHIPU_MODEL,
    messages: [
      { role: 'system', content: MODERATION_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    temperature: 0,
    max_tokens: 200,
  })

  const res = await httpsRequest({
    hostname: ZHIPU_BASE,
    path: ZHIPU_PATH,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
    timeout: AI_TIMEOUT_MS,
  })

  if (!res.ok || !res.body) return { ok: false, reason: 'zhipu_request_failed' }
  const raw = res.body.choices?.[0]?.message?.content || ''
  const match = raw.match(/\{[\s\S]*"safe"[\s\S]*\}/)
  if (!match) return { ok: false, reason: 'zhipu_parse_failed' }
  try {
    const parsed = JSON.parse(match[0])
    return { ok: true, safe: parsed.safe !== false, reason: parsed.reason || '' }
  } catch (e) {
    return { ok: false, reason: 'zhipu_parse_failed' }
  }
}

async function aiValidateWithDeepSeek(content) {
  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  if (!apiKey) return { ok: false, reason: 'no_deepseek_key' }

  const body = JSON.stringify({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: MODERATION_SYSTEM_PROMPT },
      { role: 'user', content },
    ],
    temperature: 0,
    max_tokens: 200,
  })

  const res = await httpsRequest({
    hostname: DEEPSEEK_BASE,
    path: DEEPSEEK_PATH,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body,
    timeout: AI_TIMEOUT_MS,
  })

  if (!res.ok || !res.body) return { ok: false, reason: 'deepseek_request_failed' }
  const raw = res.body.choices?.[0]?.message?.content || ''
  const match = raw.match(/\{[\s\S]*"safe"[\s\S]*\}/)
  if (!match) return { ok: false, reason: 'deepseek_parse_failed' }
  try {
    const parsed = JSON.parse(match[0])
    return { ok: true, safe: parsed.safe !== false, reason: parsed.reason || '' }
  } catch (e) {
    return { ok: false, reason: 'deepseek_parse_failed' }
  }
}

/**
 * AI 语义校验：智谱优先，失败降级 DeepSeek。
 * 两者均不可用（超时/失败/无 Key）→ 返回 safe=true，仅黑名单兜底放行（owner 已确认）。
 */
async function aiValidate(content) {
  const z = await aiValidateWithZhipu(content)
  if (z.ok) return { safe: z.safe, reason: z.reason }
  const d = await aiValidateWithDeepSeek(content)
  if (d.ok) return { safe: d.safe, reason: d.reason }
  console.warn('[feedback/create] AI 校验均不可用，仅黑名单兜底放行')
  return { safe: true, reason: '' }
}

// ── 频率限制 ──────────────────────────────────────────

async function checkRateLimit(openid) {
  const cutoff = Date.now() - RATE_LIMIT_MS
  try {
    const res = await db.collection('feedback')
      .where({ openid, createdAt: _.gte(cutoff) })
      .count()
    return res.total === 0
  } catch (e) {
    console.error('[feedback/create] 频率限制查询失败:', e.message)
    return true // 查询失败放行，不阻断用户
  }
}

// ── 昵称生成（PRD §4.3.4） ────────────────────────────

const RANDOM_CHARS = '0123456789abcdef'

function randomSuffix() {
  let s = ''
  for (let i = 0; i < 4; i++) {
    s += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)]
  }
  return s
}

/** 获取 openid 已使用的昵称；无则生成新昵称并返回 */
async function getOrCreateNickname(openid, isAuthor) {
  if (isAuthor) return '一页君'
  try {
    const res = await db.collection('feedback')
      .where({ openid })
      .limit(1)
      .get()
    if (res.data && res.data.length > 0 && res.data[0].nickname) {
      return res.data[0].nickname
    }
  } catch (e) {
    console.warn('[feedback/create] 昵称查询失败，生成新昵称:', e.message)
  }
  return '微信用户 ' + randomSuffix()
}

// ── 主流程 ────────────────────────────────────────────

exports.main = async (event) => {
  const openid = cloud.getWXContext().OPENID
  if (!openid) {
    return { code: -1, message: '无法获取用户身份' }
  }

  const content = (event.content || '').trim()
  const parentId = event.parentId ? String(event.parentId) : null

  // 1. 参数校验（Q1 已确认：不限字数，仅非空校验）
  if (!content) {
    return { code: -1, message: '内容不能为空' }
  }

  // 2. 频率限制（30s/条）
  const allowed = await checkRateLimit(openid)
  if (!allowed) {
    return { code: 0, data: { rateLimited: true, message: '发送太快，请稍后再试' } }
  }

  // 3. 关键词黑名单
  const kw = keywordFilter(content)
  if (!kw.passed) {
    console.warn(`[feedback/create] 关键词拦截: "${content.slice(0, 60)}" — ${kw.reason}`)
    return { code: 'BLOCKED', data: { reason: kw.reason } }
  }

  // 4. AI 语义校验
  const ai = await aiValidate(content)
  if (!ai.safe) {
    console.warn(`[feedback/create] AI 拦截: "${content.slice(0, 60)}" — ${ai.reason}`)
    return { code: 'BLOCKED', data: { reason: ai.reason || '内容不合规' } }
  }

  const now = Date.now()
  const author = isAuthorOpenid(openid)
  const nickname = await getOrCreateNickname(openid, author)

  // 5. 计算 rootId（楼中楼归属）
  let rootId = null
  if (parentId) {
    try {
      const parentRes = await db.collection('feedback').doc(parentId).get()
      const parent = parentRes.data
      if (!parent) {
        return { code: -1, message: '回复的留言不存在' }
      }
      // 父留言的 rootId：顶层留言 rootId 为空 → 自身即 root；回复 → 沿用其 rootId
      rootId = parent.rootId || parent._id
    } catch (e) {
      return { code: -1, message: '回复的留言不存在' }
    }
  }

  // 6. 写入数据库
  try {
    const docData = {
      parentId,
      rootId,
      content,
      openid,
      nickname,
      isAuthor: author,
      status: 'visible',
      createdAt: now,
      updatedAt: now,
    }
    const addRes = await db.collection('feedback').add({ data: docData })

    return {
      code: 0,
      data: {
        _id: addRes._id,
        ...docData,
      },
    }
  } catch (err) {
    console.error('[feedback/create] 写入失败:', err.message)
    return { code: -1, message: `提交失败: ${err.message}` }
  }
}
