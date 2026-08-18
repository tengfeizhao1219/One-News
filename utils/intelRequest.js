// 请求层封装 · AI 情报官（intel_* 命名空间隔离）
//
// ⚠️ 复用 One News utils/request.js 的「wx.cloud.callFunction 云函数调用」范式（非其业务），
//    intel_* 命名空间隔离，可整体摘除；不触碰 One News 阅读数据请求层。
//
// 调用的云函数：getIntelBrief（backend/intelBrief/，读 intel_current isCurrent 当期 Brief，
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
function getIntelBrief({ channel = 'oneNews', date } = {}) {
  return wx.cloud.callFunction({
    name: 'getIntelBrief',
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
    return {
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

module.exports = { getIntelBrief }
