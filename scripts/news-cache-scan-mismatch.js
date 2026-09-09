/**
 * news-cache-scan-mismatch.js — 扫描 news_cache「摘要与标题不相关」的可疑条目
 *
 * 背景：2026-09-09 修复中华网滚动页列表污染摘要 bug（76ca294）时的排查工具。
 *       原理：summarySource=ai 且 摘要与标题的字符 bigram 重叠率 <6% → 可疑（评论类标题可能误报，人工复核）。
 *
 * 用法：
 *   1. 准备 TCB 临时环境：mkdir -p /tmp/tcb-sdk && cd /tmp/tcb-sdk && npm init -y && npm i @cloudbase/node-sdk
 *   2. 导出凭证（来自 ~/Desktop/Deepseek/.secrets.env）：export TCB_SID=xxx TCB_SKEY=xxx
 *   3. 复制本文件到 /tmp/tcb-sdk/ 下运行：node news-cache-scan-mismatch.js [扫描条数，默认300]
 * 输出：可疑条目清单（标题/来源/摘要前90字），人工判断是否需要用 news-cache-fix-summary.js 修复。
 */
const sdk = require('@cloudbase/node-sdk')
const app = sdk.init({ env: 'cloud1-1g9313w0bb791de0', secretId: process.env.TCB_SID, secretKey: process.env.TCB_SKEY })
const db = app.database()

function bigrams(s) {
  const t = String(s || '').replace(/[\s\p{P}]+/gu, '')
  const out = new Set()
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2))
  return out
}
function overlap(title, summary) {
  const A = bigrams(title), B = bigrams((summary || '').slice(0, 120))
  if (!A.size || !B.size) return 0
  let hit = 0
  for (const g of A) if (B.has(g)) hit++
  return hit / A.size
}

async function main() {
  const maxScan = parseInt(process.argv[2] || '300', 10)
  let all = [], skip = 0
  while (all.length < maxScan) {
    const res = await db.collection('news_cache').orderBy('createdAt', 'desc').skip(skip).limit(100).get()
    const list = res.data || []
    all = all.concat(list)
    if (list.length < 100) break
    skip += 100
  }
  console.log('扫描条数:', all.length)
  const suspects = []
  for (const d of all) {
    if (d.summarySource !== 'ai') continue
    const ov = overlap(d.title, d.summary)
    if (ov < 0.06) suspects.push({ d, ov })
  }
  console.log('可疑（摘要-标题 bigram 重叠 <6%）:', suspects.length, '条')
  for (const { d, ov } of suspects) {
    console.log(`--- [${(ov * 100).toFixed(1)}%]`, (d.title || '').slice(0, 38), '| src:', d.source, '| _id:', d._id)
    console.log('    summary:', (d.summary || '').slice(0, 90))
  }
}
main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e.message); process.exit(1) })
