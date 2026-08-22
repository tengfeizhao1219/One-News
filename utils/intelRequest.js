// 请求层封装 · AI 情报官（intel_* 命名空间隔离）
//
// ⚠️ 复用 One News utils/request.js 的「wx.cloud.callFunction 云函数调用」范式（非其业务），
//    intel_* 命名空间隔离，可整体摘除；不触碰 One News 阅读数据请求层。
//
// 调用的云函数：intelBrief（backend/intelBrief/，读 intel_current isCurrent 当期 Brief，
//    经 Channels 层 OneNewsChannel 渲染为 payload：今日关注 + 本周可试用 + 数据截至 + 源健康）。
//
// 数据契约（OneNewsChannel.render 输出）：
//   {
//     ok, channel, date, version, mode,
//     dataAsOf: { hhmm, generatedAt, label },     // 「数据截至 HH:MM」
//     focusItems: [今日关注卡片],                  // SOP 五步 + 场景标签 + 最小行动
//     tryable: [本周可试用清单],                    // 可勾选
//     health: { level, title, detail } | null,     // 源健康提示（§7.7 待验证）
//     hasContent, empty: { message }?              // 空态占位
//   }

/**
 * 拉取当期 AI 情报 Brief。
 * @param {Object} opts
 * @param {string} [opts.channel='oneNews']  渠道（本期仅 oneNews；预留 wechat/whatsapp）
 * @param {string} [opts.date]                可选：读历史某期；缺省读当期
 * @returns {Promise<Object>} 渲染后的 payload（未到发布时刻/空态时 hasContent=false）
 */
// 2026-08-20 修复：brief 5 分钟内存缓存声明必须在注释块外（原误插进 JSDoc 内 → 变量未声明 → getIntelBrief 抛 ReferenceError → 前端显示"本期暂无内容"）
let _briefCache = { ts: 0, data: null }
const BRIEF_TTL = 5 * 60 * 1000

/** 2026-08-22：失效 brief 缓存（手动刷新/手动管线完成后调用，避免 5min 内看到旧 brief） */
function invalidateIntelBrief() {
  _briefCache = { ts: 0, data: null }
}

function getIntelBrief({ channel = 'oneNews', date } = {}) {
  if (!date && _briefCache.data && Date.now() - _briefCache.ts < BRIEF_TTL) {
    return Promise.resolve(_briefCache.data)  // 缓存命中（仅当期）
  }
  return wx.cloud.callFunction({
    name: 'intelBrief',
    data: { channel, date },
  }).then((res) => {
    const result = res.result || {}
    if (result.code !== 0) {
      const err = new Error(result.message || '获取AI情报失败')
      err.errorCode = result.errorCode
      throw err
    }
    const payload = result.data || {}
    // 防御性兜底：云函数字段缺失时仍返回可控结构，避免上层解构崩
    const data = {
      ok: payload.ok !== false,
      channel: payload.channel || channel,
      date: payload.date || '',
      version: payload.version || 0,
      mode: payload.mode || '',
      dataAsOf: payload.dataAsOf || { hhmm: '', generatedAt: '', label: '' },
      focusItems: (payload.focusItems || []).map(normalizeFocusItem),
      tryable: (payload.tryable || []).map(normalizeTryable),
      health: payload.health || null,
      hasContent: !!payload.hasContent,
      empty: payload.empty || null,
      placeholder: !!payload.placeholder,
      banner: payload.banner || '',
    }
    if (!date) { _briefCache = { ts: Date.now(), data } }  // 仅缓存当期（省 Gateway 调用）
    return data
  })
}

/** 今日关注卡片：适配 Pages 用字段（OneNewsChannel 渲染输出） */
function normalizeFocusItem(it) {
  it = it || {}
  return {
    id: it.id || it.itemId || '',
    title: it.title || '',
    url: it.url || '',
    // SOP 五步（OneNewsChannel 已从 card Markdown 提取）
    definition: it.definition || '',
    sceneMapping: it.sceneMapping || '',
    practice: it.practice || '',
    minAction: it.minAction || '',
    card: it.card || '',                 // 完整五步 Markdown（详情页用）
    sourceName: it.sourceName || '',
    publishedAt: it.publishedAt || '',
    // 场景标签 + 相关度
    sceneTags: Array.isArray(it.sceneTags) ? it.sceneTags : [],
    sceneHits: it.sceneHits || 0,
    relevance: it.relevance || 'medium',
    contract: it.contract === true,
    rank: it.rank || 0,
  }
}

/** 本周可试用清单项（前端可勾选） */
function normalizeTryable(it) {
  it = it || {}
  return {
    id: it.id || it.itemId || '',
    title: it.title || '',
    minAction: it.minAction || '',
    url: it.url || '',
    done: it.done === true,
  }
}

/**
 * 读取当前用户画像（默认 owner）。
 * @param {string} [userId] 可选 userId，缺省 'owner'
 * @returns {Promise<Object|null>} 画像对象；无画像时返回 null
 */
function getIntelProfile(userId) {
  return wx.cloud.callFunction({
    name: 'intelProfile',
    data: { action: 'get', userId },
  }).then((res) => {
    const result = res.result || {}
    if (result.code !== 0) {
      const err = new Error(result.message || '获取画像失败')
      err.errorCode = result.errorCode
      throw err
    }
    return result.data || null
  })
}

/**
 * 保存（upsert）当前用户画像。
 * @param {Object} profile 完整画像对象（identities/focusTags/depth/langPref/consentSigned 等）
 * @returns {Promise<Object>} 落库后的画像（含 _id + updatedAt）
 */
function saveIntelProfile(profile) {
  return wx.cloud.callFunction({
    name: 'intelProfile',
    data: { action: 'save', profile },
  }).then((res) => {
    const result = res.result || {}
    if (result.code !== 0) {
      const err = new Error(result.message || '保存画像失败')
      err.errorCode = result.errorCode
      throw err
    }
    return result.data || null
  })
}

module.exports = { getIntelBrief, getIntelProfile, saveIntelProfile, invalidateIntelBrief }
