// 通用工具函数

/**
 * 格式化时间为相对时间
 * @param {Date|string} dateStr 日期
 * @returns {string} 如 "3小时前"
 */
function formatRelativeTime(dateStr) {
  const now = Date.now()
  const date = new Date(dateStr).getTime()
  const diff = now - date

  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour

  if (diff < minute) return '刚刚'
  if (diff < hour) return Math.floor(diff / minute) + '分钟前'
  if (diff < day) return Math.floor(diff / hour) + '小时前'
  if (diff < 3 * day) return Math.floor(diff / day) + '天前'

  const d = new Date(dateStr)
  const month = d.getMonth() + 1
  const dayNum = d.getDate()
  return month + '月' + dayNum + '日'
}

/**
 * 防抖
 */
function debounce(fn, delay = 300) {
  let timer = null
  return function (...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
}

/**
 * 节流
 */
function throttle(fn, delay = 100) {
  let last = 0
  return function (...args) {
    const now = Date.now()
    if (now - last >= delay) {
      last = now
      fn.apply(this, args)
    }
  }
}

module.exports = {
  formatRelativeTime,
  debounce,
  throttle
}
