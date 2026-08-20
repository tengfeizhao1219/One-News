// beijingTime.js —— 系统统一北京时间工具
// ============================================================
// 背景：云函数（SCF/CloudBase）运行环境时区为 UTC。直接用 getHours()/getFullYear()
//       等本地读取会拿到 UTC 值，比北京时间慢 8 小时，导致：
//         - 时间「显示」错误（如"数据截至"慢 8h）
//         - 时间「逻辑」错误（调度档位判断、按日配额、日期键归组）
// 规则（2026-08-20 统一）：
//   - 存储一律用 UTC（new Date().toISOString() / epoch ms），与平台一致
//   - 所有「面向用户显示 / 按北京时间判断」的地方，一律经本模块取北京值
//   - 前端（小程序）运行时区 = 用户手机（中国 +8），本地即北京，无需转换；
//     本模块仅供云函数/后端使用
// ============================================================

const BJ_OFFSET = 8 * 60 * 60 * 1000 // 东八区毫秒偏移

const pad = (n) => String(n).padStart(2, '0')

/** 内部：任意输入（Date / ISO 字符串 / epoch ms）→ Date；无效返回 null */
function toDate(input = new Date()) {
  const d = input instanceof Date ? input : new Date(input)
  return isNaN(d.getTime()) ? null : d
}

/** 把任意时刻投影到「北京时区下同一时刻」的 Date（其 getUTC* 即北京值） */
function asBeijing(d) {
  return new Date(d.getTime() + BJ_OFFSET)
}

/** 当前北京时间 Date（用其 getUTC* 读取北京值） */
function beijingNow(input = new Date()) {
  const d = toDate(input)
  return d ? asBeijing(d) : null
}

/** 北京日期字符串 YYYY-MM-DD（按北京时间日切） */
function beijingDateKey(input = new Date()) {
  const d = toDate(input)
  if (!d) return ''
  const b = asBeijing(d)
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`
}

/** 北京小时 0-23（按北京时间判断档位/时段） */
function beijingHour(input = new Date()) {
  const d = toDate(input)
  return d ? asBeijing(d).getUTCHours() : -1
}

/** ISO/ms/Date → 北京 HH:MM 显示 */
function formatHHMM(input) {
  const d = toDate(input)
  if (!d) return ''
  const b = asBeijing(d)
  return `${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`
}

/** ISO/ms/Date → 北京 YYYY-MM-DD HH:MM（完整显示） */
function formatBeijingDateTime(input) {
  const d = toDate(input)
  if (!d) return ''
  const b = asBeijing(d)
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())} ${pad(b.getUTCHours())}:${pad(b.getUTCMinutes())}`
}

module.exports = {
  BJ_OFFSET,
  beijingNow,
  beijingDateKey,
  beijingHour,
  formatHHMM,
  formatBeijingDateTime,
}
