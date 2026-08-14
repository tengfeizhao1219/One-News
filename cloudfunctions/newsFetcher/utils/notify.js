/**
 * notify.js — 告警推送（企微机器人 Webhook）
 * ============================================================
 * 对齐方案 §6：单源连续空(errorStreak≥3)、重复率>50%、入库量异常。
 * 渠道：企微机器人 Webhook（key 从云环境变量 / SECRETS 读取，不硬编码）。
 * 去抖：同一告警项 1 小时内不重复轰炸（内存 Map 记录上次告警时间）。
 * ============================================================
 */

const WEBHOOK_KEY = process.env.WECHAT_WEBHOOK_KEY || process.env.QR_WEBHOOK_KEY || ''

// 去抖表：key -> lastTs
const _debounce = new Map()
const DEBOUNCE_MS = 60 * 60 * 1000

/**
 * 是否允许发送该告警项（去抖判断）。
 */
function canSend(key) {
  const last = _debounce.get(key) || 0
  const now = Date.now()
  if (now - last < DEBOUNCE_MS) return false
  _debounce.set(key, now)
  return true
}

/**
 * 发送企微 markdown/text 告警。
 * @param {string} text - 告警正文
 * @param {Object} [options]
 * @param {string} [options.dedupKey] - 去抖 key；不传则每次都发
 * @returns {Promise<boolean>} 是否成功发出
 */
async function sendAlert(text, options = {}) {
  const dedupKey = options.dedupKey
  if (dedupKey && !canSend(dedupKey)) return false // 去抖命中，不发

  const payload = { msgtype: 'markdown', markdown: { content: `### OneNews RSS 告警\n${text}` } }

  if (!WEBHOOK_KEY) {
    // 未配置 webhook：告警降级为日志，不阻断流程
    console.warn('[notify] 未配置 WECHAT_WEBHOOK_KEY，告警仅落日志:', text)
    return false
  }

  return new Promise((resolve) => {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${WEBHOOK_KEY}`
    const https = require('https')
    const body = JSON.stringify(payload)
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      timeout: 8000,
    }, (res) => {
      res.resume()
      resolve(res.statusCode >= 200 && res.statusCode < 300)
    })
    req.on('error', () => resolve(false))
    req.on('timeout', () => { req.destroy(); resolve(false) })
    req.write(body)
    req.end()
  })
}

module.exports = { sendAlert, canSend }
