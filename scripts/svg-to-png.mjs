// 一次性工具：把 assets/logo/*.svg 转成 PNG（canvas 分享场景专用）
// 说明：分享卡片/封面用 canvas drawImage，SVG 的 <text> 依赖设备字体真机兼容差，
//      所以关键场景必须用 PNG。此脚本用 resvg 配合系统字体渲染 PNG 落地 assets/logo/png/。
// 用法：node scripts/svg-to-png.mjs
import { Resvg } from '/Users/michaelzhao/.workbuddy/binaries/node/workspace/node_modules/@resvg/resvg-js/index.js'
import { promises as fs } from 'fs'
import path from 'path'

const ROOT = '/Users/michaelzhao/WorkBuddy/一页 One News'
const SRC = path.join(ROOT, 'assets/logo')
const OUT = path.join(ROOT, 'assets/logo/png')

// 字体（macOS 系统盘）：英文字带 + 中文（Hiragino 兜底）
const FONT_FILES = [
  '/System/Library/Fonts/SFNS.ttf',
  '/System/Library/Fonts/Hiragino Sans GB.ttc',
  '/Library/Fonts/Arial Unicode.ttf',
]
const FONT_DIRS = ['/System/Library/Fonts', '/Library/Fonts']

// 需要转 PNG 的形态（canvas 场景：分享封面 splash + 分享卡片头像 circle）
// 映射：{ 文件名, 基准宽度, 目标宽度 }
const TARGETS = [
  { name: 'logo-splash-light',     baseW: 640, outW: 1280 },  // 分享封面，高清晰
  { name: 'logo-splash-dark',      baseW: 640, outW: 1280 },
  { name: 'logo-avatar-circle-light', baseW: 120, outW: 240 }, // 分享卡片圆头像 40px 处，2x 够清
  { name: 'logo-avatar-circle-dark',  baseW: 120, outW: 240 },
  { name: 'logo-avatar-120-dark',  baseW: 120, outW: 240 },   // 微信小程序头像后台源
]

async function convert(target) {
  const name = target.name
  const svg = await fs.readFile(path.join(SRC, name + '.svg'), 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: target.outW },
    font: { fontFiles: FONT_FILES, loadSystemFonts: true, defaultFontFamily: 'SF Pro Display' },
  })
  const png = resvg.render().asPng()
  const scaleLabel = (target.outW / target.baseW).toFixed(0) + 'x'
  const outFile = path.join(OUT, name + '@' + scaleLabel + '.png')
  await fs.writeFile(outFile, png)
  console.log('ok', name, scaleLabel, png.length, 'bytes ->', path.basename(outFile))
}

await fs.mkdir(OUT, { recursive: true })
for (const t of TARGETS) {
  await convert(t)
}
console.log('DONE ->', OUT)
