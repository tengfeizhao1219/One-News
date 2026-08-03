/**
 * 内容安全审核模块 — B-02
 *
 * 接入微信小程序内容安全 API：
 *   - msgSecCheck：文本内容安全检测
 *   - imgSecCheck：图片内容安全检测（预留）
 *
 * 策略（来自 T-04 技术评审 + AC-RQ10）：
 *   1. 命中拦截：检测到违规 → 立即拦截，不写入缓存
 *   2. API 不可用保守策略：连续 3 次调用失败 → 降级放行（宁可误放，不阻断新闻流）
 *   3. 告警：命中率 > 20% 或 API 连续不可用 → 日志告警
 *   4. sync_logs：每条审核结果写入 audit log（cloudfunction 日志即可，不额外建表）
 *
 * 依赖：wx-server-sdk（cloud.init() 需在调用方完成）
 *
 * @module securityCheck
 */

// ── 状态机 ──────────────────────────────────────────────

const STATE = {
  NORMAL: 'normal',           // 正常
  DEGRADED: 'degraded',       // API 不可用，降级放行
  DISABLED: 'disabled',       // 手动禁用（百炼 Key 搁置等同理）
}

const FAIL_THRESHOLD = 3       // 连续失败 N 次 → 降级
const HIT_RATE_ALERT = 0.2     // 命中率 > 20% → 告警
const MAX_TEXT_LENGTH = 500    // 微信 msgSecCheck 单次文本上限（约 500 字，取保守值）

class SecurityCheck {
  constructor(options = {}) {
    this._failCount = 0
    this._totalChecked = 0
    this._totalBlocked = 0
    this._state = STATE.NORMAL
    this._failThreshold = options.failThreshold || FAIL_THRESHOLD
  }

  // ── 公开 API ──────────────────────────────────────────

  /** 当前状态 */
  get state() { return this._state }

  /** 统计信息 */
  get stats() {
    return {
      state: this._state,
      totalChecked: this._totalChecked,
      totalBlocked: this._totalBlocked,
      failCount: this._failCount,
      hitRate: this._totalChecked > 0
        ? (this._totalBlocked / this._totalChecked).toFixed(2)
        : '0.00',
    }
  }

  /**
   * 文本安全检测
   *
   * @param {string} content - 待检测文本（标题 + 摘要拼接，≤500 字）
   * @returns {Promise<{pass: boolean, risk: string|null}>}
   *   - pass=true  → 安全，可写入
   *   - pass=false → 违规，应拦截
   *   - risk 标签：'risky'(违规) / 'degraded'(降级放行) / null
   */
  async checkText(content) {
    // 降级模式：直接放行
    if (this._state === STATE.DEGRADED || this._state === STATE.DISABLED) {
      return { pass: true, risk: 'degraded' }
    }

    // 空内容直接放行
    if (!content || !content.trim()) {
      return { pass: true, risk: null }
    }

    const text = content.trim().slice(0, MAX_TEXT_LENGTH)

    try {
      const cloud = require('wx-server-sdk')
      const result = await cloud.openapi.security.msgSecCheck({ content: text })

      this._totalChecked++

      // errCode 0 = 通过
      if (result.errCode === 0) {
        this._failCount = 0 // 重置连续失败计数
        return { pass: true, risk: null }
      }

      // errCode 87014 = 内容违规
      if (result.errCode === 87014) {
        this._totalBlocked++
        this._failCount = 0
        this._checkAlert()
        return { pass: false, risk: 'risky' }
      }

      // 其他错误码 → 视为 API 异常，保守放行
      console.warn(`[SecurityCheck] msgSecCheck 返回异常 errCode=${result.errCode} errMsg=${result.errMsg}`)
      this._failCount = 0
      return { pass: true, risk: 'unknown_error' }

    } catch (err) {
      this._failCount++
      console.error(`[SecurityCheck] msgSecCheck 调用失败 (${this._failCount}/${this._failThreshold}):`, err.message)

      // 连续失败达阈值 → 降级
      if (this._failCount >= this._failThreshold) {
        this._state = STATE.DEGRADED
        console.error(`[SecurityCheck] ⚠️ 连续 ${this._failThreshold} 次失败，降级放行`)
      }

      // 保守策略：API 不可用时放行（宁可误放，不阻断新闻流）
      return { pass: true, risk: 'degraded' }
    }
  }

  /**
   * 批量文本检测（v5.1：改为分批并行，避免 42 条串行调用超 3s 限制）
   *
   * @param {Array<{id: string, title: string, summary?: string}>} items
   * @returns {Promise<{passed: Array, blocked: Array, stats: object}>}
   */
  async checkBatch(items) {
    const passed = []
    const blocked = []
    const BATCH_SIZE = 10

    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      const batch = items.slice(i, i + BATCH_SIZE)
      const results = await Promise.all(batch.map(async (item) => {
        const text = [item.title, item.summary].filter(Boolean).join(' ')
        const result = await this.checkText(text)
        return { item, result }
      }))

      for (const { item, result } of results) {
        if (result.pass) {
          passed.push(item)
        } else {
          console.warn(`[SecurityCheck] 拦截: [${item.id}] "${item.title?.slice(0, 40)}" — risk=${result.risk}`)
          blocked.push({ ...item, _risk: result.risk })
        }
      }
    }

    return {
      passed,
      blocked,
      stats: this.stats,
    }
  }

  /**
   * 图片安全检测（预留）
   *
   * @param {string} mediaUrl - 图片临时 URL
   * @returns {Promise<{pass: boolean, risk: string|null}>}
   */
  async checkImage(mediaUrl) {
    if (this._state === STATE.DEGRADED || this._state === STATE.DISABLED) {
      return { pass: true, risk: 'degraded' }
    }

    if (!mediaUrl) return { pass: true, risk: null }

    try {
      const cloud = require('wx-server-sdk')
      const result = await cloud.openapi.security.imgSecCheck({
        media: { contentType: 'image/jpeg', value: mediaUrl },
      })

      if (result.errCode === 0) {
        this._failCount = 0
        return { pass: true, risk: null }
      }

      if (result.errCode === 87014) {
        this._totalBlocked++
        this._checkAlert()
        return { pass: false, risk: 'risky' }
      }

      return { pass: true, risk: 'unknown_error' }
    } catch (err) {
      this._failCount++
      if (this._failCount >= this._failThreshold) {
        this._state = STATE.DEGRADED
      }
      return { pass: true, risk: 'degraded' }
    }
  }

  /** 重置状态（手动恢复） */
  reset() {
    this._state = STATE.NORMAL
    this._failCount = 0
    this._totalChecked = 0
    this._totalBlocked = 0
  }

  // ── 私有 ──────────────────────────────────────────────

  _checkAlert() {
    const hitRate = this._totalChecked > 0
      ? this._totalBlocked / this._totalChecked
      : 0
    if (hitRate > HIT_RATE_ALERT) {
      console.warn(`[SecurityCheck] ⚠️ 命中率告警: ${(hitRate * 100).toFixed(1)}% (${this._totalBlocked}/${this._totalChecked})`)
    }
  }
}

module.exports = { SecurityCheck, STATE }
