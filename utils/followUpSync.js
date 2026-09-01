/**
 * followUpSync.js — 「关注后续」云端同步封装（§九 后端）
 * ============================================================
 * 职责：关注关系/检索更新的云端同步桥。本地 utils/followUp.js 保持纯本地
 *       （离线可用、交互零等待）；本模块负责：
 *         ① syncLocal(module?)  关注/取消/清空后异步增量同步本地列表到云端
 *         ② fetchUpdates()      进入「我的关注」时拉取云端 updates 合并进本地
 *         ③ 失败静默 + 队列重试（复用 utils/cloud.js 的 report/flushQueue）
 *
 * 约定：
 *   - 本地是「事实源」（即时、离线可用）；云端是「检索后端的数据源」。
 *   - 已读状态（read）是设备级行为，不同步云端（各设备独立）。
 *   - 云端 updates 合并到本地时去重（按 date+summary 指纹），不覆盖本地手动记录。
 */

const cloudApi = require('./cloud')
const followUp = require('./followUp')

const SYNC_FN = 'syncFollowUp'

/** 从本地读某模块完整列表（对齐 followUp 存储结构，供云同步） */
function _localList(module) {
  try {
    return (require('./localCache').localCache.get(module === 'intel' ? 'intelFollowUp' : 'followUp') || [])
      .filter(Boolean)
      .map(function (it) {
        return {
          module: it.module || module,
          itemId: it.itemId,
          title: it.title || '',
          source: it.source || '',
          category: it.category || '',
          categoryName: it.categoryName || '',
          picUrl: it.picUrl || '',
          trackTime: it.trackTime || '12:00',
          createdAt: it.createdAt || 0,
        }
      })
  } catch (e) {
    return []
  }
}

/**
 * 增量同步本地关注列表到云端（关注/取消/清空后调用）。
 * @param {string} [module] 'onenews'|'intel'；缺省同步两个模块全量
 */
function syncLocal(module) {
  let list
  if (module) {
    list = _localList(module).map(function (it) { return Object.assign({ module: module }, it) })
  } else {
    list = _localList('onenews').map(function (it) { return Object.assign({ module: 'onenews' }, it) })
      .concat(_localList('intel').map(function (it) { return Object.assign({ module: 'intel' }, it) }))
  }
  if (!list.length) {
    // 空列表也要同步（清空关注 → 云端软删除）
    return cloudApi.report({ name: SYNC_FN, data: { action: 'sync', list: [] } })
  }
  return cloudApi.report({ name: SYNC_FN, data: { action: 'sync', list: list } })
}

/** 同步单个模块（关注/取消该模块单条后调用，更省） */
function syncModule(module) {
  return syncLocal(module)
}

/**
 * 拉取云端 updates 合并进本地（进入关注页时调用）。
 * 合并规则：
 *   - 云端某 itemId 有 updates 且本地无 → 注入本地 updates
 *   - 云端有、本地也有 → 按 (date,summary) 指纹去重合并，保留本地已读状态
 * @returns {Promise<number>} 合并的新更新条数
 */
async function fetchUpdates() {
  try {
    const res = await cloudApi.callCloudFunction(SYNC_FN, { action: 'get' })
    const data = (res && res.data) || {}
    const list = data.list || []
    const updatesByItem = data.updatesByItem || {}

    let merged = 0
    // 1) 云端有关注但本地没有（换设备/清缓存）→ 补回本地
    list.forEach(function (c) {
      const m = c.module === 'intel' ? 'intel' : 'onenews'
      if (!followUp.isFollowed(m, c.itemId)) {
        followUp.addFollow(m, {
          itemId: c.itemId,
          title: c.title || '',
          source: c.source || '',
          category: c.category || '',
          categoryName: c.categoryName || '',
          picUrl: c.picUrl || '',
          trackTime: c.trackTime || '12:00',
        })
      }
    })

    // 2) 合并 updates
    Object.keys(updatesByItem).forEach(function (itemId) {
      const ups = updatesByItem[itemId] || []
      if (!ups.length) return
      // 找到本地条目（两模块都试）
      ;['onenews', 'intel'].forEach(function (m) {
        if (!followUp.isFollowed(m, itemId)) return
        ups.forEach(function (u) {
          const added = followUp.mergeUpdate(m, itemId, u)
          if (added) merged++
        })
      })
    })
    return merged
  } catch (e) {
    // 静默失败（离线/云函数未部署），不影响本地使用
    return 0
  }
}

module.exports = {
  syncLocal,
  syncModule,
  fetchUpdates,
  _localList,
}
