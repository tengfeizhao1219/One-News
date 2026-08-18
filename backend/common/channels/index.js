/**
 * index.js — Channels 渠道适配层 · 注册表（T4.x / D 推送/UI）
 * ============================================================
 * ⚠️ intel_* 命名空间隔离，可整体摘除。
 *
 * 集中管理制度驱动（§7.8）：将来接微信/WhatsApp 只需在此注册新渠道，
 * Dispatcher / Brief 结构不变，多端可独立开关。
 * 本期仅注册 One News（决策 D3）。
 * ============================================================
 */

const { IntelChannel } = require('./base')
const { OneNewsChannel } = require('./oneNewsChannel')

/** 已注册渠道（映射 channelId → 实例），后续扩展在此追加 */
const REGISTRY = {
  oneNews: new OneNewsChannel(),
  // wechat:   new WeChatChannel(),    // §7.8 预留：待接微信
  // whatsapp: new WhatsAppChannel(),  // §7.8 预留：待接 WhatsApp
}

/**
 * 取某个渠道实例（未实现则抛错，提示只实现了本期渠道）。
 * @param {string} channelId
 * @returns {IntelChannel}
 */
function getChannel(channelId) {
  const ch = REGISTRY[channelId]
  if (!ch) {
    throw new Error(`[intelChannels] 渠道 ${channelId} 未注册；本期仅实现 oneNews（决策 D3/§7.8）`)
  }
  return ch
}

/**
 * 渲染指定渠道 payload：Brief → 渠道可消费载荷。
 * @param {string} channelId
 * @param {object} brief
 * @returns {object}
 */
function renderTo(channelId, brief) {
  return getChannel(channelId).render(brief)
}

/**
 * 渲染全部已注册渠道（多端并投 §7.8；本期仅 oneNews）。
 * 用于将来一次巡检铺多端；当前返回 { oneNews: payload }。
 * @param {object} brief
 * @returns {object}
 */
function renderAll(brief) {
  const out = {}
  for (const id of Object.keys(REGISTRY)) {
    out[id] = REGISTRY[id].render(brief)
  }
  return out
}

module.exports = { IntelChannel, OneNewsChannel, REGISTRY, getChannel, renderTo, renderAll }
