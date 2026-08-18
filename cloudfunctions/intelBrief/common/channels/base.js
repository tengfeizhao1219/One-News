/**
 * base.js — Channels 渠道适配层 · 抽象基类（T4.x / D 推送/UI）
 * ============================================================
 * ⚠️ intel_* 命名空间隔离，可整体摘除。复用 One News 基础设施（非其业务）。
 *
 * 责任边界（设计 §7.1 / §7.6 / §7.8）：
 *   - Dispatcher 产出结构化 RenderedIssue / Brief（intel_current 文档，§8.2）。
 *   - Channel 只在「端适配」：把同一份 Brief 渲染成**具体渠道**的载荷/payload。
 *   - 本期仅实现 One News 小程序（决策 D3）；将来接微信/WhatsApp 只需
 *     新增 WeChatChannel / WhatsAppChannel，Dispatcher 与 Brief 结构不变。
 *
 * 本文件定义渠道统一协议（接口），不承载任何 One News 特有逻辑；
 * One News 特化在 oneNewsChannel.js，微信/WhatsApp 特化留待后续新建。
 *
 * 统一协议（每个渠道实现以下能力）：
 *   channelId: string          // 渠道稳定 ID（'oneNews' | 'wechat' | 'whatsapp'）
 *   supports(payload): boolean // 判断该渠道能否投递/渲染某载荷
 *   render(brief): payload     // 把 Brief 渲染为渠道可消费的 payload
 *   health(brief): object      // 从 Brief 提炼源健康提示（§7.7）
 * ============================================================
 */

/** 抽象基类：定义协议桩 + 公共工具（不直接实例化） */
class IntelChannel {
  /** 强制抽象：禁止直接 new IntelChannel() */
  constructor() {
    if (new.target === IntelChannel) {
      throw new Error('[IntelChannel] 抽象基类不可直接实例化，请使用 OneNewsChannel 等具体渠道')
    }
  }

  /** 渠道稳定 ID —— 子类必须覆盖 */
  get channelId() {
    throw new Error('[IntelChannel] 子类必须实现 channelId')
  }

  /**
   * 判断该渠道能否渲染某载荷。
   * 默认按载荷标记渠道匹配；子类可按需扩写。
   * @param {object} payload
   * @returns {boolean}
   */
  supports(payload) {
    if (!payload || typeof payload !== 'object') return false
    // 载荷若自带渠道标记，优先按其匹配（多端独立开关，§7.8）
    if (payload && payload.channel) return payload.channel === this.channelId
    return true
  }

  /**
   * 把 Brief（intel_current 文档，§8.2）渲染为渠道 payload —— 子类必须实现。
   * @param {object} brief  一条 intel_current 文档（含 items/tryable/sourceHealth/generatedAt 等）
   * @returns {object} 渠道可消费的 payload
   */
  render(brief) {
    throw new Error('[IntelChannel] 子类必须实现 render(brief)')
  }

  /**
   * 从 Brief 提炼源健康提示（§7.7）：源当日全失败 → 标「待验证」。
   * 默认实现通用化；子类可按渠道呈现习惯调整。
   * @param {object} brief
   * @returns {object|null} 健康提示载荷（无异常时返回 null）
   */
  health(brief) {
    return IntelChannel.extractHealth(brief)
  }

  // ─── 公共工具（静态，供子类复用）───
  /**
   * 从任意 Brief 提炼源健康提示。通用逻辑：
   *   - 存在当日「status=failed」或有 consecutiveFails 超阈值的源 → 标『部分源今日未更新（待验证）』
   *   - 否则返回 null（健康、无需提示）
   */
  static extractHealth(brief) {
    if (!brief || !brief.sourceHealth) return null
    const failed = (Array.isArray(brief.sourceHealth) ? brief.sourceHealth : [])
      .filter((h) => h && (h.status === 'failed' || (typeof h.consecutiveFails === 'number' && h.consecutiveFails >= 3)))
    if (failed.length === 0) return null
    return {
      level: 'degraded',                       // 前端可用 --color-warning 令牌呈现
      title: '部分源今日未更新（待验证）',
      detail: `${failed.length} 个信息源当日抓取失败，本期内容由其余源支撑`,
    }
  }
}

module.exports = { IntelChannel }
