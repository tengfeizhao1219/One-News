// 意见反馈「与我相关」提醒工具（owner 2026-09-09 3.0.0）
// 职责：调 feedback-status 云函数计算提醒数；已读基线存本地 wx storage（单设备场景够用，
//   规避云端集合一致性坑），被首页 dock / 设置页 / 留言板共用。
// 语义见 cloudfunctions/feedback-status/index.js（作者=全部新留言；普通用户=回复我的才提醒）。

const READ_KEY = 'fb_read_ts'      // 已读基线（ms 时间戳）
const _cache = { ts: 0, data: null }
const CACHE_TTL = 20 * 1000        // 20s：避免每页 onShow 都打云函数

function getTs() {
  try { return Number(wx.getStorageSync(READ_KEY)) || 0 } catch (e) { return 0 }
}
function setTs(t) {
  try { wx.setStorageSync(READ_KEY, t) } catch (e) {}
}

/** 读未读提醒数（首次会先落本地基线=当下，避免历史全部算未读） */
function unread(opts) {
  const force = !!(opts && opts.force)
  const now = Date.now()
  if (!force && _cache.data && now - _cache.ts < CACHE_TTL) {
    return Promise.resolve(_cache.data)
  }
  // 首次（无本地基线）：先落当下基线再查询（count 自然为 0，不刷历史）
  if (!getTs()) setTs(now)

  return wx.cloud.callFunction({ name: 'feedback-status', data: { op: 'unread', lastReadAt: getTs() } })
    .then(function (res) {
      const d = ((res && res.result) || {}).data || { isAuthor: false, count: 0 }
      const out = { isAuthor: !!d.isAuthor, count: Number(d.count) || 0 }
      _cache.ts = Date.now()
      _cache.data = out
      return out
    })
    .catch(function (err) {
      return _cache.data || { isAuthor: false, count: 0 }
    })
}

/** 进入留言板阅读后调用：本地已读基线前移、缓存清零 */
function markRead() {
  setTs(Date.now())
  _cache.data = null
  // 通知云端仅作回执（无副作用）；失败不影响本地已读
  return wx.cloud.callFunction({ name: 'feedback-status', data: { op: 'markRead' } })
    .then(function () { return true })
    .catch(function () { return true })
}

/** 强制下一次 unread 重新拉取（不重置基线） */
function clearCache() {
  _cache.data = null
}

module.exports = { unread, markRead, clearCache }
