/**
 * v5 架构级回归测试：首页触摸/侧边栏交互架构
 *
 * 背景（根因）：
 * 此前两个反复出现、且被“打补丁式修复”反而加重的问题：
 *   1) 侧边栏打开后整个页面卡死、列表无法滚动
 *      根因 = WXS 触摸处理绑在根视图 .page 上（覆盖全屏），
 *             且面板祖先使用了 catchtouchmove="preventMove"（preventDefault 禁掉了 scroll-view 原生滚动）。
 *   2) 首页中文乱码
 *      根因 = 部分源码文件被以 GBK 编码保存（微信开发者工具要求源码为 UTF-8）。
 *
 * 本测试从“架构不变量”层面锁定修复，防止同类问题复发：
 *   - 触摸手势必须只绑在 .card-stage（实际交互区），而非根视图 .page
 *   - 面板/遮罩不得出现 catchtouchmove（会禁用其内部 scroll-view 滚动）
 *   - .card-stage.hidden 必须用 display:none 真正移除，而非 opacity:0
 *   - WXS 中不得残留 panelOpen / setPanelOpen 死代码
 *   - home.js 不得残留 preventMove 死代码
 *   - 关键源码文件必须是合法 UTF-8（非 GBK）
 *
 * 运行：node test/v5-regression-touch-architecture.js
 */

const fs = require('fs')
const path = require('path')
const { TextDecoder } = require('util')

const ROOT = path.resolve(__dirname, '..')
const files = {
  wxml: path.join(ROOT, 'pages/home/home.wxml'),
  wxss: path.join(ROOT, 'pages/home/home.wxss'),
  wxs: path.join(ROOT, 'pages/home/touch.wxs'),
  js: path.join(ROOT, 'pages/home/home.js'),
}

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

function read(p) {
  return fs.readFileSync(p, 'utf-8')
}

// 严格 UTF-8 校验：非法字节会抛异常
function isStrictUtf8(buf) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch (e) {
    return false
  }
}

// 1) 根视图 .page 不得绑定触摸手势
{
  const wxml = read(files.wxml)
  const pageOpen = /<view\s+class="page"\s*>/.test(wxml)
  const pageWithTouch = /<view\s+class="page"[^>]*bindtouch(start|move|end)/.test(wxml)
  check('根视图 .page 不绑定触摸手势', pageOpen && !pageWithTouch,
    pageWithTouch ? '在 .page 上发现 bindtouch* 绑定' : '')
}

// 2) 触摸手势必须绑在 .card-stage 上（取其起始标签检查）
{
  const wxml = read(files.wxml)
  const openTag = wxml.match(/<view\s+class="card-stage[\s\S]*?>/)
  const tag = openTag ? openTag[0] : ''
  const cardWithTouch = /bindtouchstart=.*handleTouchStart/.test(tag)
  check('触摸手势绑定在 .card-stage 上', cardWithTouch,
    cardWithTouch ? '' : '未在 .card-stage 起始标签内找到 bindtouchstart')
}

// 3) 全项目不得出现 catchtouchmove（会禁用 scroll-view 滚动）
{
  const wxml = read(files.wxml)
  const hasCatch = /catchtouchmove/.test(wxml)
  check('首页无 catchtouchmove（避免禁用 scroll-view 滚动）', !hasCatch)
}

// 4) .card-stage.hidden 必须用 display:none 真正移除
{
  const wxss = read(files.wxss)
  const m = wxss.match(/\.card-stage\.hidden\s*\{([^}]*)\}/)
  const body = m ? m[1] : ''
  const usesDisplayNone = /display\s*:\s*none/.test(body)
  const usesOpacityOnly = /opacity\s*:/.test(body)
  check('.card-stage.hidden 使用 display:none（彻底移除而非隐藏）',
    usesDisplayNone && !usesOpacityOnly,
    usesOpacityOnly ? '仍使用 opacity/pointer-events 隐藏' : (m ? '未找到 .card-stage.hidden 规则' : ''))
}

// 5) WXS 不得残留 panelOpen / setPanelOpen 死代码
{
  const wxs = read(files.wxs)
  const hasDead = /panelOpen|setPanelOpen/.test(wxs)
  check('touch.wxs 无 panelOpen/setPanelOpen 死代码', !hasDead)
}

// 6) home.js 不得残留 preventMove 死代码
{
  const js = read(files.js)
  const hasDead = /preventMove/.test(js)
  check('home.js 无 preventMove 死代码', !hasDead)
}

// 7) 关键源码文件必须为合法 UTF-8（非 GBK）
{
  const targets = [
    files.wxml, files.wxss, files.wxs, files.js,
    path.join(ROOT, 'utils/request.js'),
    path.join(ROOT, 'utils/constants.js'),
  ]
  let allUtf8 = true
  const bad = []
  for (const p of targets) {
    const raw = fs.readFileSync(p)
    if (!isStrictUtf8(raw)) {
      allUtf8 = false
      bad.push(path.relative(ROOT, p))
    }
  }
  check('关键源码文件均为合法 UTF-8 编码', allUtf8,
    bad.length ? '非 UTF-8: ' + bad.join(', ') : '')
}

console.log('\n==============================================')
console.log('架构级回归测试：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')

if (fail > 0) {
  console.log('\n失败项：')
  failures.forEach(f => console.log('  - ' + f))
  process.exit(1)
} else {
  console.log('\n所有架构不变量校验通过 [OK]')
  process.exit(0)
}
