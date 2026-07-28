/**
 * 一键构建脚本 — AI 新闻更新完整流程
 *
 * 执行步骤：
 *   1. 构建云函数数据文件 (aiNewsData.js)
 *   2. 生成 GitHub JSON (data/news.json)
 *   3. 运行 Mock 回归测试
 *
 * 运行：node scripts/build-all.js
 */

const { execSync } = require('child_process')
const path = require('path')

const scriptsDir = __dirname

function run(name, script) {
  console.log(`\n▶ ${name}`)
  console.log('─'.repeat(40))
  try {
    execSync(`node "${path.join(scriptsDir, script)}"`, {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'inherit',
    })
    console.log(`✅ ${name} — 完成`)
    return true
  } catch (err) {
    console.error(`❌ ${name} — 失败`)
    return false
  }
}

let allPassed = true

allPassed = run('1/3 构建云函数数据', 'build-ai-cache.js') && allPassed
allPassed = run('2/3 生成 GitHub JSON', 'generate-news-json.js') && allPassed

console.log('\n' + '='.repeat(50))
if (allPassed) {
  console.log('✅ 全部构建完成！')
  console.log('   云函数数据: cloudfunctions/common/aiNewsData.js')
  console.log('   GitHub JSON: data/news.json')
  console.log('\n   下一步: git add . && git commit -m "update: 新闻缓存更新" && git push')
} else {
  console.log('❌ 构建失败，请检查上方错误')
  process.exit(1)
}
