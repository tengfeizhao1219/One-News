/**
 * wechatAdapter.js — 公众号适配器模板（T2.5）
 * ============================================================
 * 角色：A（适配器）· T2.1 交付的代码骨架
 * 覆盖源：sources-manifest.json `wechat-officials`（量子位 / 机器之心 / 数字生命卡兹克 等用户主动订阅号）
 *
 * 合规红线（调研 §5 全章，写进需求 §5.4 六条）：
 *   - 仅个人学习研究、不商用传播、不二次分发
 *   - 输出标来源公众号 + 原文链接 + 作者，不整篇搬运（摘要/翻译优先）
 *   - 最小必要：只抓用户主动订阅的号，不广撒网
 *   - 可一键关停；路径失效 → 静默降级（不报错刷屏）
 *   - 本地优先：首选本地 SQLite 解析，避免交给不可控第三方
 *
 * 技术路径（2026-08 实测，调研 §5.2/§5.3 结论）：
 *   - 首选：本地 SQLite 解析 —— 解析本机微信客户端数据库
 *       · ChatLog（vitamin5x/chatlog，2026-01 活跃，兼容微信 3.x/4.x，含 HTTP API + MCP）
 *       · wechat_db_parser（grapeot，专注公众号文章导出，支持 CSV/Markdown）
 *   - 备选：微信读书 API（wewe-rss 及活跃 fork）——需要正文做全文索引/深度摘要时启用
 *   - 不纳入：RSSHub 公众号路由、网页抓取/UI 自动化、公共第三方托管
 *
 * 云端解耦（关键设计）：
 *   - 本模板运行在 **本地进程**（用户设备），解析 SQLite → 暴露 HTTP API（如 :8787/api/items）
 *   - 云端 `intelRssPoll` worker **只消费该 HTTP API**（fetch），不直连微信服务器、不爬微信
 *   - 本地进程不可达 → 云端静默降级（返回空数组，不报错），符合「路径失效静默降级」
 */

// ── 本地 SQLite 解析（仅在本地进程运行；云端不 require 此段）──
// 真实部署：本模板同时被「本地解析进程」与「云端消费端」复用，
//   通过运行环境区分（process.env.RUN_LOCAL === 'true' 时启用 SQLite 直读）。
function parseSqlite(localDbPath, opts = {}) {
  // 【真实部署替换】SQLite 读取：
  //   1) Node 侧：better-sqlite3（本地进程可用，非云端依赖）—— `SELECT * FROM ...` 
  //   2) 更推荐：复用 ChatLog / wechat_db_parser 已封装的导出（它们已把库结构解耦为 JSON/CSV）
  //   本骨架给出「伪查询 + 字段映射」形态，实际表结构以 wechat_db_parser 文档为准：
  //   常见字段：title / url(app_msg_url) / publish_time / author / content
  //
  // const Database = require('better-sqlite3')
  // const db = new Database(localDbPath, { readonly: true })
  // const rows = db.prepare(
  //   `SELECT title, app_msg_url AS url, datetime(publish_time,'unixepoch') AS published_at,
  //           author, content
  //      FROM message WHERE author IN (${placeholders}) ORDER BY publish_time DESC LIMIT ?`
  // ).all(...opts.accounts, opts.maxItems)
  const rows = [] // 占位：真实部署替换为上述查询结果
  const sinceTs = opts.since ? new Date(opts.since).getTime() : 0
  return rows
    .filter((r) => !sinceTs || new Date(r.published_at).getTime() >= sinceTs)
    .map((r) => ({
      source_id: 'wechat-officials',
      item_guid: `wechat:${require('crypto').createHash('sha256').update(r.url).digest('hex')}`,
      title: r.title,
      url: r.url,
      published_at: r.published_at,
      raw_content: (r.content || '').slice(0, 5000), // 版权红线：仅作 AI 加工瞬时数据，不整篇搬运展示
      summary: (r.content || '').replace(/\s+/g, ' ').slice(0, 300),
      fetch_method: 'wechat',
      fetched_at: new Date().toISOString(),
      meta: { author: r.author || '', note: '本地 SQLite 解析，来源公众号需标注' },
    }))
}

/**
 * 统一适配器接口：fetch(source, opts) -> items[]
 * 双模：
 *   - 本地进程（RUN_LOCAL=true）：直读 SQLite（走 parseSqlite）
 *   - 云端消费端（默认）：fetch 本地进程暴露的 HTTP API；不可达 → 空数组静默降级
 * @param {Object} source - sources-manifest.json 源定义（wechatConfig 必填）
 * @param {Object} opts - { since: Date, maxItems: number }
 */
async function fetch(source, opts = {}) {
  const cfg = source.wechatConfig || {}
  const localEnabled = String(process.env.RUN_LOCAL || 'false').toLowerCase() === 'true'

  // ── 本地模式：直读 SQLite ──
  if (localEnabled) {
    const dbPath = cfg.localDb || process.env.WECHAT_LOCAL_DB // 【真实部署替换】manifest 中 localDb 为路径约定
    if (!dbPath) return { items: [], error: '未配置 WECHAT_LOCAL_DB' }
    return { items: parseSqlite(dbPath, { since: opts.since, accounts: cfg.accounts || [cfg.account], maxItems: opts.maxItems || 30 }) }
  }

  // ── 云端模式：消费本地进程 HTTP API ──
  const localApiBase = process.env.WECHAT_LOCAL_API_BASE || 'http://127.0.0.1:8787' // 【真实部署替换】ChatLog HTTP API 端口/地址
  try {
    const sinceTs = opts.since ? Math.floor(new Date(opts.since).getTime() / 1000) : 0
    const url = `${localApiBase}/api/items?since=${sinceTs}&limit=${opts.maxItems || 30}`
    const res = await fetch(url)
    if (!res.ok) return { items: [], degraded: true, reason: `local API HTTP ${res.status}` }
    const data = await res.json()
    const list = Array.isArray(data) ? data : (data.items || [])
    return {
      items: list.map((r) => ({
        source_id: source.id,
        item_guid: `wechat:${require('crypto').createHash('sha256').update(r.url || r.link || '').digest('hex')}`,
        title: r.title || '',
        url: r.url || r.link || '',
        published_at: r.published_at || r.publish_time || new Date().toISOString(),
        raw_content: (r.content || '').slice(0, 5000),
        summary: (r.content || '').replace(/\s+/g, ' ').slice(0, 300),
        fetch_method: 'wechat',
        fetched_at: new Date().toISOString(),
        meta: { author: r.author || '', note: '经本地解析进程 API 消费（合规：仅个人学习研究）' },
      })),
    }
  } catch (e) {
    // 合规红线：本地进程不可达 → 静默降级，绝不向云端报错刷屏
    console.warn(`[wechatAdapter] 本地解析进程不可达，本轮跳过公众号源:`, e.message)
    return { items: [], degraded: true, reason: 'local-process-unreachable' }
  }
}

module.exports = { fetch, parseSqlite }
