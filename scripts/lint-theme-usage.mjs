#!/usr/bin/env node
/**
 * lint-theme-usage.mjs — One News UX-FIX-STD 巡检脚本
 *
 * 目的：发布前自检,扫 pages/components 全部 .wxml/.wxss,把"主题变量化"规则
 *       违反点打成问题清单,标红给 owner 看。
 *
 * 检查项:
 *   ① wxss 硬编码颜色字面量(#RGB / #RRGGBB / #RRGGBBAA / rgb()/rgba() 黑白灰蒙层白名单除外)
 *   ② wxss 用了 var(--xxx) 但 --xxx 不在 theme.json 已注册的变量白名单(防止笔误)
 *   ③ wxss 用 px 而非 rpx(calc(var(--x, 0px)) 默认值白名单除外)
 *   ④ wxml 里 wxss 引用了未定义的 class(跨页同名前缀比对的近似检查)
 *   ⑤ wxss 顶部 :root { --xxx: ... } 自定义变量(应集中在 theme.json,避免分散)
 *   ⑥ wxml style 内联颜色字面量(鼓励挪到 wxss 走 theme)
 *   ⑦ 跨文件/跨包引用:wxss 里 var(--xxx) 在所有 wxss 内任意 :root 出现则降为 warning,
 *      完全未声明才升 error(便于识别"runtime 注入"场景)
 *
 * 用法:
 *   node scripts/lint-theme-usage.mjs                 # 默认扫 pages + components
 *   node scripts/lint-theme-usage.mjs --strict        # 把"warning"也当 error
 *   node scripts/lint-theme-usage.mjs --json          # 输出 JSON 报告
 *
 * 退出码:0 = 通过 / 仅有 warning,1 = 至少一条 error
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const THEME = JSON.parse(readFileSync(join(ROOT, 'theme.json'), 'utf8'))
const ARGS = new Set(process.argv.slice(2))
const STRICT = ARGS.has('--strict')
const JSON_OUT = ARGS.has('--json')
const SCAN_DIRS = ['pages', 'components']

// ---- 收集合法 CSS 变量名(以 light 集为准,深色同名) ----
// theme.json 的 key 形如 "--bg-page",白名单存去前缀的 "bg-page",跟 VAR_RE 的 group 1 对齐
function stripPrefix(k) { return k.replace(/^--/, '') }
const KNOWN_VARS = new Set(Object.keys(THEME.light).map(stripPrefix))
for (const v of Object.keys(THEME.dark)) KNOWN_VARS.add(stripPrefix(v))

// ---- 收集所有 wxml/wxss 文件 ----
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const s = statSync(p)
    if (s.isDirectory()) walk(p, out)
    else if (/\.(wxml|wxss)$/.test(name)) out.push(p)
  }
  return out
}

const files = SCAN_DIRS.flatMap(d => walk(join(ROOT, d)))
const wxmlFiles = files.filter(f => f.endsWith('.wxml'))
const wxssFiles = files.filter(f => f.endsWith('.wxss'))

// ---- 白名单:黑白蒙层 rgba(0,0,0,*) / rgba(255,255,255,*) / 透明黑(0,0,0,0) ----
const RGBA_MONOCHROME = /rgba?\(\s*(0\s*,\s*0\s*,\s*0|255\s*,\s*255\s*,\s*255)\b/

// ---- 颜色字面量匹配 ----
const HEX_RE = /#[0-9A-Fa-f]{3,8}\b/g
const RGB_RE = /\brgba?\s*\([^)]+\)/g
// wxml style 属性内的颜色(组件动态 style) — 允许,但单独列出来供 owner 知会
const WXML_STYLE_HEX_RE = /style="[^"]*#[0-9A-Fa-f]{3,8}[^"]*"/g

// ---- var(--xxx) 匹配 ----
const VAR_RE = /var\(\s*--([a-zA-Z][\w-]*)/g

// ---- 非 rpx 的 px 数字 ----
const PX_RE = /(?<![a-zA-Z0-9_-])(\d+(?:\.\d+)?)px\b/g

// ---- 结果聚合 ----
const issues = []
let errCount = 0
let warnCount = 0

function record(file, line, col, severity, code, msg) {
  if (severity === 'error') errCount++
  else warnCount++
  issues.push({ file: relative(ROOT, file), line, col, severity, code, msg })
}

// ---- 扫 wxss ----
// 第一遍:收集 :root { --xxx: ... } 内部声明(用于 unknown-var 降级 + 提示集中)
const wxssRootDecls = new Map() // varName(去--) -> file
for (const file of wxssFiles) {
  const src = readFileSync(file, 'utf8')
  // 简易 :root { ... } 提取(支持嵌套 {},但本项目 wxss 嵌套浅,够用)
  const rootBlocks = [...src.matchAll(/:root\s*\{([^}]+)\}/g)]
  for (const block of rootBlocks) {
    for (const m of block[1].matchAll(/--([a-zA-Z][\w-]*)\s*:/g)) {
      if (!wxssRootDecls.has(m[1])) wxssRootDecls.set(m[1], relative(ROOT, file))
    }
  }
}

for (const file of wxssFiles) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')

  lines.forEach((line, i) => {
    const lineNo = i + 1

    // ① 硬编码颜色(排除纯注释行 / 排除黑白蒙层白名单)
    if (!/^\s*\/\//.test(line) && !/^\s*\*/.test(line) && !/^\s*\/\*/.test(line)) {
      // HEX
      for (const m of line.matchAll(HEX_RE)) {
        record(file, lineNo, m.index + 1, 'error', 'hardcoded-hex',
          `硬编码颜色 ${m[0]} — 应改用 var(--xxx) 走 theme.json`)
      }
      // rgba/rgb(黑白蒙层白名单)
      for (const m of line.matchAll(RGB_RE)) {
        if (RGBA_MONOCHROME.test(m[0])) continue  // 黑白蒙层合法
        record(file, lineNo, m.index + 1, 'warning', 'hardcoded-rgba',
          `硬编码颜色 ${m[0]} — 如果是品牌色/状态色,应注册到 theme.json 后用 var(--xxx)`)
      }
    }

    // ② var(--xxx) 校验:必须存在于 theme.json
    //   - 完全未声明  → error
    //   - 仅在 wxss 内部 :root 声明但未进 theme.json → warning(提示集中到 theme.json)
    for (const m of line.matchAll(VAR_RE)) {
      const name = m[1]
      if (KNOWN_VARS.has(name)) continue
      if (wxssRootDecls.has(name)) {
        record(file, lineNo, m.index + 1, 'warning', 'var-in-wxss-root',
          `var(--${name}) 仅在 ${wxssRootDecls.get(name)} 的 :root 声明,未进 theme.json — 建议集中到 theme.json (scope: static)`)
      } else {
        record(file, lineNo, m.index + 1, 'error', 'unknown-var',
          `var(--${name}) 完全未声明 — 既不在 theme.json,也不在任何 wxss 的 :root(若是运行时注入,JS 端需 setData 到 style 或加进 theme.json 标 scope: runtime)`)
      }
    }

    // ③ px 误用:calc(var(--x, 0px)) 里的默认值允许;其他位置要警告
    for (const m of line.matchAll(PX_RE)) {
      // calc(var(--*, 0px)) 的默认值 — 合法
      if (/\(\s*var\([^)]*,\s*0?\s*px\s*\)/.test(line)) continue
      // 0px 单独出现(常见 0 默认) — 合法
      if (m[1] === '0') continue
      record(file, lineNo, m.index + 1, 'warning', 'px-instead-of-rpx',
        `使用 ${m[1]}px — 小程序布局请改 rpx(750 设计稿 1rpx ≈ 0.5px)`)
    }
  })
}

// ---- ⑤ wxss 内部 :root 声明但未进 theme.json:提醒集中 ----
for (const [name, file] of wxssRootDecls) {
  if (KNOWN_VARS.has(name)) continue  // 已注册的合法
  // 找该变量第一次声明的行号
  const full = join(ROOT, file)
  const src = readFileSync(full, 'utf8')
  const lines = src.split('\n')
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`--${name}\\s*:`).test(lines[i])) {
      record(full, i + 1, 1, 'warning', 'root-decl-not-in-theme',
        `--${name} 在 ${file} 的 :root 内定义,未进 theme.json — 建议迁入并标 scope: static`)
      break
    }
  }
}

// ---- 扫 wxml:style 内联颜色 ----
for (const file of wxmlFiles) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*<!--/.test(line)) return  // 注释行跳过
    for (const m of line.matchAll(WXML_STYLE_HEX_RE)) {
      const col = m.index + 1
      record(file, i + 1, col, 'warning', 'wxml-style-hardcoded',
        `wxml 内联 style 含硬编码色 — 建议挪到 wxss 走 theme 变量`)
    }
  })
}

// ---- ④ class 引用一致性:扫 wxml 里 class="..." 的所有 token,跟 wxss 里定义的类比 ----
const wxssClassDefs = new Map() // className -> file
for (const file of wxssFiles) {
  const src = readFileSync(file, 'utf8')
  for (const m of src.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) {
    const name = m[1]
    if (!wxssClassDefs.has(name)) wxssClassDefs.set(name, relative(ROOT, file))
  }
}

for (const file of wxmlFiles) {
  const src = readFileSync(file, 'utf8')
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (/^\s*<!--/.test(line)) return
    for (const m of line.matchAll(/\bclass="([^"]*)"/g)) {
      const raw = m[1]
      // 整段是动态表达式或拼接表达式,直接跳过(无法静态校验)
      if (raw.includes('{{')) continue
      const tokens = raw.split(/\s+/).filter(Boolean)
      for (const t of tokens) {
        if (!wxssClassDefs.has(t)) {
          record(file, i + 1, m.index + 1, 'warning', 'class-undef',
            `class="${t}" 在所有 wxss 中未找到定义(可能是组件类或全局类,自检)`)
        }
      }
    }
  })
}

// ---- 输出 ----
if (JSON_OUT) {
  console.log(JSON.stringify({ errCount, warnCount, issues }, null, 2))
} else {
  const byFile = new Map()
  for (const it of issues) {
    if (!byFile.has(it.file)) byFile.set(it.file, [])
    byFile.get(it.file).push(it)
  }
  if (issues.length === 0) {
    console.log('✅ UX-FIX-STD:全部通过,0 错误 / 0 警告')
  } else {
    console.log(`UX-FIX-STD 巡检结果:  ${errCount} error / ${warnCount} warning\n`)
    for (const [f, list] of byFile) {
      console.log(`\n📄 ${f}`)
      for (const it of list) {
        const tag = it.severity === 'error' ? '🔴 E' : '🟡 W'
        console.log(`  ${tag} L${it.line}:${it.col}  [${it.code}]  ${it.msg}`)
      }
    }
    if (STRICT && warnCount > 0) {
      console.log(`\n⛔ --strict 模式下 ${warnCount} 条 warning 视为 error,exit 1`)
    }
  }
  console.log(`\n总计 ${issues.length} 条问题 · 扫了 ${files.length} 个文件(${wxmlFiles.length} wxml + ${wxssFiles.length} wxss)`)
}

process.exit(errCount > 0 || (STRICT && warnCount > 0) ? 1 : 0)
