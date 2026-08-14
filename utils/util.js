// 通用工具函数

/**
 * 格式化时间为相对时间
 * @param {Date|string} dateStr 日期
 * @returns {string} 如 "3小时前"
 */
function formatRelativeTime(dateStr) {
  const d = new Date(dateStr)
  const ts = d.getTime()
  // 防御：dateStr 为空/非日期/不可解析时，不渲染乱码（避免 "NaN月NaN日"）
  if (!dateStr || Number.isNaN(ts)) return ''

  const now = Date.now()
  const diff = now - ts

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return Math.floor(diff / minute) + '分钟前'
  if (diff < day) return Math.floor(diff / hour) + '小时前'
  if (diff < 3 * day) return Math.floor(diff / day) + '天前'

  const month = d.getMonth() + 1
  const dayNum = d.getDate()
  return month + '月' + dayNum + '日'
}

/**
 * 浏览记录相对时间（TL-B14 / UI-03）
 * 今天 → HH:mm；昨天 → 昨天；2~7 天 → N 天前；超过 7 天 → ''（不展示）
 * @param {number} ts 毫秒时间戳
 * @returns {string}
 */
function formatBrowseTime(ts) {
  if (!ts) return ''
  const now = new Date()
  const d = new Date(ts)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000
  const diffDays = Math.floor((startOfToday - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / (24 * 60 * 60 * 1000))

  if (ts >= startOfToday) {
    // 今天：HH:mm
    const hh = ('0' + d.getHours()).slice(-2)
    const mm = ('0' + d.getMinutes()).slice(-2)
    return hh + ':' + mm
  }
  if (ts >= startOfYesterday) return '昨天'
  if (diffDays >= 2 && diffDays <= 7) return diffDays + '天前'
  return '' // 超过 7 天不展示
}

/**
 * 浏览记录是否过期（> 7 天）
 * @param {number} ts 毫秒时间戳
 * @returns {boolean}
 */
function isBrowseExpired(ts) {
  if (!ts) return true
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
  return Date.now() - ts > SEVEN_DAYS
}

module.exports = {
  formatRelativeTime,
  formatBrowseTime,
  isBrowseExpired,
}
