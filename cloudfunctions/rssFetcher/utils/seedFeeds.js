/**
 * seedFeeds.js — feed_meta 种子数据导入
 * ============================================================
 * PD 14:04 会议交付的 4 源栏目白名单（A 子页 v2）+ FS 实测验证的 feed URL。
 * 用法：rssFetcher 首次部署后，云函数控制台手动调用或 index.js 启动自检。
 * 幂等：种子源已存在则略过（不覆盖已启用的灰度配置）。
 *
 * 栏目分配（PD A 子页 v2）：
 *   中新→财经/教育(无独立科技feed) | 人民→科技(IT)/财经/教育
 *   央视→财经/科教(科技+教育合并) | 新华→科技/财经/教育 三栏齐
 *
 * URL 实测（FS 2026-08-11 调研）：
 *   中新 finance/edu 200✅ | 人民 finance 200⚠️(Last-Modified 2025 疑似停更)
 *   央视 02/04 200✅(财经) 02/06 待核实 | 新华 finance/tech 200✅
 * ============================================================
 */

const feedStore = require('./feedStore')
const seedData = require('../seedFeeds.json')

/**
 * 导入种子数据到 feed_meta（幂等：已存在则跳过）。
 * 返回 { inserted, skipped } 计数。
 */
async function seed() {
  const inserted = []
  const skipped = []

  for (const feed of seedData) {
    const existing = await feedStore.getFeed(feed._id)
    if (existing) {
      skipped.push(feed._id)
      console.log(`[seed] 跳过 ${feed._id}（已存在，不覆盖灰度配置）`)
      continue
    }
    console.log(`[seed] 新建 ${feed._id}: ${feed.name} ${feed.category} → ${feed.baseUrl}`)
    inserted.push(feed._id)
  }

  if (inserted.length) {
    await feedStore.upsertFeeds(seedData.filter((f) => inserted.includes(f._id)))
    console.log(`[seed] 完成：写入 ${inserted.length} 条，跳过 ${skipped.length} 条`)
  } else {
    console.log(`[seed] 全部 ${skipped.length} 条已存在，无需写入`)
  }

  return { inserted: inserted.length, skipped: skipped.length }
}

module.exports = { seed }
