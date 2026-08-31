/**
 * oneNewsChannel.js — Channels 渠道适配 · One News 小程序（T4.x / D 推送/UI）
 * ============================================================
 * ⚠️ intel_* 命名空间隔离，可整体摘除。本期唯一渠道实现（决策 D3，§7.6）。
 *
 * 职责：把 intel_current 的 Brief（§8.2，发布闸门 intelDispatcher 组装）渲染为
 *       One News「AI 情报」首页可消费的 payload。页面元素对应（设计 §7.6）：
 *         - 今日关注卡片流      ← brief.items（rank/title/card 五步模板 + sceneTags）
 *         - 本周可试用清单      ← brief.tryable（itemId/title/minAction）
 *         - 数据截至 HH:MM      ← brief.generatedAt（发布时刻）
 *         - 源健康提示          ← brief.banner / brief.healthFlag / brief.sourceHealth
 *
 * 【对齐 intelDispatcher（intelDispatcher/index.js）实际落库结构】
 *   Brief = {
 *     date, version, mode, generatedAt, isCurrent, locked?,
 *     items:  [{ rank,itemId,title,url,sourceId,sourceName,publishedAt,
 *                relevance,sceneTags,sceneHits,contract, card(<Markdown 五步>) }],
 *     tryable:[{ itemId,title,url,sourceId,minAction,releasedAt }],
 *     sourceHealth:[{ key,name,layer,status,consecutiveFails,lastError,banner:'待验证'|'ok' }],
 *     healthFlag:'none'|'partial'|'all-failed', banner:'部分源今日未更新（待验证）'|'',
 *   }
 *   —— SOP 五步已被 Dispatcher 折叠进 items[].card（§6.3 固定模板）。
 *   本渠道负责「端适配」：从 card 提取一句话/最小行动等前端零散字段（不必后端展开），
 *   将来接微信/WhatsApp 新建对应 Channel 复用同一 Brief 即可（§7.8）。
 * ============================================================
 */

const { IntelChannel } = require('./base')
const { formatHHMM } = require('../beijingTime')

/** 场景标签 → 小程序友好短标签（2026-08-31：新增 work/product 映射，兼容旧 work_rcbc/product_onenews） */
const SCENE_LABEL = {
  work: '工作',
  product: '产品',
  life: '生活',
  work_rcbc: '工作',
  product_onenews: '产品',
}

/**
 * 从 §6.3 固定模板 Markdown 片段提取单字段。
 * 形如 `- **一句话**：xxx` / `- **溯源**：...` / `- **最小行动**：...`。
 */
function extractCardField(cardMd, label) {
  if (!cardMd) return ''
  const re = new RegExp(`- \\*\\*${label}\\*\\*：([^\\n]*)`, 'i')
  const m = cardMd.match(re)
  return m ? m[1].trim() : ''
}

class OneNewsChannel extends IntelChannel {
  get channelId() { return 'oneNews' }

  /**
   * 渲染 Brief → 小程序首页 payload。
   * @param {object} brief  intel_current 文档（intelDispatcher 落库结构）
   * @returns {object} 小程序可直接渲染的 payload
   */
  render(brief) {
    if (!brief || typeof brief !== 'object') {
      return this.emptyPayload('本期尚未生成')
    }

    const items = (Array.isArray(brief.items) ? brief.items : [])
      .filter((it) => it && it.title)
      .map((it) => this._renderItem(it))

    const tryable = (Array.isArray(brief.tryable) ? brief.tryable : [])
      .filter((it) => it && it.title)
      .map((it) => ({
        id: it.itemId || it._id || '',
        title: it.title,
        minAction: it.minAction || '',
        url: it.url || '',
        done: false,               // 前端可勾选状态（本地暂存）
      }))

    return {
      ok: true,
      channel: this.channelId,
      date: brief.date || '',
      version: typeof brief.version === 'number' ? brief.version : 0,
      mode: brief.mode || 'increment',
      locked: brief.locked === true,
      // 「数据截至 HH:MM」（§7.6）
      dataAsOf: {
        // owner 2026-08-19：优先展示「批次抓取时间」batchFetchedAt（Dispatcher 组装时写入），回退 brief 生成时刻
        hhmm: formatHHMM(brief.batchFetchedAt || brief.generatedAt),
        generatedAt: brief.batchFetchedAt || brief.generatedAt || '',
        label: (brief.batchFetchedAt || brief.generatedAt) ? `数据截至 ${formatHHMM(brief.batchFetchedAt || brief.generatedAt)}` : '',
      },
      // 今日关注卡片流
      focusItems: items,
      // 本周可试用清单
      tryable,
      // 源健康提示（§7.7 失败源标「待验证」）
      health: this.health(brief),
      hasContent: items.length > 0 || tryable.length > 0,
      // 空/占位态透传（处理层大面积失败出的「今日无可靠更新」占位，§7.7）
      placeholder: brief.placeholder === true,
      banner: brief.banner || '',
    }
  }

  /** 单条 Brief item → 今日关注卡片（从 card 提取前端零散字段） */
  _renderItem(it) {
    const card = it.card || ''
    return {
      id: it.itemId || it._id || '',
      title: it.title,
      url: it.url || '',
      sourceName: it.sourceName || it.sourceId || '',
      publishedAt: it.publishedAt || '',
      // 从 §6.3 模板片段提取（SOP 五步）
      definition: extractCardField(card, '一句话'),      // 一句话定义
      sceneMapping: extractCardField(card, '对老赵的意义'), // 场景映射
      practice: extractCardField(card, '可以怎么做'),      // 实操
      minAction: extractCardField(card, '最小行动'),       // 最小行动
      card,                                                // 完整五步 Markdown（详情页）
      // 2026-08-22：透传结构化 sop（详情页本地渲染秒开，免云函数等待）
      //   brief items 已自包含 sop（whatHappenedBlocks/definition/sceneMapping/practice/minAction）
      sop: it.sop || null,
      references: Array.isArray(it.references) ? it.references : [],
      tryable: it.tryable === true,
      contract: it.contract === true,                       // 合同/接口变更置顶标记
      // 场景标签
      sceneTags: (it.sceneTags || []).map((t) => ({ key: t, label: SCENE_LABEL[t] || t })),
      sceneHits: typeof it.sceneHits === 'number' ? it.sceneHits : 0,
      relevance: it.relevance || 'medium',
      rank: it.rank || 0,
    }
  }

  /**
   * 源健康提示。对齐 intelDispatcher 的 banner / healthFlag / sourceHealth[].banner：
   *   - all-failed → 强提示「部分源今日未更新（待验证）」
   *   - partial    → 同文案弱提示
   *   - banner 字段兜底
   * @param {object} brief
   */
  health(brief) {
    if (!brief) return null
    const flag = brief.healthFlag || 'none'
    const banner = brief.banner || ''
    if (flag === 'none' && !banner) return null

    // 待验证源数（sourceHealth[].banner === '待验证'）
    const degradedCount = (Array.isArray(brief.sourceHealth) ? brief.sourceHealth : [])
      .filter((h) => h && (h.banner === '待验证' || h.status === 'failed' || (h.consecutiveFails || 0) > 0)).length

    return {
      level: flag === 'all-failed' ? 'all-failed' : 'degraded', // 前端用 --color-warning 令牌
      title: banner || '部分源今日未更新（待验证）',
      detail: degradedCount > 0 ? `${degradedCount} 个信息源当日未更新，本期内容由其余源支撑` : '',
    }
  }

  /** 空态 payload：有则汇报、无则不打扰（§7.3/#7.7 空不发布，前端仍做占位） */
  emptyPayload(reason) {
    return {
      ok: true,
      channel: this.channelId,
      dataAsOf: { hhmm: '', generatedAt: '', label: '本期尚未生成' },
      focusItems: [],
      tryable: [],
      health: null,
      hasContent: false,
      placeholder: false,
      banner: '',
      empty: { message: reason },
    }
  }
}

module.exports = { OneNewsChannel, SCENE_LABEL }
