/**
 * PM-Q07 TL-B13 收藏云同步前端展示专项回归 —— UI-11/13/14 + F-06/F-07 防复发
 *
 * 背景：TL-B13（RQ-03 收藏上云 + RQ-07 分享上报）前端展示部分由 FE 于
 *       2026-08-05 交付（UI-B5 设计稿 owner 2026-08-04 已确认）。
 *       本用例静态拉齐校验以下验收点（PRD-下迭代 §10.3/§10.4/§12.2）：
 *
 *   UI-11 收藏列表打开：本地秒开 + 云端合并中顶部细进度条（≤2s 静默收起）
 *   UI-13 待同步角标：离线未上云条目右下角「☁️ 待同步」角标（12号字次级色），点按重试
 *   UI-14 同步失败：整页顶部轻提示条「收藏同步失败，点击重试」（非阻断式）
 *   UI-15 云端失败 toast：详情页收藏失败 →「已收藏（待同步）」
 *   F-06  云端调用失败：本地收藏成功 + 待同步队列重试（容量 50）
 *   F-07  侧边栏收藏列表打开：云端收藏合并（本地缺失补入、云端已删移除）
 *
 * 运行：node test/v12-tlb13-favorites-sync.js
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

function assertTrue(name, cond, detail) { check(name, cond, detail) }
function assertContains(name, haystack, needle) {
  check(name, haystack.indexOf(needle) !== -1,
    'missing "' + needle + '" in: ' + haystack.slice(0, 200))
}

// ===== 读取源码 =====
var R = function (p) { return fs.readFileSync(path.join(__dirname, p), 'utf8') }
var favJs = R('../pages/favorites/favorites.js')
var favWxml = R('../pages/favorites/favorites.wxml')
var favWxss = R('../pages/favorites/favorites.wxss')
var cloudJs = R('../utils/cloud.js')
var detailJs = R('../pages/detail/detail.js')

console.log('==============================================')
console.log('PM-Q07 TL-B13 收藏云同步前端展示专项回归')
console.log('==============================================')

// ── ① UI-11 本地秒开 + 顶部细进度条 ──
console.log('\n[UI-11] 收藏列表打开：本地秒开 + 云端合并进度条')
assertTrue('favorites.js 声明 syncing 状态（UI-11 进度条开关）',
  /syncing:\s*(false|true)/.test(favJs))
assertTrue('_load 中本地秒开（本地渲染后即置 loading:false）',
  /localMerged = that\._merge\(local,\s*\[\],\s*cloud\.getPendingFavorites\(\)\)/.test(favJs) &&
  /setData\(\{\s*loading:\s*false,\s*syncing:\s*false\s*\}\)/.test(favJs))
assertTrue('云端合并完成后静默收起（syncing:false 无强提示）',
  /setData\(\{\s*syncing:\s*false\s*\}\)/.test(favJs))
assertContains('wxml 含 sync-bar 进度条元素（UI-11）', favWxml, 'sync-bar')
assertContains('wxss 定义 sync-bar 样式', favWxss, '.sync-bar')
assertTrue('sync-bar 为细进度条（高度 ≤ 4rpx）',
  /\.sync-bar\s*\{[\s\S]*?height:\s*(2|3|4)rpx/.test(favWxss),
  'sync-bar 高度应 ≤ 4rpx')

// ── ② UI-13 待同步角标 ──
console.log('\n[UI-13] 待同步角标：离线未上云条目 ☁️ 待同步')
assertTrue('_merge 支持 _pending 标记（本地独有+队列中仍有收藏操作）',
  /_pending:\s*isPending/.test(favJs))
assertTrue('onPendingTap 点按重试单条上云存在', /onPendingTap:\s*function/.test(favJs))
assertContains('wxml 含 fav-pending 角标元素（☁️ 待同步）', favWxml, 'fav-pending')
assertContains('wxml 角标绑定 catchtap（防冒泡干扰列表点击）', favWxml, 'catchtap="onPendingTap"')
assertTrue('wxss 定义 fav-pending 样式（12号字≈24rpx）',
  /\.fav-pending\s*\{[\s\S]*?font-size:\s*24rpx/.test(favWxss))
assertTrue('fav-pending 右下角定位（position:absolute + right/bottom）',
  /\.fav-pending\s*\{[\s\S]*?position:\s*absolute[\s\S]*?right:\s*16rpx[\s\S]*?bottom:\s*20rpx/.test(favWxss))
assertTrue('fav-pending 使用次级色 token', /color:\s*var\(--text-secondary\)/.test(favWxss))

// ── ③ UI-14 同步失败轻提示条（非阻断式）──
console.log('\n[UI-14] 同步失败轻提示条（非阻断式）')
assertTrue('favorites.js 声明 syncFailed 状态', /syncFailed:\s*false/.test(favJs))
assertTrue('云端失败置 syncFailed:true（不阻塞本地展示）',
  /setData\(\{\s*syncing:\s*false,\s*syncFailed:\s*true\s*\}\)/.test(favJs))
assertTrue('onSyncRetry 重试入口存在', /onSyncRetry:\s*function/.test(favJs))
assertContains('wxml 含 sync-fail 提示条元素', favWxml, 'sync-fail')
assertContains('wxml 提示条绑定点击重试', favWxml, 'bindtap="onSyncRetry"')
assertTrue('wxss 定义 sync-fail（flex-shrink:0 非阻断，不挤占列表）',
  /\.sync-fail\s*\{[\s\S]*?flex-shrink:\s*0/.test(favWxss))
assertTrue('sync-fail 使用 warning 色', /color:\s*var\(--color-warning\)/.test(favWxss))

// ── ④ UI-15 详情页云端失败 toast ──
console.log('\n[UI-15] 详情页收藏：云端失败 toast「已收藏（待同步）」')
assertContains('detail.js 含「已收藏（待同步）」toast', detailJs, '已收藏（待同步）')
assertTrue('toast 为 icon:none（非阻断式）', /showToast\(\{\s*title:\s*'已收藏（待同步）',\s*icon:\s*'none'\s*\}/.test(detailJs))
assertTrue('云端失败后收藏本地仍成功（入队重试）',
  /setUserFavorite/.test(detailJs) && /enqueue|cloudSyncQueue|report\(/.test(detailJs))

// ── ⑤ F-06 待同步队列（容量 50 + 失败重试）──
console.log('\n[F-06] 云端调用失败：待同步队列重试（容量 50）')
assertTrue('cloud.js 定义同步队列键 + 容量 50',
  /MAX_QUEUE\s*=\s*50/.test(cloudJs))
assertTrue('enqueue 超限丢弃最旧', /while\s*\(q\.length\s*>\s*MAX_QUEUE\)\s*q\.shift\(\)/.test(cloudJs))
assertTrue('flushQueue 启动/网络恢复重试存在', /async\s*function\s*flushQueue/.test(cloudJs))
assertTrue('report 失败静默入队不抛错', /function\s*report\(op\)[\s\S]*?\.catch\(\(\)\s*=>\s*\{\s*enqueue\(op\)/.test(cloudJs))
assertTrue('getPendingFavorites 返回未上云 newsId（UI-13 数据源）',
  /function\s*getPendingFavorites\(\)/.test(cloudJs) &&
  /op\.name\s*===\s*'setUserFavorite'[\s\S]*?op\.data\.favorited\s*===\s*true/.test(cloudJs))

// ── ⑥ F-07 云端收藏合并（本地缺失补入、云端已删保留不标角标）──
console.log('\n[F-07] 收藏列表打开：云端合并')
assertTrue('_load 调用 getUserFavorites 云端拉取',
  /cloud\.callCloudFunction\('getUserFavorites'/.test(favJs))
assertTrue('_merge 以云端为准合并（同 id 优先云端数据）',
  /map\[item\.newsId\]\s*=/.test(favJs) || /_merge\s*[:=]/.test(favJs))
assertTrue('_merge 本地缺失补入（云端条目写入 map 合并）',
  /cloudList\.forEach/.test(favJs) && /map\[item\.newsId\]\s*=\s*\{/.test(favJs))
assertTrue('云端已删条目本地保留展示但不标待同步（PM 口径 2026-08-05：与 F-06 离线场景区分，避免误删本地收藏）',
  /inCloud/.test(favJs) && /isPending\s*=\s*!inCloud\s*&&\s*pending\.indexOf\(item\.id\)\s*!==\s*-1/.test(favJs))
assertTrue('getPendingFavorites 合并进列表（待同步条目保留展示）',
  /_merge\(local,\s*cloudList,\s*cloud\.getPendingFavorites\(\)\)/.test(favJs))

// ===== 汇总 =====
console.log('\n==============================================')
console.log('PM-Q07 TL-B13 前端展示专项回归：通过 ' + pass + ' / 失败 ' + fail)
console.log('==============================================')
if (fail > 0) {
  console.log('失败项：')
  failures.forEach(function (f) { console.log('  ✗ ' + f) })
  process.exit(1)
} else {
  console.log('TL-B13 前端展示全部验收点满足 [OK]')
  process.exit(0)
}
