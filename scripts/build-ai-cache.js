/**
 * 构建脚本：将 mock/ai-news-cache.js 复制到云函数 common 目录
 *
 * 作用：
 *   云函数环境无法 require 小程序 mock 目录中的文件，
 *   因此需要将 AI 新闻缓存数据复制到 cloudfunctions/common/aiNewsData.js
 *
 * 运行：node scripts/build-ai-cache.js
 * 或在每次 AI 新闻更新后运行
 */

const fs = require('fs')
const path = require('path')

const sourcePath = path.resolve(__dirname, '../mock/ai-news-cache.js')
const targetPath = path.resolve(__dirname, '../cloudfunctions/common/aiNewsData.js')

// 读取源文件
let source = fs.readFileSync(sourcePath, 'utf-8')

// 将 `const aiNewsCache = [` 替换为 `module.exports = [`
// 确保云函数可以直接 require
source = source.replace(
  /(const|let|var)\s+aiNewsCache\s*=\s*\[/,
  'module.exports = ['
)

// 移除最后的 `module.exports = aiNewsCache`（如果有）
source = source.replace(/\n\s*module\.exports\s*=\s*aiNewsCache\s*;?\s*$/, '\n')

// 添加生成时间戳注释
const now = new Date().toISOString()
const header = `/**
 * AI 新闻缓存数据（自动生成）
 * 由 build-ai-cache.js 于 ${now} 生成
 * 源文件：mock/ai-news-cache.js
 * 
 * 请勿手动编辑此文件，运行 node scripts/build-ai-cache.js 重新生成
 */
\n`

fs.writeFileSync(targetPath, header + source, 'utf-8')

console.log(`✅ AI 新闻缓存已构建:`)
console.log(`   源文件: ${sourcePath}`)
console.log(`   目标文件: ${targetPath}`)

// 验证目标文件可被 Node.js 加载
try {
  const data = require(targetPath)
  console.log(`   数据条数: ${data.length}`)
  const categories = {}
  data.forEach(item => {
    categories[item.category] = (categories[item.category] || 0) + 1
  })
  console.log(`   分类分布:`, categories)
  console.log(`   构建成功！`)
} catch (err) {
  console.error(`   ❌ 验证失败: ${err.message}`)
  process.exit(1)
}
