#!/usr/bin/env node
/**
 * fix-intel-search-dep.js —— intelSearch 依赖自动保护（2026-08-21）
 * ============================================================
 * 背景：并行 agent 部署 intelSearch 时多次不带 InstallDependency: TRUE，
 *       导致云端函数无 wx-server-sdk，线上搜索 `Cannot find module` 全挂（已 3 次）。
 *
 * 功能：
 *   1) 校验云端 intelSearch 的 InstallDependency 是否为 TRUE 且 CodeSize > 1MB
 *   2) 若异常（FALSE 或无依赖）→ 自动按标准流程重新部署（含依赖安装）
 *   3) 退出码：0=正常无需处理 / 1=已修复 / 2=校验失败
 *
 * 用法：
 *   node scripts/fix-intel-search-dep.js            # 只校验（推荐：部署后必跑）
 *   node scripts/fix-intel-search-dep.js --fix      # 校验 + 异常自动修复
 *   node scripts/fix-intel-search-dep.js --force    # 强制重新部署
 *
 * 挂载建议：deploy 脚本/CI 在 intelSearch 部署后调用本脚本 --fix。
 */
const CloudBase = require('@cloudbase/manager-node/lib/index.js')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

// ─── 凭据（与部署脚本一致）──────────────────────────
const SECRETS_PATH = process.env.SECRETS_FILE || path.join(__dirname, '..', '..', '..', 'Desktop', 'Deepseek', '.secrets.env')
function loadEnv(file) {
  const out = {}
  try {
    const lines = fs.readFileSync(file, 'utf-8').split('\n')
    for (const l of lines) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) out[m[1]] = m[2] }
  } catch (e) { console.error('❌ 读取凭据失败:', e.message) }
  return out
}
const env = loadEnv(SECRETS_PATH)
const ENV_ID = env.TCB_ENV_ID || 'cloud1-1g9313w0bb791de0'

const FN = 'intelSearch'
const MIN_CODE_SIZE = 1 * 1024 * 1024 // 1MB（含 wx-server-sdk 约 7.4MB）

async function getDepStatus(cb) {
  const r = await cb.functions.getFunctionDetail(FN).catch(e => ({ err: e.message }))
  if (r.err) return { error: r.err }
  const s = JSON.stringify(r)
  return {
    installDep: (s.match(/"InstallDependency":"([^"]+)"/) || [])[1],
    codeSize: Number((s.match(/"CodeSize":(\d+)/) || [])[1] || 0),
    status: (s.match(/"Status":"([^"]+)"/) || [])[1],
  }
}

function redeploy(cb) {
  const ROOT = path.join(__dirname, '..')
  const copy = path.join(ROOT, 'cloudfunctions', FN)
  const zip = path.join('/tmp', `${FN}.zip`)
  // 1) 同步 backend → 副本 + 改写 require
  const src = path.join(ROOT, 'backend', FN, 'index.js')
  const dst = path.join(copy, 'index.js')
  let t = fs.readFileSync(src, 'utf-8')
  t = t.replace(/require\('\.\.\/common\//g, "require('./common/")
  fs.writeFileSync(dst, t)
  // 2) 打包
  execSync(`cd "${copy}" && rm -f ${zip} && zip -qr ${zip} .`, { stdio: 'pipe' })
  const b64 = fs.readFileSync(zip).toString('base64')
  return cb.functions.updateFunctionCode({
    func: { name: FN, runtime: 'Nodejs16.13', handler: 'index.main', installDependency: 'TRUE' },
    base64Code: b64,
  })
}

;(async () => {
  const fix = process.argv.includes('--fix')
  const force = process.argv.includes('--force')
  const cb = new CloudBase({ secretId: env.TENCENTCLOUD_SECRET_ID, secretKey: env.TENCENTCLOUD_SECRET_KEY, envId: ENV_ID })

  const st = await getDepStatus(cb)
  if (st.error) { console.error('❌ 校验失败:', st.error); process.exit(2) }
  console.log(`[protect] ${FN}: InstallDependency=${st.installDep} CodeSize=${(st.codeSize/1024/1024).toFixed(1)}MB Status=${st.status}`)

  const healthy = st.installDep === 'TRUE' && st.codeSize > MIN_CODE_SIZE
  if (healthy && !force) {
    console.log('[protect] ✅ 依赖正常，无需处理')
    process.exit(0)
  }
  if (!fix && !force) {
    console.log('[protect] ⚠️ 依赖异常（InstallDependency 非 TRUE 或 CodeSize 过小）——已检测到，建议执行 --fix')
    process.exit(2)
  }

  console.log('[protect] 🔧 重新部署（installDependency=TRUE）…')
  try {
    const r = await redeploy(cb)
    console.log('[protect] 部署已触发:', JSON.stringify(r).slice(0, 120))
    // 等依赖安装
    console.log('[protect] 等待依赖安装（约 40s）…')
    await new Promise(res => setTimeout(res, 40000))
    const st2 = await getDepStatus(cb)
    console.log(`[protect] 复检: InstallDependency=${st2.installDep} CodeSize=${(st2.codeSize/1024/1024).toFixed(1)}MB`)
    if (st2.installDep === 'TRUE' && st2.codeSize > MIN_CODE_SIZE) {
      console.log('[protect] ✅ 修复完成，依赖正常')
      process.exit(1)
    } else {
      console.error('[protect] ❌ 复检仍异常，请人工介入')
      process.exit(2)
    }
  } catch (e) {
    console.error('[protect] ❌ 部署失败:', e.message)
    process.exit(2)
  }
})()
