/**
 * 内存缓存工具（云函数实例级别，跨请求复用）
 * 注意：云函数冷启动后缓存丢失，这是预期行为
 */

class MemoryCache {
  constructor() {
    this._store = new Map()
  }

  /**
   * 获取缓存值
   * @param {string} key
   * @returns {*|null}
   */
  get(key) {
    const entry = this._store.get(key)
    if (!entry) return null
    if (Date.now() > entry.expireAt) {
      this._store.delete(key)
      return null
    }
    return entry.value
  }

  /**
   * 设置缓存值
   * @param {string} key
   * @param {*} value
   * @param {object} [options]
   * @param {number} [options.ttl] - 过期时间（毫秒），默认 5 分钟
   */
  set(key, value, options = {}) {
    const ttl = options.ttl || 5 * 60 * 1000
    this._store.set(key, {
      value,
      expireAt: Date.now() + ttl,
    })
  }

  /**
   * 检查缓存是否存在且未过期
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._store.get(key)
    if (!entry) return false
    if (Date.now() > entry.expireAt) {
      this._store.delete(key)
      return false
    }
    return true
  }

  /**
   * 检查缓存是否已过期（不删除条目）
   * @param {string} key
   * @returns {boolean}
   */
  isExpired(key) {
    const entry = this._store.get(key)
    if (!entry) return true
    return Date.now() > entry.expireAt
  }

  /**
   * 删除缓存
   * @param {string} key
   */
  delete(key) {
    this._store.delete(key)
  }

  /**
   * 清空所有缓存
   */
  clear() {
    this._store.clear()
  }
}

// 全局单例（云函数实例内共享）
const cache = new MemoryCache()

module.exports = cache
