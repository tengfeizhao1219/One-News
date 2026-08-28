/**
 * configStore.js — 统一密钥配置（DB 为源，env 兜底，内存缓存）
 * ============================================================
 * owner 2026-08-28：痛点——每次改 API Key 都要改代码 / 更新云函数环境变量并重新部署。
 * 现改为：把密钥统一存到云数据库集合「app_config」（doc _id=ai_keys），运行时从这里读，
 *        环境变量仅作兜底。改 Key 只需更新 app_config 集合（或用 set-keys.mjs），无需重部署。
 *
 * 读取顺序（单 key）：app_config(ai_keys) → 云函数环境变量 → 空串
 * 缓存：60s 内存缓存，避免每条新闻都打一次 DB。
 */
const COLLECTION = 'app_config'
const DOC_ID = 'ai_keys'
const CACHE_TTL_MS = 60 * 1000
const KEYS = ['deepseek', 'zhipu', 'ys365', 'tian', 'juhe']

let cache = null
let cacheAt = 0

function envFallback() {
  return {
    deepseek: process.env.DEEPSEEK_API_KEY || '',
    zhipu: process.env.ZHIPU_API_KEY || '',
    ys365: process.env.YS365_API_KEY || '',
    tian: process.env.TIAN_API_KEY || '',
    juhe: process.env.JUHE_API_KEY || '',
  }
}

/** 读取统一密钥（缓存 60s）。DB 不可用/未配置 → 回退环境变量。 */
async function loadKeys() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache
  const fb = envFallback()
  const out = { ...fb }
  try {
    const cloud = require('wx-server-sdk')
    if (cloud && typeof cloud.database === 'function') {
      const db = cloud.database()
      const d = await db.collection(COLLECTION).doc(DOC_ID).get()
      const k = (d && d.data) || {}
      for (const key of KEYS) {
        if (k[key] && String(k[key]).trim()) out[key] = String(k[key]).trim()
      }
    }
  } catch (e) {
    // DB 不可用 → 用 env 兜底（不阻断）
  }
  cache = out
  cacheAt = Date.now()
  return out
}

module.exports = { loadKeys, COLLECTION, DOC_ID, KEYS, envFallback }
