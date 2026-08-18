// 用户画像读写云函数 intelProfile（T5.2 / P · 画像存储）
// ============================================================
// 设计 §9 / §8.2：用户画像（UserProfile）初始化采集 + 读写。
// 画像字段：identities（三重身份）/ focusTags / depth / langPref /
//   wantTryable / consentSigned / consentAt / updatedAt。
// userId 固定 'owner'（一人单用户模型，呼应 intel_* 命名空间隔离）。
//
// 与 intelRouter 的衔接（T5.2a，backend/common/intelRouter.js）：
//   intelProcess 调 intelProfile 拿画像 → router.score(item, profile) 用
//   focusTags/identities/depth 真正驱动打分（不再纯占位）。
//
// 复用 backend/common/ensureSchema（ensureIntelProfile 已建 intel_profile
//   集合 + userId 唯一索引，T5.2 无需改 ensureSchema）。intel_ 命名空间隔离。
// 部署时需将 backend/common/ 一并上传（同 intelFetch/intelProcess/intelDispatcher）。
// ============================================================

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const { ensureSchema } = require('../common/ensureSchema')

const INTEL_PROFILE = 'intel_profile'
const OWNER_USER_ID = 'owner'

/** 按 userId 读画像（缺省 owner） */
async function readProfile(userId) {
  const uid = userId || OWNER_USER_ID
  try {
    const res = await db.collection(INTEL_PROFILE)
      .where({ userId: uid })
      .limit(1)
      .get()
    return (res.data && res.data[0]) || null
  } catch (e) {
    // 集合未建等软错误交给 ensureSchema 自愈；此处降级返回 null，不阻塞前端
    console.warn('[intelProfile] 读 intel_profile 失败:', e.message)
    return null
  }
}

/**
 * upsert 画像（靠 userId 唯一索引 + 应用层查后写兜底去重）。
 * @param {Object} profile - 完整画像对象；userId 缺省补 'owner'
 */
async function upsertProfile(profile) {
  const uid = String((profile && profile.userId) || OWNER_USER_ID)
  const now = new Date().toISOString()
  const data = {
    userId: uid,
    identities: (profile && profile.identities) || { work: '', product: '', life: '' },
    focusTags: Array.isArray(profile && profile.focusTags) ? profile.focusTags : [],
    depth: (profile && ['lite', 'std', 'deep'].includes(profile.depth)) ? profile.depth : 'std',
    langPref: (profile && ['zh', 'mixed', 'en'].includes(profile.langPref)) ? profile.langPref : 'mixed',
    wantTryable: typeof (profile && profile.wantTryable) === 'boolean' ? profile.wantTryable : true,
    consentSigned: typeof (profile && profile.consentSigned) === 'boolean' ? profile.consentSigned : false,
    consentAt: (profile && profile.consentAt) || '',
    updatedAt: now,
  }

  const existing = await readProfile(uid)
  if (existing && existing._id) {
    try {
      await db.collection(INTEL_PROFILE).doc(existing._id).update({ data })
      console.log('[intelProfile] 更新画像 userId=' + uid)
      return { ...data, _id: existing._id }
    } catch (e) {
      console.warn('[intelProfile] 更新失败改新增:', e.message)
    }
  }
  try {
    const add = await db.collection(INTEL_PROFILE).add({ data })
    console.log('[intelProfile] 新建画像 userId=' + uid)
    return { ...data, _id: add._id || '' }
  } catch (e) {
    // 兜底：唯一索引冲突（并发首发）→ 再读一次返回已落库版本
    console.warn('[intelProfile] 新增失败兜底再读:', e.message)
    return (await readProfile(uid)) || data
  }
}

/**
 * 主入口。
 * event.action: 'get' | 'save'（默认 'get'）
 * event.userId: 可选，缺省 'owner'（一人单用户）
 * event.profile: save 时传入完整画像对象
 */
exports.main = async (event = {}) => {
  try { await ensureSchema() } catch (e) { console.warn('[intelProfile] ensureSchema 失败:', e.message) }

  const action = String(event.action || 'get')

  if (action === 'save') {
    const saved = await upsertProfile(event.profile || {})
    return { code: 0, data: saved }
  }

  // 默认 get
  const data = await readProfile(event.userId)
  return { code: 0, data }
}
