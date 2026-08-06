/**
 * 统一本地存储封装 — B-06
 *
 * 设计：
 *   - 底层：wx.setStorageSync / wx.getStorageSync（微信小程序 10MB 上限）
 *   - 热层：Map 内存缓存（读免 I/O），写入时穿透到 Storage
 *   - TTL：每条记录独立过期时间，读取时惰性淘汰
 *   - LRU：固定容量上限，超出时淘汰最久未使用条目（内存 + Storage 同步淘汰）
 *   - 命名空间：所有 key 自动加 `lc:` 前缀
 *
 * 验收：TTL 过期自动返回 null + LRU 满容量自动淘汰 + 读写一致 + 内存/Storage 双写
 *
 * 依赖：无（纯工具模块，前后端通用）
 */

const PREFIX = 'lc:'
const DEFAULT_MAX_ITEMS = 200
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000 // 7 天

class LocalCache {
  constructor(options = {}) {
    this._maxItems = options.maxItems || DEFAULT_MAX_ITEMS
    this._defaultTTL = options.defaultTTL || DEFAULT_TTL
    this._memory = new Map() // key → { value, expireAt, lastAccess }
    this._accessCounter = 0 // 单调递增，确保 LRU 排序稳定
  }

  // ── 私有方法 ──────────────────────────────────────────────

  /** 生成带前缀的 key */
  _key(rawKey) {
    return PREFIX + rawKey
  }

  /** 从 Storage 加载一条 */
  _loadFromStorage(prefixedKey) {
    try {
      const raw = wx.getStorageSync(prefixedKey)
      if (!raw) return null
      const entry = JSON.parse(raw)
      if (entry._e && Date.now() > entry._e) {
        // 惰性淘汰
        wx.removeStorageSync(prefixedKey)
        return null
      }
      return { value: entry._v, expireAt: entry._e || 0, lastAccess: ++this._accessCounter }
    } catch (_) {
      return null
    }
  }

  /** 写一条到 Storage */
  _saveToStorage(prefixedKey, value, expireAt) {
    try {
      wx.setStorageSync(prefixedKey, JSON.stringify({ _v: value, _e: expireAt }))
    } catch (e) {
      // Storage 满 → 触发 LRU 淘汰，重试一次
      if (e.errMsg && e.errMsg.includes('limit')) {
        this._evictLRU(1)
        try { wx.setStorageSync(prefixedKey, JSON.stringify({ _v: value, _e: expireAt })) } catch (_) { /* 最终失败，内存仍可用 */ }
      }
    }
  }

  /** 淘汰最久未使用的 n 条（内存 + Storage） */
  _evictLRU(n) {
    const entries = [...this._memory.entries()]
      .sort((a, b) => a[1].lastAccess - b[1].lastAccess)
    for (let i = 0; i < Math.min(n, entries.length); i++) {
      const [key] = entries[i]
      this._memory.delete(key)
      try { wx.removeStorageSync(key) } catch (_) { /* ignore */ }
    }
  }

  /** 淘汰过期条目 */
  _evictExpired() {
    const now = Date.now()
    for (const [key, entry] of this._memory) {
      if (entry.expireAt && now > entry.expireAt) {
        this._memory.delete(key)
        try { wx.removeStorageSync(key) } catch (_) { /* ignore */ }
      }
    }
  }

  // ── 公开 API ──────────────────────────────────────────────

  /**
   * 读取缓存
   * @param {string} rawKey - 原始 key（自动加 lc: 前缀）
   * @returns {*|null} 缓存值，过期/不存在返回 null
   */
  get(rawKey) {
    const prefixedKey = this._key(rawKey)

    // 1) 内存命中
    if (this._memory.has(prefixedKey)) {
      const entry = this._memory.get(prefixedKey)
      if (entry.expireAt && Date.now() > entry.expireAt) {
        this._memory.delete(prefixedKey)
        try { wx.removeStorageSync(prefixedKey) } catch (_) { /* ignore */ }
        return null
      }
      entry.lastAccess = ++this._accessCounter // 单调递增确保 LRU 排序稳定
      return entry.value
    }

    // 2) 内存未命中 → 从 Storage 加载
    const entry = this._loadFromStorage(prefixedKey)
    if (!entry) return null
    this._memory.set(prefixedKey, entry)
    return entry.value
  }

  /**
   * 写入缓存（内存 + Storage 双写）
   * @param {string} rawKey
   * @param {*} value - 必须可 JSON 序列化
   * @param {object} [options]
   * @param {number} [options.ttl] - 过期时间（毫秒），默认 7 天，0 表示永不过期
   */
  set(rawKey, value, options = {}) {
    const prefixedKey = this._key(rawKey)
    const ttl = options.ttl !== undefined ? options.ttl : this._defaultTTL
    const expireAt = ttl === 0 ? 0 : Date.now() + ttl

    const entry = { value, expireAt, lastAccess: ++this._accessCounter }
    this._memory.set(prefixedKey, entry)

    // LRU 淘汰（内存 + Storage）
    if (this._memory.size > this._maxItems) {
      this._evictLRU(this._memory.size - this._maxItems)
    }

    // 穿透写 Storage
    this._saveToStorage(prefixedKey, value, expireAt)
  }

  /**
   * 删除缓存
   * @param {string} rawKey
   */
  remove(rawKey) {
    const prefixedKey = this._key(rawKey)
    this._memory.delete(prefixedKey)
    try { wx.removeStorageSync(prefixedKey) } catch (_) { /* ignore */ }
  }

  /**
   * 检查是否存在且未过期
   * @param {string} rawKey
   * @returns {boolean}
   */
  has(rawKey) {
    return this.get(rawKey) !== null
  }

  /**
   * 清空全部缓存（内存 + Storage 中的 lc: 前缀条目）
   */
  clear() {
    this._memory.clear()
    try {
      const { keys } = wx.getStorageInfoSync()
      for (const k of keys) {
        if (k.startsWith(PREFIX)) wx.removeStorageSync(k)
      }
    } catch (_) { /* ignore */ }
  }

  /**
   * 获取当前缓存条目数（内存层）
   * @returns {number}
   */
  get size() {
    return this._memory.size
  }

  /**
   * 获取最大容量
   * @returns {number}
   */
  get maxItems() {
    return this._maxItems
  }

  /**
   * 手动触发过期清理
   */
  prune() {
    this._evictExpired()
  }
}

// 默认单例（项目全局使用 · BUG-20260806-006：全项目统一用此单例，避免多实例内存隔离 stale read）
// 容量 500：与 detail 引擎缓存规模匹配（7 分类列表 + 各分类详情缓存 + favorites + browseHistory）
const localCache = new LocalCache({ maxItems: 500, defaultTTL: 7 * 24 * 60 * 60 * 1000 })

module.exports = { LocalCache, localCache }
