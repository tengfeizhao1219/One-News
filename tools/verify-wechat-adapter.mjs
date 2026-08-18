// T2.5 wechatAdapter 双模端到端验证（不依赖真实微信数据）：
//   1) 本地模式 readLocal：JSON 导出 → 归一化 item
//   2) 云端模式 fetch：本地进程不可达 → 静默降级 degraded
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
// 相对本文件(tools/)向上解析到 backend/（规避中文绝对路径的 require 解析问题，与 verify-scrape 一致）
const { readLocal, fetch } = require('../backend/adapters/templates/wechatAdapter.js')
const { writeFileSync } = require('fs')

const ok = (cond, msg) => { console.log(cond ? '✅' : '❌', msg); if (!cond) process.exitCode = 1 }

// 1) 本地 JSON 导出读取
const tmp = '/tmp/wechat_demo.json'
writeFileSync(tmp, JSON.stringify([
  { title: '量子位：Claude Opus 5 实测', url: 'https://mp.weixin.qq.com/s/d1', publish_time: 1723940000, author: '量子位', content: '正文一。' },
  { title: '机器之心：开源周报', url: 'https://mp.weixin.qq.com/s/d2', published_at: '2026-08-17T12:00:00Z', author: '机器之心', digest: '摘要二' },
]))
const local = readLocal(tmp, { maxItems: 10, sourceId: 'wechat_officials' })
ok(Array.isArray(local) && local.length === 2, `本地 JSON 导出 → ${local.length} 条`)
local.forEach((it, i) => {
  ok(it.title.length > 0, `  [${i}] title 非空`)
  ok(it.item_guid.startsWith('wechat:') && it.item_guid.length > 20, `  [${i}] guid 唯一派生`)
  ok(!!it.meta.author, `  [${i}] 来源公众号 author 已标`)
})
// unix 秒时间戳 → ISO 转换
const withUnixSec = local.find((it) => it.title.includes('量子位'))
ok(withUnixSec && /^\d{4}-\d{2}-\d{2}/.test(withUnixSec.published_at), `  unix 秒时间戳 → ISO: ${withUnixSec && withUnixSec.published_at}`)

// 2) 云端模式不可达 → 静默降级
process.env.WECHAT_LOCAL_API_BASE = 'http://127.0.0.1:59999'
const r = await fetch({ wechatConfig: {} }, { maxItems: 5 })
ok(r.degraded === true && Array.isArray(r.items), `云端不可达 → degraded=true, items=${r.items.length}`)

console.log('\nT2.5 wechatAdapter 验证完成')
