// INTEL-MODULE: AI 情报官 · 前端渲染辅助
// ============================================================
// 隔离说明：本文件为 AI 情报模块新增，独立于 One News 既有业务；intel_ 命名空间。
// 职责：把云函数 getIntelBrief 返回的 focusItems / tryable 格式化为首页卡片流可渲染结构。
// 摘除方式：删除本文件 + 页面内引用即可，不影响 One News。
// ============================================================

/**
 * 把云函数 focusItems（intel_current.isCurrent 当期 brief 里的「今日关注」）
 * 转成首页卡片流 / intel-stage 横滑屏统一可渲染的卡片结构。
 * 字段约定对齐 backend/intelBrief 云函数输出。
 * @param {Array} focusItems focusItems 原始数组（可能为空 / undefined）
 * @returns {Array<{id,title,desc,src,time,contract,sceneTags,rank}>}
 */
function toCards(focusItems) {
  return (focusItems || []).map((it) => ({
    id: it.id || it.itemId || '',
    title: it.title || '',
    desc: it.definition || it.sceneMapping || '',   // 卡片副文本：一句话定义兜底
    src: it.sourceName || '',
    time: it.publishedAt ? formatLabel(it.publishedAt) : '',
    contract: it.contract === true,
    sceneTags: it.sceneTags || [],
    rank: it.rank || 0,
  }))
}

// RFC 2822（RSS publishedAt 常见格式，如 "Tue, 18 Aug 2026 21:41:10 GMT"）
// iOS 的 JS 引擎不支持该格式：new Date 会得 Invalid Date 并在 DevTools 报警告，
// 故先识别再手动解析，不喂给 new Date。
const RFC2822_RE = /^[A-Za-z]{3},\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(GMT|UTC|[+-]\d{4})?$/

/**
 * 解析日期字符串为 Date。
 * 优先标准 new Date；RFC 2822 格式手动解析兜底（含 GMT/UTC/±HHMM 时区）。
 * @param {string} iso
 * @returns {Date} 无法解析时返回 Invalid Date
 */
function parseDate(iso) {
  const s = String(iso || '').trim()
  if (!s) return new Date(NaN)
  const m = RFC2822_RE.exec(s)
  if (m) {
    const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
    const mon = MON[m[2]]
    if (mon !== undefined) {
      let offsetMin = 0
      const tz = m[7]
      if (tz && /^[+-]\d{4}$/.test(tz)) {
        offsetMin = (parseInt(tz.slice(0, 3), 10) * 60 + parseInt(tz.slice(3), 10)) * (tz[0] === '-' ? -1 : 1)
      }
      return new Date(Date.UTC(+m[3], mon, +m[1], +m[4], +m[5], +(m[6] || 0)) - offsetMin * 60000)
    }
    return new Date(NaN)
  }
  try {
    const d = new Date(s)
    if (!Number.isNaN(d.getTime())) return d
  } catch (e) {}
  return new Date(NaN)
}

/**
 * 把 ISO 时间字符串格式化为「今天 HH:MM」/「MM-DD HH:MM」人读标签。
 * 当天数据 → 「今天 HH:MM」；跨天数据（昨天/更早）→ 「MM-DD HH:MM」，
 * 避免把昨天的数据误标成「今天」造成日期混乱。
 * @param {string} iso ISO 字符串
 * @returns {string}
 */
function formatLabel(iso) {
  try {
    const d = parseDate(iso)
    if (Number.isNaN(d.getTime())) return ''
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const now = new Date()
    const sameDay = d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    if (sameDay) return `今天 ${hh}:${mm}`
    const mon = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${mon}-${day} ${hh}:${mm}`
  } catch (e) { return '' }
}

/**
 * 计算底部安全区高度（px）：windowHeight - safeArea.bottom。
 * 2026-08-19：真机 WXSS 的 env(safe-area-inset-bottom) 疑似未生效（带 env 的 calc
 * 声明被丢弃，底部避让全失效），改用 JS 计算并注入 CSS 变量 --safe-bottom，
 * 与 --menu-top/--page-h 同机制（本应用已验证可靠）。
 * @returns {number} 底部安全区 px，无法获取时返回 0
 */
function getSafeBottom() {
  try {
    const win = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const safe = win.safeArea || null
    if (safe && win.windowHeight) {
      const inset = win.windowHeight - safe.bottom
      if (inset > 0) return inset
    }
  } catch (e) {}
  return 0
}

module.exports = { toCards, formatLabel, getSafeBottom }
