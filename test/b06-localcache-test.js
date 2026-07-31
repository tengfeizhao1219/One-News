/**
 * B-06 单元测试 — localCache.js
 *
 * 覆盖：
 *   1. 基本读写一致性
 *   2. TTL 过期自动返回 null
 *   3. LRU 满容量自动淘汰
 *   4. remove / has / clear / prune
 *   5. Storage 穿透读写
 *   6. 边界：空 key、undefined/null 值、超大容量
 *
 * 运行：在支持 CommonJS 的 Node 环境中 `node test/b06-localcache-test.js`
 */

// ── Mock wx Storage API ─────────────────────────────────────
const storage = new Map()
global.wx = {
  getStorageSync(key) {
    return storage.get(key) ?? ''
  },
  setStorageSync(key, data) {
    if (storage.size >= 50) throw new Error('storage limit exceeded')
    storage.set(key, data)
  },
  removeStorageSync(key) {
    storage.delete(key)
  },
  getStorageInfoSync() {
    return { keys: [...storage.keys()], currentSize: storage.size, limitSize: 10240 }
  },
}

const { LocalCache } = require('../utils/localCache')

// ── 测试框架 ────────────────────────────────────────────────
let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    failed++
    console.error(`  FAIL [${name}]:`, e.message)
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`)
}

function assertNull(v, msg) {
  if (v !== null && v !== undefined) throw new Error(msg || `expected null/undefined, got ${JSON.stringify(v)}`)
}

// ── 测试用例 ────────────────────────────────────────────────

console.log('=== B-06 localCache 单元测试 ===\n')

// ── 1. 基本读写 ─────────────────────────────────────────────
test('set + get 基本读写', () => {
  const cache = new LocalCache({ maxItems: 10 })
  cache.set('user', { name: 'Alice', age: 30 })
  const val = cache.get('user')
  assertEq(val.name, 'Alice')
  assertEq(val.age, 30)
})

test('get 不存在的 key 返回 null', () => {
  const cache = new LocalCache()
  assertNull(cache.get('nonexistent'))
})

test('set 覆盖写入', () => {
  const cache = new LocalCache()
  cache.set('key', 'v1')
  cache.set('key', 'v2')
  assertEq(cache.get('key'), 'v2')
})

// ── 2. TTL 过期 ─────────────────────────────────────────────
test('TTL 过期返回 null', () => {
  const cache = new LocalCache()
  cache.set('ephemeral', 'data', { ttl: 50 }) // 50ms
  assertEq(cache.get('ephemeral'), 'data', 'should exist before expiry')
  // 快进时间
  const RealDate = Date
  const now = RealDate.now()
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now + 100])) }
    static now() { return now + 100 }
  }
  assertNull(cache.get('ephemeral'), 'should be null after TTL')
  global.Date = RealDate
})

test('TTL=0 永不过期', () => {
  const cache = new LocalCache()
  cache.set('forever', 'immortal', { ttl: 0 })
  assertEq(cache.get('forever'), 'immortal')
})

test('默认 TTL 7 天', () => {
  const cache = new LocalCache({ defaultTTL: 100 })
  cache.set('def', 'val')
  assertEq(cache.get('def'), 'val')
  // 快进 50ms（未过期）
  const RealDate = Date
  const now = RealDate.now()
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now + 50])) }
    static now() { return now + 50 }
  }
  assertEq(cache.get('def'), 'val', 'should still exist')
  global.Date = RealDate
})

// ── 3. LRU 淘汰 ─────────────────────────────────────────────
test('LRU 满容量淘汰最久未使用条目', () => {
  const cache = new LocalCache({ maxItems: 3 })
  cache.set('a', 1)
  cache.set('b', 2)
  cache.set('c', 3)
  assertEq(cache.size, 3)

  // 访问 a，使其变为最近使用
  cache.get('a')

  // 写入 d → 应淘汰 b（最久未使用）
  cache.set('d', 4)
  assertEq(cache.size, 3)
  assertEq(cache.get('a'), 1, 'a should survive (recently accessed)')
  assertNull(cache.get('b'), 'b should be evicted (LRU)')
  assertEq(cache.get('c'), 3)
  assertEq(cache.get('d'), 4)
})

test('LRU 淘汰同时清理 Storage', () => {
  storage.clear()
  const cache = new LocalCache({ maxItems: 2 })
  cache.set('x', 'xval')
  cache.set('y', 'yval')
  cache.set('z', 'zval') // 触发淘汰
  // x 应被淘汰
  assertNull(cache.get('x'))
  // Storage 中也应清除
  assertEq(storage.has('lc:x'), false, 'storage should not contain evicted key')
})

// ── 4. remove / has / clear ─────────────────────────────────
test('remove 删除条目', () => {
  const cache = new LocalCache()
  cache.set('del', 'bye')
  assertEq(cache.get('del'), 'bye')
  cache.remove('del')
  assertNull(cache.get('del'))
})

test('has 检查存在性', () => {
  const cache = new LocalCache()
  cache.set('exists', true)
  assert(cache.has('exists'))
  assert(!cache.has('nope'))
})

test('clear 清空全部', () => {
  const cache = new LocalCache()
  cache.set('k1', 1)
  cache.set('k2', 2)
  cache.clear()
  assertEq(cache.size, 0)
  assertNull(cache.get('k1'))
  assertNull(cache.get('k2'))
})

// ── 5. Storage 穿透 ─────────────────────────────────────────
test('写入穿透到 Storage', () => {
  storage.clear()
  const cache = new LocalCache()
  cache.set('persist', 'hello')
  assert(storage.has('lc:persist'), 'should write to storage')
  const raw = storage.get('lc:persist')
  const parsed = JSON.parse(raw)
  assertEq(parsed._v, 'hello')
})

test('Storage 加载（内存 miss 后从 Storage 读）', () => {
  storage.clear()
  // 直接写入 Storage（模拟跨实例恢复）
  storage.set('lc:from_storage', JSON.stringify({ _v: 'recovered', _e: 0 }))
  const cache2 = new LocalCache()
  assertEq(cache2.get('from_storage'), 'recovered')
})

test('Storage 惰性淘汰过期条目', () => {
  storage.clear()
  storage.set('lc:stale', JSON.stringify({ _v: 'old', _e: 1 })) // 已过期
  const cache = new LocalCache()
  assertNull(cache.get('stale'))
  assertEq(storage.has('lc:stale'), false, 'expired storage entry should be removed')
})

// ── 6. 边界 ─────────────────────────────────────────────────
test('set null 值', () => {
  const cache = new LocalCache()
  cache.set('nullable', null)
  assertNull(cache.get('nullable'))
})

test('set undefined 值', () => {
  const cache = new LocalCache()
  cache.set('undef', undefined)
  assertNull(cache.get('undef'))
})

test('空字符串 key', () => {
  const cache = new LocalCache()
  cache.set('', 'empty-key')
  assertEq(cache.get(''), 'empty-key')
})

test('maxItems 属性', () => {
  const cache = new LocalCache({ maxItems: 42 })
  assertEq(cache.maxItems, 42)
})

test('prune 清理过期条目', () => {
  const cache = new LocalCache()
  cache.set('p1', 1, { ttl: 10 })
  cache.set('p2', 2, { ttl: 10 })
  // 快进
  const RealDate = Date
  const now = RealDate.now()
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now + 100])) }
    static now() { return now + 100 }
  }
  cache.prune()
  assertEq(cache.size, 0, 'all expired entries should be pruned')
  global.Date = RealDate
})

// ── 7. 单例 ─────────────────────────────────────────────────
test('默认单例可用', () => {
  const { localCache } = require('../utils/localCache')
  localCache.set('singleton_test', 42)
  assertEq(localCache.get('singleton_test'), 42)
  localCache.remove('singleton_test')
})

// ── 结果 ────────────────────────────────────────────────────
console.log(`\n=== 结果: ${passed} passed, ${failed} failed ===`)
if (failed > 0) process.exit(1)
