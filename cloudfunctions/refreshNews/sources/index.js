/**
 * 统一源数据抓取模块（owner 8/13 拍板：tianxing/juhe 与后续接入的其它 RSS 源
 * 不再区分处理逻辑，全部经由本模块的适配器注册表归一为同形状原始条目，
 * 下游（质量门控 / AI 摘要 / AI 解读 / 落库 / 删源）统一处理，业务代码零分支）。
 *
 * 数据流（与《统一多源新闻聚合技术架构方案》一致）：
 *   抓取各接口 RSS/聚合源数据 → 质量门控 → AI 摘要+解读 → 落 news_cache → 删除源数据
 *
 * 新增一个 RSS 源只需：
 *   1) 在 SOURCE_ADAPTERS 注册一项 { label, enabled, fetchAll }
 *   2) fetchAll(cats, num) 返回 { news: [...], stats }，news 项为原始结构
 *      （id/title/summary/category/categoryName/source/sourceUrl/publishTime）
 *   下游 collectCategoryItems 已把 news 归一为统一 item，无需改任何业务代码。
 *
 * 官方 RSS 经独立云函数 rssFetcher 预写 news_ingest 瞬时暂存，由 refreshNews
 * 经 newsIngestStore 统一消费（见 collectCategoryItems），不在此注册——
 * 它是「瞬时 staging 源」，非聚合 API 源，但下游处理与 tianxing/juhe 完全一致。
 */

const config = require('../config')
const { fetchAllCategories: fetchAllJuhe } = require('./juhe')
const { fetchAllCategories: fetchAllTian } = require('./tianxing')

/**
 * 聚合 API 源适配器注册表
 * 每项：{ label, enabled(), fetchAll(cats, num) -> { news, stats } }
 */
const SOURCE_ADAPTERS = {
  juhe: {
    label: 'juhe',
    enabled: () => !!config.juhe.apiKey,
    fetchAll: (cats, num) => fetchAllJuhe(cats, num),
  },
  tianxing: {
    label: 'tianxing',
    enabled: () => !!config.tian.apiKey,
    fetchAll: (cats, num) => fetchAllTian(cats, num),
  },
  // 后续 RSS 源：在此追加一项即可（如 rss_xxx: { label, enabled, fetchAll }）
}

/**
 * 收集所有「启用」的聚合 API 源的原始条目（归一前的原始 news 数组）。
 * @param {string[]} categories - 分类 id 列表（通常单分类 [category]）
 * @param {number} [num=8] 每源每类抓取条数
 * @returns {Promise<{ news: Array, engines: string[] }>}
 *   news：所有启用源的原始条目拼接；engines：实际产出数据的源 label 列表
 */
async function collectAggregateSources(categories, num = 8) {
  const news = []
  const engines = []
  const jobs = []
  const labels = []
  for (const key of Object.keys(SOURCE_ADAPTERS)) {
    const ad = SOURCE_ADAPTERS[key]
    if (!ad.enabled()) continue
    jobs.push(ad.fetchAll(categories, num))
    labels.push(ad.label)
  }
  if (jobs.length === 0) return { news, engines }
  const settled = await Promise.allSettled(jobs)
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled' && r.value && r.value.news && r.value.news.length > 0) {
      news.push(...r.value.news)
      engines.push(labels[i])
    }
  })
  return { news, engines }
}

module.exports = {
  SOURCE_ADAPTERS,
  collectAggregateSources,
}
