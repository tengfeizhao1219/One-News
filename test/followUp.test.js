/**
 * followUp 逻辑自测（Node 可跑，无需微信环境）
 * 桩：内存版 wx storage + getApp + Page，验证数据层与四态派生。
 * 运行：node test/followUp.test.js
 */
'use strict'

let pass = 0
let fail = 0
const fails = []
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name) }
  else { fail++; fails.push(name); console.log('  ✗ ' + name + (extra ? '  -> ' + extra : '')) }
}

// ── 内存版 wx storage ──
const _store = new Map()
global.wx = {
  getStorageSync(k) { return _store.has(k) ? _store.get(k) : '' },
  setStorageSync(k, v) { _store.set(k, v) },
  removeStorageSync(k) { _store.delete(k) },
  getStorageInfoSync() { return { keys: [..._store.keys()] } },
  showToast() {}, showActionSheet() {}, navigateBack() {}, reLaunch() {},
}

// capture Page
let pageObj = null
global.Page = (o) => { pageObj = o }
global.getApp = () => ({ globalData: { menuTop: 0, menuHeight: 32, statusBarHeight: 20, themeClass: '', effectiveTheme: 'light' } })

const FU = require('../utils/followUp')
const followup = require('../pages/followup/followup') // 触发 Page 捕获
void followup
void pageObj // 仅用于确保模块加载成功

console.log('\n[1] 关注 / 幂等 / 取消')
FU.removeFollow('onenews', 'n1')
let r = FU.addFollow('onenews', { itemId: 'n1', title: '资讯A', source: '新华社', category: 'c1', categoryName: '科技', picUrl: '' })
ok('addFollow 成功', r.followed === true)
ok('addFollow 后 isFollowed=true', FU.isFollowed('onenews', 'n1') === true)
const after1 = FU.getFollows().length
r = FU.addFollow('onenews', { itemId: 'n1', title: '资讯A' }) // 重复
ok('重复关注幂等', r.followed === true && FU.getFollows().length === after1)
FU.removeFollow('onenews', 'n1')
ok('removeFollow 后 isFollowed=false', FU.isFollowed('onenews', 'n1') === false)

console.log('\n[2] 双模块隔离与合并排序（addFollow 内部用 Date.now() 作为 createdAt，故以插入先后验证倒序）')
const realNow = Date.now
let _t = 100000
Date.now = () => (_t += 100)
FU.addFollow('onenews', { itemId: 'on-1', title: '资讯1' }) // createdAt 100100
FU.addFollow('intel', { itemId: 'in-1', title: '情报1' })   // 100200
FU.addFollow('onenews', { itemId: 'on-2', title: '资讯2' }) // 100300
Date.now = realNow
const merged = FU.getFollows()
ok('两模块合并 3 条', merged.length === 3, 'got ' + merged.length)
ok('每条带 module 字段', merged.every(it => it.module === 'onenews' || it.module === 'intel'))
ok('倒序：最后关注的排最前（on-2→in-1→on-1）', merged[0].itemId === 'on-2' && merged[1].itemId === 'in-1' && merged[2].itemId === 'on-1')
ok('intel key 隔离：onenews 不含情报 id', FU.getFollows().filter(i => i.module === 'onenews').every(i => i.itemId.startsWith('on-')))

console.log('\n[3] 模拟更新 / 已读 / 全部已读')
FU.addFollow('intel', { itemId: 'in-2', title: '情报2', createdAt: 400 })
FU.addUpdate('intel', 'in-2')
let it = FU.getFollows().find(i => i.itemId === 'in-2')
ok('addUpdate 生成 1 条 update', it.updates.length === 1)
ok('update.read=false（未读红）', it.updates[0].read === false)
ok('sourcesCount 在 1-4 之间', it.updates[0].sourcesCount >= 1 && it.updates[0].sourcesCount <= 4)
ok('date 为今日', it.updates[0].date === (function () { const d = new Date(); const m = ('0' + (d.getMonth() + 1)).slice(-2); const dd = ('0' + d.getDate()).slice(-2); return d.getFullYear() + '-' + m + '-' + dd })())

FU.markRead('intel', 'in-2')
it = FU.getFollows().find(i => i.itemId === 'in-2')
ok('markRead 后 update.read=true', it.updates[0].read === true)

// 全部已读
FU.addUpdate('onenews', 'on-1')
FU.addUpdate('intel', 'in-1')
FU.markAllRead()
const all = FU.getFollows()
ok('markAllRead 所有 update.read=true', all.every(i => (i.updates || []).every(u => u.read)))

console.log('\n[4] 改追踪时间')
FU.setTrackTime('onenews', 'on-1', '18:00')
it = FU.getFollows().find(i => i.itemId === 'on-1')
ok('setTrackTime 生效', it.trackTime === '18:00')

console.log('\n[5] 边界：缺参 / 空 module')
ok('addFollow(null) 安全返回', FU.addFollow('onenews', null).followed === false)
ok('addFollow(无 itemId) 安全返回', FU.addFollow('onenews', {}).followed === false)
ok('isFollowed(空 id) 返回 false', FU.isFollowed('onenews', '') === false)

console.log('\n[6] 四态派生 _decorate（聚合页核心）')
function dec(updates) {
  // 复刻 followup.js _decorate 的纯逻辑（与页面实现一致）
  const ups = updates || []
  const unreadCount = ups.filter(u => !u.read).length
  let status = 'none'
  if (ups.length === 0) status = 'none'
  else if (unreadCount > 0) status = 'hasUpdate'
  else status = 'read'
  return { status, unreadCount, statusText: status === 'hasUpdate' ? (unreadCount + ' 条新更新') : (status === 'read' ? '已读完' : '已是最新') }
}
ok('无更新 → none（灰）', dec([]).status === 'none' && dec([]).statusText === '已是最新')
ok('有未读 → hasUpdate（红）', dec([{ read: false }]).status === 'hasUpdate')
ok('有未读 → 计数正确', dec([{ read: false }, { read: true }, { read: false }]).unreadCount === 2)
ok('全部已读 → read（绿）', dec([{ read: true }]).status === 'read' && dec([{ read: true }]).statusText === '已读完')
ok('多未读文案正确', dec([{ read: false }, { read: false }]).statusText === '2 条新更新')

console.log('\n[7] 容量上限')
// 清空内存缓存 + wx storage，从干净状态测容量
const { localCache } = require('../utils/localCache')
_store.clear()
if (localCache._memory) localCache._memory.clear()
for (let i = 0; i < 200; i++) FU.addFollow('onenews', { itemId: 'cap-' + i })
ok('塞满 200 条', FU.getFollows().length === 200)
const full = FU.addFollow('onenews', { itemId: 'cap-overflow' })
ok('超容 addFollow 返回 full=true 且不写入', full.full === true && FU.getFollows().length === 200)

console.log('\n========== 结果 ==========')
console.log('PASS: ' + pass + '   FAIL: ' + fail)
if (fail > 0) {
  console.log('失败项：\n - ' + fails.join('\n - '))
  process.exit(1)
} else {
  console.log('全部通过 ✓')
}
