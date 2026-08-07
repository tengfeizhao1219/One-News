/**
 * v13-FE 暗色可见性契约测试（D-07 FE 部分 · 2026-08-05）
 *
 * 背景（根因）：
 *   PD D-07.1 精确定位 3 个 FE 职责内暗色缺口：
 *   - 发现 A/B（G-03 P0）：`.page--dark` 变量块缺 `--wheel-*`（7 个）→
 *     手动深色 + 系统浅色时分类轮盘 var() 取系统浅色值 → 黑字落深底不可见
 *   - 发现 C：`--flash-*`（5 个）未入 `.page--dark` 块 → 手动深色下
 *     详情页进度分类名高亮色取浅色值，偏暗/对比度不足
 *   - S3 #2：settings `.switch-knob` 硬编码 `#fff` → 裸色收敛
 *
 * 注意（2026-08-07 FS-04）：font-panel 组件已被清理（功能由 settings 内联字号选择器接管，
 * 见 components/font-panel/ 删除记录），本测试同步移除 font-panel 相关断言。
 * 字号选择 UI 已在 settings 页 .seg / .seg-item 全部走 var()，由本测试 §1/§2 的
 * `.page--dark` 变量块契约覆盖（--seg-bg/--seg-on-bg/--seg-on-text）。
 *
 * 本测试锁定"FE 暗色可见性"契约（与 FS 的 S1-S4 架构治理互不重叠，
 * 后者见 PM D-07 §检查点 v13-theme-contract.js）：
 *   - `.page--dark` 块 = theme.json dark 分支全量颜色变量（含 wheel / flash / seg 系列）
 *   - 关键交互控件（switch-knob）必须走 CSS 变量，无裸色
 *
 * 运行：node test/v13-fe-dark-visibility.js
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const theme = JSON.parse(fs.readFileSync(path.join(ROOT, 'theme.json'), 'utf8'))
const appWxss = fs.readFileSync(path.join(ROOT, 'app.wxss'), 'utf8')
const settingsWxss = fs.readFileSync(path.join(ROOT, 'pages/settings/settings.wxss'), 'utf8')

let pass = 0
let fail = 0
const failures = []

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  [PASS] ' + name)
  } else {
    fail++
    failures.push(name + (detail ? ' — ' + detail : ''))
    console.log('  [FAIL] ' + name + (detail ? ' — ' + detail : ''))
  }
}

// 1) `.page--dark` 块包含 theme.json dark 全量颜色变量
{
  const block = appWxss.match(/\.page--dark \{([^}]*)\}/)
  check('存在 .page--dark 变量块', !!block)
  if (block) {
    const body = block[1]
    const dark = theme.dark
    // 运行时变量（非颜色，JS 动态注入 style）跳过
    const SKIP = ['--font-scale', '--font-scale-meta']
    for (const [k, v] of Object.entries(dark)) {
      if (SKIP.includes(k)) continue
      check('包含 ' + k, body.includes(k + ':'))
    }
    // 设置页专属变量（theme.json 无，但手动深色必需）
    const extra = ['--preview-bg', '--seg-bg', '--seg-on-bg', '--seg-on-text', '--switch-off', '--switch-knob']
    for (const k of extra) check('包含 ' + k, body.includes(k + ':'))
  }
}

// 2) `.page--dark` 块值与 theme.json dark 分支逐项一致（防视觉漂移）
{
  const block = appWxss.match(/\.page--dark \{([^}]*)\}/)[1]
  const SKIP = ['--font-scale', '--font-scale-meta']
  for (const [k, v] of Object.entries(theme.dark)) {
    if (SKIP.includes(k)) continue
    const re = new RegExp(k.replace(/-/g, '\\-') + ':\\s*([^;]+);')
    const m = block.match(re)
    if (m) {
      const actual = m[1].trim().replace(/\s+/g, ' ')
      const expect = String(v).trim().replace(/\s+/g, ' ')
      check('值一致 ' + k, actual === expect, '期望 ' + expect + ' 实际 ' + actual)
    } else {
      check('值一致 ' + k, false, '变量缺失')
    }
  }
}

// 3) settings 开关 knob 走 CSS 变量（裸色收敛）
{
  check('settings .switch-knob 用 var(--switch-knob)',
    /\.switch-knob\s*\{[\s\S]*?background:\s*var\(--switch-knob,\s*#FFFFFF\)/.test(settingsWxss))
}

console.log('\n==============================================')
console.log('FE 暗色可见性契约测试：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')

if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
} else {
  console.log('\n所有 FE 暗色可见性契约校验通过 [OK]')
  process.exit(0)
}
