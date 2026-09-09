/**
 * news-cache-fix-summary.js — 用对题 content 重新生成指定新闻的 AI 摘要并写回 news_cache
 *
 * 背景：2026-09-09 修复中华网滚动页列表污染摘要 bug（76ca294）时的数据修复工具。
 *       对「摘要跑偏但 content 对题」的缓存条目，用 DeepSeek（与 newsPipeline 摘要引擎同 prompt）重生成。
 *
 * 用法：
 *   1. 准备 TCB 临时环境：mkdir -p /tmp/tcb-sdk && cd /tmp/tcb-sdk && npm init -y && npm i @cloudbase/node-sdk
 *   2. 导出凭证：export TCB_SID=xxx TCB_SKEY=xxx（TCB 凭证与 deepseek key 均从云端 app_config/ai_keys 读取，
 *      TCB 凭证来自 ~/Desktop/Deepseek/.secrets.env）
 *   3. 复制本文件到 /tmp/tcb-sdk/ 下运行：node news-cache-fix-summary.js "<标题关键词>" [更多关键词...]
 *      不传关键词则列出最近 5 条供确认。
 * 安全性：仅更新 summary/summarySource/summaryRegenAt 三个字段，不动 content/title。
 */
const sdk = require('@cloudbase/node-sdk')
const app = sdk.init({ env: 'cloud1-1g9313w0bb791de0', secretId: process.env.TCB_SID, secretKey: process.env.TCB_SKEY })
const db = app.database()
const https = require('https')

const SUMMARY_MAX_LEN = 230 // 与 newsPipeline/utils/contentFetcher.js 的 clampSummary 保持一致
function clampSummary(s) {
  const t = String(s || '').trim()
  if (t.length <= SUMMARY_MAX_LEN) return t
  const cut = t.slice(0, SUMMARY_MAX_LEN)
  const lastPunct = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf('！'), cut.lastIndexOf('？'))
  return (lastPunct > 20 ? cut.slice(0, lastPunct + 1) : cut) + '…'
}

async function loadKeys() {
  const res = await db.collection('app_config').doc('ai_keys').get()
  return (res.data && res.data[0]) || {}
}

function deepseekSummary(key, title, content) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        { role: 'system', content: '你是新闻摘要助手。基于用户提供的新闻正文，生成 50-150 字的中文摘要。要求：突出核心事件、关键信息与各方反应，不重复标题，不使用"本文""据报道"等套话，直接输出摘要正文，内容完整、以句号自然收尾。' },
        { role: 'user', content: `新闻标题：${title || ''}\n\n新闻正文：\n${String(content).slice(0, 2000)}` },
      ],
      max_tokens: 600,
      temperature: 0.3,
    })
    const req = https.request({
      hostname: 'api.deepseek.com', path: '/v1/chat/completions', method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let buf = ''
      res.on('data', (c) => (buf += c))
      res.on('end', () => {
        try {
          const j = JSON.parse(buf)
          resolve((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim())
        } catch (e) { console.error('解析失败:', buf.slice(0, 200)); resolve('') }
      })
    })
    req.on('error', (e) => { console.error('请求失败:', e.message); resolve('') })
    req.setTimeout(30000, () => { req.destroy(); resolve('') })
    req.write(body); req.end()
  })
}

async function main() {
  const kws = process.argv.slice(2)
  let docs = []
  if (!kws.length) {
    const r = await db.collection('news_cache').orderBy('createdAt', 'desc').limit(5).get()
    docs = r.data || []
    console.log('（未传关键词，列出最近 5 条）')
  } else {
    for (const kw of kws) {
      const r = await db.collection('news_cache').where({ title: db.RegExp({ regexp: kw, options: 'i' }) }).limit(3).get()
      docs = docs.concat(r.data || [])
    }
  }
  if (!docs.length) { console.log('未命中任何条目'); return }
  for (const d of docs) console.log('候选:', d._id, '|', (d.title || '').slice(0, 40))
  const keys = await loadKeys()
  if (!keys.deepseek) { console.error('app_config/ai_keys 无 deepseek key'); process.exit(1) }
  for (const d of docs) {
    console.log('=== 修复:', (d.title || '').slice(0, 36), '| _id:', d._id)
    if (!d.content || d.content.length < 30) { console.log('  ⚠️ content 过短/缺失，跳过'); continue }
    const s = clampSummary(await deepseekSummary(keys.deepseek, d.title, d.content))
    if (!s || s.length < 30) { console.log('  ❌ 生成失败，跳过'); continue }
    await db.collection('news_cache').doc(d._id).update({ data: { summary: s, summarySource: 'ai', summaryRegenAt: Date.now() } })
    console.log('  ✅ 新摘要:', s.slice(0, 100), '…')
  }
  console.log('DONE')
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
