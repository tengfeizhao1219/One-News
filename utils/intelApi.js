// INTEL-MODULE: AI 情报官 · 前端数据层
// ============================================================
// 隔离说明：本文件为 AI 情报模块新增，独立于 One News 既有业务；intel_ 命名空间。
// 复用说明：请求封装模式复刻 One News utils/request.js（云函数 + code/message 解包）。
// 数据流：前端 → 云函数 intelGetList / intelGetDetail → intel_staged / intel_current
// 摘除方式：删除本文件 + 页面内调用点即可，不影响 One News。
// ============================================================

const { formatAbsoluteTime } = require('./util')

/**
 * 获取情报列表
 * @param {Object} params
 * @param {number} params.pageNum  页码，默认1
 * @param {number} params.pageSize 每页条数，默认20
 * @returns {Promise<{list: Array, total: number, source: string}>}
 */
function getIntelList({ pageNum = 1, pageSize = 20 } = {}) {
  return wx.cloud.callFunction({
    name: 'intelGetList',
    data: { pageNum, pageSize }
  }).then(res => {
    if (!res.result || res.result.code !== 0) {
      const err = new Error((res.result && res.result.message) || '获取情报列表失败')
      err.errorCode = res.result && res.result.errorCode
      throw err
    }
    const data = res.result.data || {}
    return {
      list: (data.list || []).map(formatIntelItem),
      total: data.total || 0,
      source: data.source || ''
    }
  })
}

/**
 * 获取情报详情
 * @param {string} id 情报 itemId
 * @returns {Promise<Object>} 详情字段（对齐 pages/intel/detail wxml）
 */
function getIntelDetail(id) {
  return wx.cloud.callFunction({
    name: 'intelGetDetail',
    data: { id }
  }).then(res => {
    if (!res.result || res.result.code !== 0) {
      const err = new Error((res.result && res.result.message) || '获取情报详情失败')
      err.errorCode = res.result && res.result.errorCode
      throw err
    }
    return formatIntelDetail(res.result.data)
  })
}

// ============ 格式化 ============

/** 列表项格式化：时间字段统一为相对时间（复用 One News util） */
function formatIntelItem(item) {
  return {
    id: item.id,
    title: item.title || '',
    desc: item.desc || '',
    src: item.src || '',
    time: formatAbsoluteTime(item.time || item.processedAt),
    _time: item.time || item.processedAt || '',
    url: item.url || '',
    relevance: item.relevance || '',
    sceneTags: Array.isArray(item.sceneTags) ? item.sceneTags : [],
    tryable: item.tryable === true
  }
}

/** 详情格式化：正文按换行拆段（detail.wxml wx:for 渲染），时间相对化 */
function formatIntelDetail(d) {
  // 乱码清洗（2026-08-20）：清除 U+FFFD 替换符（黑菱形块/问号块）——源头抓取内容编码坏，LLM 照抄进输出
  const clean = (v) => String(v || '').replace(/\uFFFD/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
  const toParas = (text) => String(clean(text))
    .split(/\n+/)
    .map(s => s.trim())
    .filter(Boolean)

  return {
    id: d.id,
    title: clean(d.title),
    url: clean(d.url),
    srcName: clean(d.srcName),
    sourceUrl: clean(d.sourceUrl),
    publishedAt: clean(d.publishedAt),
    definitionParas: toParas(d.definition),
    whatHappened: clean(d.whatHappened),          // 2026-08-20 修复：详情页"发生了什么"多段正文（此前未透传导致前端只显示一句话定义）
    whatHappenedParagraphs: toParas(d.whatHappened),
    whatHappenedBlocks: Array.isArray(d.whatHappenedBlocks) ? d.whatHappenedBlocks.map(b => ({
      type: b.type === 'plain' || b.type === 'predict' || b.type === 'def' ? b.type : 'text',
      text: clean(b.text),
    })).filter(b => b.text) : [],   // 2026-08-21 修复：透传结构化块（此前丢失 → 前端永远走本地兜底解析，predict 类型不稳定）
    sceneMapping: clean(d.sceneMapping),
    sceneMappingLines: Array.isArray(d.sceneMappingLines) ? d.sceneMappingLines.map(ln => ({
      segments: Array.isArray(ln && ln.segments) ? ln.segments.map(sg => ({ text: clean(sg && sg.text), bold: sg && sg.bold === true })).filter(sg => sg.text) : [],
    })).filter(ln => ln.segments.length) : [], // 2026-08-21 方案A：落到你这里结构化 lines
    sceneTags: Array.isArray(d.sceneTags) ? d.sceneTags : [],
    relevance: d.relevance || '',
    minAction: clean(d.minAction),
    practiceParas: toParas(d.practice),
    tryable: d.tryable === true,
    researchStatus: (d.research && d.research.status) || 'todo',
    processedAt: d.processedAt || '',
    processedTime: formatAbsoluteTime(d.processedAt),
    modelUsed: d.modelUsed || '',
    cost: d.cost || 0
  }
}

module.exports = {
  getIntelList,
  getIntelDetail,
  searchIntelTopic
}

/**
 * 详情页话题搜索（intelSearch 云函数）
 * 后端流程：相关性判断 → 联网搜索 → 总结回答；60s 超时（联网 3-25s+）。
 * @param {Object} params
 * @param {string} params.itemId  intel 详情页新闻 id（context 缺省时按此查库）
 * @param {Object} [params.context] One News 详情页直传新闻上下文 {title, what, srcName}（有则跳过查库）
 * @param {string} params.query   用户输入话题（≤60 字）
 * @param {Object} [params.profile] 用户画像摘要 {identitiesSummary, focusTags}（意图理解用）
 * @param {Array}  [params.history] 最近历史搜索词（意图理解用）
 * @returns {Promise<Object>} 三种路径：{relevant:false,hint} / {relevant:true,answer,sources,engine} / {relevant:true,answer:null,error,hint}
 */
function searchIntelTopic({ itemId, query, context, profile, history } = {}) {
  return wx.cloud.callFunction({
    name: 'intelSearch',
    data: { itemId, query, context, profile, history },
    timeout: 60000,
  }).then(res => {
    if (!res.result || res.result.code !== 0) {
      const err = new Error((res.result && res.result.message) || '搜索失败，请稍后再试')
      err.errorCode = res.result && res.result.errorCode
      throw err
    }
    return res.result.data || {}
  })
}
