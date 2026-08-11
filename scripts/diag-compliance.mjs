#!/usr/bin/env node
// ============================================================================
// B-COMPLIANCE-1 部署诊断脚本
// ----------------------------------------------------------------------------
// 用途：区分「前端没发版 / 云函数没生效 / 数据本身就是 AI 解读」三种情况，
//       避免靠猜。用户看到详情页"没变化"时用。
//
// 用法：
//   模式 A · 本地代码基线自检（无需任何凭据，立刻能跑）：
//     node scripts/diag-compliance.mjs
//
//   模式 B · 云端 getNewsDetail 探测（需微信凭据，确认后端是否真生效）：
//     WX_APPID=wx1ccb4d171dd88162 WX_ENV_ID=你的云环境ID \
//     NEWS_ID=那条新闻的_id node scripts/diag-compliance.mjs --cloud
//     # 也可直接给 token 跳过换票：WX_ACCESS_TOKEN=xxx ...
//
//   如何拿 NEWS_ID：真机预览时开 vConsole，看 detail.js 打印的 news._id；
//                   或去微信云开发控制台 → 数据库 → news_cache 搜标题拿到 _id。
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const GREEN = (s) => `  ✅ ${s}`
const RED = (s) => `  ❌ ${s}`
const YEL = (s) => `  ⚠️  ${s}`

function read(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return null
  return readFileSync(p, 'utf8')
}

// ── 模式 A：本地代码基线自检 ────────────────────────────────────────────────
function checkLocalBaseline() {
  console.log('\n=== 模式 A · 本地代码基线自检（无需凭据）===\n')

  const wxml = read('pages/detail/detail.wxml')
  const js = read('pages/detail/detail.js')
  const wxss = read('pages/detail/detail.wxss')
  const cf = read('cloudfunctions/getNewsDetail/index.js')

  const checks = [
    ['前端 detail.wxml 含合规降级徽标', wxml?.includes('ai-badge--compliance')],
    ['前端 detail.wxml 含「查看原文」', wxml?.includes('查看原文')],
    ['前端 detail.wxml 含「参考来源」', wxml?.includes('参考来源')],
    ['前端 detail.js 含 onCopySourceUrl', js?.includes('onCopySourceUrl')],
    ['前端 detail.wxss 含 compliance 样式', wxss?.includes('ai-badge--compliance')],
    ['后端 getNewsDetail 含 R1 拦截', cf?.includes('applyR1Filter')],
    ['后端 getNewsDetail 含 r1_blocked_fulltext', cf?.includes('r1_blocked_fulltext')],
  ]

  let allOk = true
  for (const [name, ok] of checks) {
    console.log(ok ? GREEN(name) : RED(name))
    if (!ok) allOk = false
  }

  // git HEAD
  let head = '(unknown)'
  try {
    head = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  } catch {}
  console.log(`\n  本地 git HEAD: ${head}`)
  if (head === '25c4935') console.log(GREEN('已包含 FE 合规接入 commit'))
  else console.log(YEL('HEAD 不是 25c4935，可能微信开发者工具没 pull 到最新代码'))

  console.log('\n── 判定 ──')
  if (allOk) {
    console.log(GREEN('代码基线全部就绪。若真机仍无任何变化 → 100% 是前端真机发版环节问题：'))
    console.log('   ① 微信开发者工具点「编译」')
    console.log('   ② 点「预览」扫码，或「上传」后在公众平台设为体验版')
    console.log('   ③ 手机端先从「最近使用」删除本小程序，再重新扫码/搜索进入（清缓存）')
  } else {
    console.log(RED('本地代码缺合规改动 → 先 git pull origin main，再编译。'))
  }
}

// ── 模式 B：云端探测 ────────────────────────────────────────────────────────
async function cloudProbe() {
  console.log('\n=== 模式 B · 云端 getNewsDetail 探测（需凭据）===\n')

  const appid = process.env.WX_APPID || 'wx1ccb4d171dd88162'
  const env = process.env.WX_ENV_ID
  const newsId = process.env.NEWS_ID
  let token = process.env.WX_ACCESS_TOKEN
  const secret = process.env.WX_APPSECRET

  if (!newsId) { console.log(RED('缺少 NEWS_ID（传新闻 _id，从真机 vConsole 或云开发控制台查）')); return }
  if (!env) { console.log(RED('缺少 WX_ENV_ID（微信云开发控制台的环境 ID）')); return }

  if (!token && secret) {
    const r = await fetch(`https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appid}&secret=${secret}`)
    const j = await r.json()
    if (j.access_token) token = j.access_token
    else { console.log(RED('换 token 失败: ' + JSON.stringify(j))); return }
  }
  if (!token) { console.log(RED('缺少 WX_ACCESS_TOKEN 或 WX_APPSECRET')); return }

  const url = `https://api.weixin.qq.com/tcb/invokecloudfunction?access_token=${token}&env=${env}&name=getNewsDetail`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newsId }),
  })
  const j = await r.json()
  if (j.errcode) { console.log(RED('invoke 失败: ' + JSON.stringify(j))); return }

  let resp
  try { resp = JSON.parse(j.resp_data) } catch { resp = j.resp_data }
  const data = resp?.data
  if (!data) { console.log(YEL('返回无 data 字段: ' + JSON.stringify(resp))); return }

  console.log('  contentSource  :', data.contentSource)
  console.log('  r1Blocked      :', data.r1Blocked)
  console.log('  content 字符数 :', (data.content || '').length)
  console.log('  summary 字符数 :', (data.summary || '').length)
  console.log('  references 条数:', Array.isArray(data.references) ? data.references.length : 0)

  console.log('\n── 判定 ──')
  if (data.r1Blocked) {
    console.log(GREEN('后端 R1 已生效（contentSource=r1_blocked_fulltext，content 已清空）。'))
    console.log('   问题完全在前端没发版 → 见模式 A 的①②③步。')
  } else if (data.contentSource === 'ai_interpretation') {
    console.log(YEL('这条新闻是 AI 独立解读（ai_interpretation），按版权设计本就不拦截，应显示「AI 解读」徽标。'))
    console.log('   若真机连「AI 解读」徽标都没有 → 前端没发版。')
  } else {
    console.log(RED('后端 R1 未生效（r1Blocked=false，仍返回全文）。云函数可能是旧版或未正确部署。'))
  }
}

// ── 入口 ────────────────────────────────────────────────────────────────────
const mode = process.argv.includes('--cloud') ? 'cloud' : 'local'
if (mode === 'cloud') await cloudProbe()
else checkLocalBaseline()
