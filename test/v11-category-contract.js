/**
 * QA-B2 前后端分类契约一致性 —— BUG-P1-011 防复发
 *
 * 背景：BUG-P1-011 根因是「前端 8 分类 vs 后端 5 分类」契约不一致，
 *       导致「农业」「科学」tab 必然空白且自动化未拦住。
 * 本用例把三处分类定义静态拉齐校验：
 *   1) utils/constants.js  CATEGORIES      （前端展示 tab）
 *   2) getNewsList/index.js CATEGORY_NAMES （后端列表云函数返回的分类名映射）
 *   3) refreshNews/zhipuSearch.js CATEGORY_PROMPTS（AI 生成源产出的分类键）
 *
 * 契约口径（owner 2026-08-03 裁定后）：
 *   - 前端内容分类 = CATEGORIES 中除 all 外的 id（现为 tech/international/sports/life）
 *   - 每个前端内容分类 id 必须存在于 CATEGORY_NAMES 与 CATEGORY_PROMPTS（否则 tab 空白 = BUG-P1-011 复发）
 *   - 前端内容分类的中文名与 CATEGORY_NAMES 映射一致
 *
 * 运行：node test/v11-category-contract.js
 */

var fs = require('fs')
var path = require('path')

// ===== 测试框架 =====
var pass = 0
var fail = 0
var failures = []

function check(name, cond, detail) {
  if (cond) {
    pass++
    console.log('  [PASS] ' + name)
  } else {
    fail++
    failures.push(name + (detail ? ' :: ' + detail : ''))
    console.log('  [FAIL] ' + name + (detail ? ' :: ' + detail : ''))
  }
}

function assertEqual(name, actual, expected) {
  check(name, actual === expected,
    'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

// ===== 读取三处定义 =====

// 1) 前端 constants.js（require 真实模块）
var constants = require('../utils/constants.js')
var frontCategories = constants.CATEGORIES || []
var frontIds = frontCategories.map(function (c) { return c.id })
var contentIds = frontIds.filter(function (id) { return id !== 'all' })
var nameById = {}
frontCategories.forEach(function (c) { nameById[c.id] = c.name })

// 2) 云函数 getNewsList CATEGORY_NAMES（正则提取对象键 + 值，支持同行多键）
var getNewsListSrc = fs.readFileSync(
  path.join(__dirname, '../cloudfunctions/getNewsList/index.js'), 'utf8')
var namesObj = {}
var namesMatch = getNewsListSrc.match(/const CATEGORY_NAMES\s*=\s*\{([\s\S]*?)\n\}/)
if (namesMatch) {
  namesMatch[1].split('\n').forEach(function (line) {
    line.split(',').forEach(function (kv) {
      var m = kv.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*'([^']*)'\s*$/)
      if (m) namesObj[m[1]] = m[2]
    })
  })
}
var namesKeys = Object.keys(namesObj)

// 3) 云函数 refreshNews/zhipuSearch CATEGORY_PROMPTS（正则提取对象键）
var zhipuSrc = fs.readFileSync(
  path.join(__dirname, '../cloudfunctions/refreshNews/zhipuSearch.js'), 'utf8')
var promptsKeys = []
var promptsMatch = zhipuSrc.match(/const CATEGORY_PROMPTS\s*=\s*\{([\s\S]*?)\n\}/)
if (promptsMatch) {
  promptsMatch[1].split('\n').forEach(function (line) {
    var m = line.match(/^\s*([a-zA-Z0-9_]+)\s*:/)
    if (m) promptsKeys.push(m[1])
  })
}

console.log('== 前端 CATEGORIES(' + frontIds.length + '): ' + frontIds.join(', '))
console.log('== 内容分类(除 all): ' + contentIds.join(', '))
console.log('== getNewsList CATEGORY_NAMES(' + namesKeys.length + '): ' + namesKeys.join(', '))
console.log('== zhipuSearch CATEGORY_PROMPTS(' + promptsKeys.length + '): ' + promptsKeys.join(', '))
console.log('')

// ===== 断言 =====

// A. 前端 id 唯一
check('A1 前端分类 id 无重复',
  frontIds.length === new Set(frontIds).size,
  'duplicated ids: ' + frontIds.join(','))

// B. 前端内容分类 ⊇ 后端产出（防 BUG-P1-011 复发：tab 必须非空白）
contentIds.forEach(function (id) {
  check('B1 内容分类「' + id + '」存在于 getNewsList CATEGORY_NAMES',
    namesObj.hasOwnProperty(id), 'missing in CATEGORY_NAMES')
  check('B2 内容分类「' + id + '」存在于 refreshNews CATEGORY_PROMPTS',
    promptsKeys.indexOf(id) !== -1, 'missing in CATEGORY_PROMPTS')
})

// C. 中文名一致性（constants.js vs getNewsList CATEGORY_NAMES）
contentIds.forEach(function (id) {
  var expectName = nameById[id]
  var actualName = namesObj[id]
  check('C1 分类「' + id + '」中文名一致 (' + expectName + ' == ' + actualName + ')',
    actualName === expectName,
    'constants=' + expectName + ', CATEGORY_NAMES=' + actualName)
})

// D. 后端不得产出前端未定义的内容分类（防新增 tab 无人知）
//    v4.2 遗留的 finance / entertainment 已由 TL-B11（2026-08-03）彻底清理：
//    已从 refreshNews CATEGORIES、getNewsList CATEGORY_NAMES、tianxing/juhe 映射移除，
//    与 frontend utils/constants.js 对齐。保留 recommend（头条，喂给 all 视图，前端无独立 tab 但属合法产出）。
var KNOWN_BACKEND_ONLY = [] // TL-B11 后已无历史残留分类
namesKeys.forEach(function (key) {
  if (key === 'recommend' || key === 'all') return // 聚合/合并项豁免
  if (KNOWN_BACKEND_ONLY.indexOf(key) !== -1) {
    console.log('  [WARN] 后端独有分类「' + key + '」为已知历史残留（v4.2 遗留，前端无 tab，待 TL-B2 清理裁定）')
    return
  }
  check('D1 后端分类「' + key + '」在前端 CATEGORIES 中有定义',
    frontIds.indexOf(key) !== -1,
    'backend-only category: ' + key)
})
promptsKeys.forEach(function (key) {
  if (key === 'recommend' || key === 'all') return
  check('D2 生成源分类「' + key + '」在前端 CATEGORIES 中有定义',
    frontIds.indexOf(key) !== -1,
    'prompt-only category: ' + key)
})

// E. 关键内容分类必须存在（白名单，防整体误删）
;['tech', 'international', 'sports', 'life'].forEach(function (id) {
  check('E1 必需内容分类「' + id + '」存在', contentIds.indexOf(id) !== -1)
})

// ===== 汇总 =====
console.log('')
console.log('===== 结果: ' + pass + ' 通过, ' + fail + ' 失败 =====')
if (failures.length) {
  console.log('失败项:')
  failures.forEach(function (f) { console.log('  - ' + f) })
  process.exit(1)
}
console.log('分类契约一致 ✅ (BUG-P1-011 防复发)')
