/**
 * 生成 data/news.json — 供 GitHub 托管，CloudBase 定时触发器拉取
 *
 * 从 mock/ai-news-cache.js 读取新闻数据，输出为纯 JSON 文件
 * 输出路径：data/news.json
 *
 * 运行：node scripts/generate-news-json.js
 */

const fs = require('fs')
const path = require('path')

const sourcePath = path.resolve(__dirname, '../mock/ai-news-cache.js')
const targetPath = path.resolve(__dirname, '../data/news.json')

// 确保 data 目录存在
const dataDir = path.dirname(targetPath)
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true })
}

// 加载源数据
const aiNewsCache = require(sourcePath)

// 构建输出格式
const output = {
  version: '2026-07-28-v1',
  generatedAt: new Date().toISOString(),
  totalItems: aiNewsCache.length,
  news: aiNewsCache,
}

// 写入 JSON（美化格式，方便 Git diff）
fs.writeFileSync(targetPath, JSON.stringify(output, null, 2), 'utf-8')

console.log(`✅ news.json 已生成:`)
console.log(`   源文件: ${sourcePath}`)
console.log(`   目标文件: ${targetPath}`)
console.log(`   新闻条数: ${output.totalItems}`)

// 验证输出
try {
  const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf-8'))
  console.log(`   版本: ${parsed.version}`)
  console.log(`   生成时间: ${parsed.generatedAt}`)
  console.log(`   分类分布:`)
  const cats = {}
  parsed.news.forEach(item => {
    cats[item.category] = (cats[item.category] || 0) + 1
  })
  Object.entries(cats).forEach(([cat, count]) => {
    console.log(`     ${cat}: ${count} 条`)
  })
} catch (err) {
  console.error(`   ❌ 验证失败: ${err.message}`)
  process.exit(1)
}
