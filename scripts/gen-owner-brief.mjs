#!/usr/bin/env node
// Owner 进度简报 · 自动生成器
// ===============================================================
// 目的  ：解决 FS Review 指出的「信息过载 + PM 维护空跑」问题——
//         每次 commit 推送自动从数据源提取「owner 真正需要看」的内容，
//         落到 docs/owner-brief.md 与 Notion `00-Owner 进度简报` 页。
//
// 数据源（按优先级，自动探测）：
//   1) COMMLOG.md（全局沟通 / 变更记录）— `## [时间戳]` 标题 + 多行正文
//   2) TASK_BOARD.md（任务看板）— 表格行 | id | 名称 | owner | 优先级 | 状态 |
//   3) git log -n 30（最近 30 次 commit，按角色署名归类）
//
// 产出  ：
//   - <output>/owner-brief.md        （仓库内，文档可读）
//   - stdout（如果 --stdout）
//
// 触发  ：
//   1) 本地：pre-commit hook（建议接入 .husky/ 或 Git 客户端）
//   2) 远程：GitHub Actions on push main
//   3) 手动：node scripts/gen-owner-brief.mjs（任何时候）
//
// 用法  ：
//   node scripts/gen-owner-brief.mjs                       # 写入 docs/owner-brief.md
//   node scripts/gen-owner-brief.mjs --stdout               # 输出到 stdout
//   node scripts/gen-owner-brief.mjs --since=24h            # 只看最近 24 小时
//   node scripts/gen-owner-brief.mjs --dry-run              # 只打印，不写文件
//   node scripts/gen-owner-brief.mjs --output=path.md       # 自定义输出路径
//   node scripts/gen-owner-brief.mjs --notion               # 同时 push 到 Notion（需 NOTION_TOKEN + PAGE_ID）
//
// 关联  ：
//   - 与 gen-kanban-changelog.mjs 共享 COMMLOG 解析逻辑（结构一致）
//   - 与 pending-tasks.sh 共享 TASK_BOARD 表格解析（结构一致）
//
// 维护  ：WorkBuddy (PM) 设计 · FS 实施 · owner 验收
// ===============================================================

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const COMMLOG = process.env.COMMLOG_PATH || join(ROOT, 'COMMLOG.md');
const BOARD   = process.env.TASK_BOARD_PATH || join(ROOT, 'TASK_BOARD.md');
const OUT_DEFAULT = join(ROOT, 'docs', 'owner-brief.md');

// ─── CLI 解析 ──────────────────────────────────────────────
const args = process.argv.slice(2);
const opts = {
  stdout: args.includes('--stdout'),
  dryRun: args.includes('--dry-run'),
  since: (args.find(a => a.startsWith('--since=')) || '').slice(8) || '24h',
  output: (args.find(a => a.startsWith('--output=')) || '').slice(9) || OUT_DEFAULT,
  notion: args.includes('--notion'),
  help: args.includes('--help') || args.includes('-h'),
};
if (opts.help) {
  console.log(`Owner 进度简报 · 自动生成器

用法：
  node scripts/gen-owner-brief.mjs                       # 默认写 ${OUT_DEFAULT}
  node scripts/gen-owner-brief.mjs --stdout               # 输出到 stdout
  node scripts/gen-owner-brief.mjs --since=24h            # 时间窗口（24h/3d/1w）
  node scripts/gen-owner-brief.mjs --dry-run              # 不写文件
  node scripts/gen-owner-brief.mjs --output=path.md       # 自定义输出
  node scripts/gen-owner-brief.mjs --notion               # push 到 Notion
  node scripts/gen-owner-brief.mjs -h | --help            # 帮助
`);
  process.exit(0);
}

// ─── 角色词表（与 gen-kanban-changelog.mjs 对齐） ──────────
const ROLES = [
  '项目总控(PJM)', '小程序前端开发(FE)', '全栈开发(FS)',
  '产品设计师(PD)', '产品经理(PM)', 'owner',
  '项目总控', '小程序前端开发', '全栈开发', '产品设计师', '产品经理',
];
// 状态 emoji（与 TASK_BOARD.md 对齐）
const STATUS = {
  '✅': '已完成',
  '🔄': '进行中',
  '⏳': '等待中',
  '🚫': '阻塞',
  '❌': '已取消',
  '📋': '待认领',
};

// ─── 工具：时间窗口解析 ────────────────────────────────────
function parseSince(s) {
  const m = s.match(/^(\d+)(h|d|w)$/);
  if (!m) return 24 * 3600 * 1000; // 默认 24h
  const n = parseInt(m[1]);
  const unit = { h: 3600 * 1000, d: 86400 * 1000, w: 7 * 86400 * 1000 }[m[2]];
  return n * unit;
}
const SINCE_MS = parseSince(opts.since);
const NOW = new Date();
const SINCE_DATE = new Date(NOW.getTime() - SINCE_MS);

// ─── 1. 解析 COMMLOG ───────────────────────────────────────
function parseCommLog() {
  if (!existsSync(COMMLOG)) {
    return { blocks: [], error: `COMMLOG.md 不存在：${COMMLOG}` };
  }
  const text = readFileSync(COMMLOG, 'utf8');
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    if (/^##\s+\[/.test(line)) {
      if (cur) blocks.push(cur);
      cur = { header: line.replace(/^##\s+/, ''), body: '' };
    } else if (cur) {
      cur.body += line + '\n';
    }
  }
  if (cur) blocks.push(cur);

  return {
    blocks: blocks.map(b => {
      const tm = b.header.match(/\[(\d{4}-\d{2}-\d{2})(?: (\d{2}:\d{2}))?\]/);
      const time = tm ? new Date(tm[1] + (tm[2] ? 'T' + tm[2] + ':00' : 'T00:00:00')) : null;
      const whoM = b.header.match(/会话：\[([^\]]+)\]/);
      const who = whoM ? whoM[1] : '';
      const content = b.header
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/\s*\|\s*会话：.*$/, '')
        .replace(/`/g, '')
        .replace(/^[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{FE00}-\u{FE0F}\s]+/u, '')
        .trim();
      return { time, who, content, full: b.header + '\n' + b.body, raw: b };
    }),
    error: null,
  };
}

// ─── 2. 解析 TASK_BOARD 表格 ──────────────────────────────
function parseBoard() {
  if (!existsSync(BOARD)) {
    return { rows: [], error: `TASK_BOARD.md 不存在：${BOARD}` };
  }
  const text = readFileSync(BOARD, 'utf8');
  const lines = text.split(/\r?\n/);
  const rows = [];
  for (const line of lines) {
    // 跳过表头 / 分隔行 / 非表格行
    if (!line.includes('|')) continue;
    if (/^\|[\s-]+\|$/.test(line)) continue; // 分隔行 |---|---|
    // 按 | 切分字段（去掉首尾空字段）
    const cells = line.split('|').map(s => s.trim()).filter(s => s !== '');
    if (cells.length < 5) continue;
    // 找到第一个形如 A-01/R-22/D-02/RQ-22/FS-08/FE-3/CHG-016/... 的字段作为 id
    // （任务前缀极多，正则放宽到 [A-Z]{1,5}-\d+）
    const idIdx = cells.findIndex(c => /^[A-Z]{1,5}-\d+$/.test(c));
    if (idIdx < 0) continue;
    const id = cells[idIdx];
    const name = cells[idIdx + 1] || '';
    const owner = cells[idIdx + 2] || '';
    const priority = cells[idIdx + 3] || '';
    const status = cells[idIdx + 4] || '';
    rows.push({
      id, name, owner, priority, status,
      statusKey: (status.match(/[✅🔄⏳🚫❌📋]/) || [''])[0],
    });
  }
  return { rows, error: null };
}

// ─── 3. 解析 git log ──────────────────────────────────────
function parseGitLog() {
  try {
    const sinceArg = SINCE_MS < 86400000
      ? `--since="${Math.ceil(SINCE_MS / 3600000)} hours ago"`
      : `--since="${Math.ceil(SINCE_MS / 86400000)} days ago"`;
    const out = execSync(
      `git log ${sinceArg} --pretty=format:"%h|%an|%ad|%s" --date=iso`,
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map(line => {
        const [hash, author, date, ...rest] = line.split('|');
        return {
          hash, author, date: new Date(date),
          subject: rest.join('|').trim(),
        };
      });
  } catch (e) {
    return [];
  }
}

// ─── 4. owner 维度归类（commit author → 角色） ────────────
function classifyByRole(commits) {
  // commit 署名习惯：author 字段直接是角色名（One-News GM / 2号前端开发 / One-News PM / FS / FE 等）
  // 也有匿名（gravatar-user-420.png → 默认用户名）
  const byRole = {};
  const unclassified = [];
  for (const c of commits) {
    const matched = ROLES.find(r => c.author.includes(r.replace(/[()]/g, '')))
      || (c.author === 'One-News GM' ? 'GM(owner)' : null)
      || (c.author.includes('前端') ? 'FE' : null)
      || (c.author === 'PM' || c.author.includes('PM') ? 'PM' : null)
      || (c.author === 'FS' ? 'FS' : null);
    if (matched) {
      byRole[matched] = byRole[matched] || [];
      byRole[matched].push(c);
    } else {
      unclassified.push(c);
    }
  }
  return { byRole, unclassified };
}

// ─── 5. 提取"待 owner 决策/执行"信号 ─────────────────────
function extractOwnerActions(commlogBlocks, boardRows) {
  const decisions = [];
  const executions = [];
  // 决策类：必须明确提"需要 owner 拍板/选择"或"是否..."
  const DECISION_KEYWORDS = [
    /请.*(owner|你).*(拍板|决策|确认|批准|选择|决定)/,
    /是否.*(继续|推进|上线|部署|启动|启用|开启|关闭|保留|砍掉|移除)/,
    /owner.*(拍板|决策|确认|批准|选择|决定|倾向)/,
  ];
  // 执行类：必须明确提"需要 owner 操作/登录/填写"
  const EXECUTION_KEYWORDS = [
    /请.*(owner|你).*(执行|操作|登录|填写|配置|备案|提交|注册|认证|测试|验|绑定|签约|缴费|设置|申请|开通)/,
    /真机.*(测试|验|确认)/,
  ];
  for (const b of commlogBlocks) {
    if (!b.time || b.time < SINCE_DATE) continue;
    const text = (b.content + '\n' + b.full).replace(/<[^>]+>/g, '');
    const isDecision = DECISION_KEYWORDS.some(re => re.test(text));
    const isExecution = EXECUTION_KEYWORDS.some(re => re.test(text));
    // 只保留至少一个命中的
    if (!isDecision && !isExecution) continue;
    const item = {
      time: b.time,
      who: b.who,
      content: b.content.slice(0, 120),
      kind: isDecision && isExecution ? 'both' : (isDecision ? 'decision' : 'execution'),
    };
    if (isDecision) decisions.push({ ...item, kind: 'decision' });
    if (isExecution) executions.push({ ...item, kind: 'execution' });
  }
  // 按 (time + content) 去重
  const dedup = (arr) => {
    const seen = new Set();
    return arr.filter(x => {
      const k = x.time?.toISOString() + '|' + x.content;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };
  return {
    decisions: dedup(decisions).slice(0, 10),
    executions: dedup(executions).slice(0, 10),
  };
}

// ─── 6. 提取"进行中任务"与"待 owner 关注任务" ───────────
function extractBoardSummary(boardRows) {
  const inProgress = boardRows.filter(r => r.statusKey === '🔄');
  const blocked = boardRows.filter(r => r.statusKey === '🚫');
  const recentlyDone = boardRows.filter(r => r.statusKey === '✅');
  // 待 owner 关注：优先级 P0/P1 + 状态非已完成
  const needsAttention = boardRows.filter(r =>
    /P0|P1/i.test(r.priority) && r.statusKey !== '✅'
  );
  return { inProgress, blocked, recentlyDone, needsAttention };
}

// ─── 7. 渲染 ──────────────────────────────────────────────
function render({ commlog, board, gitLog, roleGroups, actions, summary, sources }) {
  // 用本地时区显示时间（避免 owner 看到 UTC 时间）
  const nowStr = NOW.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const sinceStr = opts.since;
  const errors = [];
  if (commlog.error) errors.push(commlog.error);
  if (board.error) errors.push(board.error);

  let md = `# Owner 进度简报 · ${nowStr}\n\n`;
  md += `> 自动生成（来源：COMMLOG + TASK_BOARD + git log · 时间窗：${sinceStr}）\n`;
  md += `> 有疑问随时问我。本简报由 \`scripts/gen-owner-brief.mjs\` 自动维护。\n\n`;

  if (errors.length) {
    md += `> ⚠️ 数据源异常：\n`;
    errors.forEach(e => (md += `> - ${e}\n`));
    md += `\n`;
  }

  // 一、当前状态
  md += `## 一、当前状态（一眼看进度）\n\n`;
  if (summary.inProgress.length === 0 && summary.recentlyDone.length === 0) {
    md += `_最近 ${sinceStr} 无任务状态变更。_\n\n`;
  } else {
    if (summary.inProgress.length > 0) {
      md += `**进行中（${summary.inProgress.length}）**：\n`;
      summary.inProgress.forEach(r => {
        md += `- \`${r.id}\` ${r.name} · ${r.owner} · ${r.priority}\n`;
      });
      md += `\n`;
    }
    if (summary.recentlyDone.length > 0) {
      md += `**已完成（${summary.recentlyDone.length}）**：\n`;
      summary.recentlyDone.slice(0, 5).forEach(r => {
        md += `- \`${r.id}\` ${r.name}\n`;
      });
      md += `\n`;
    }
    if (summary.blocked.length > 0) {
      md += `**阻塞（${summary.blocked.length}）**：\n`;
      summary.blocked.forEach(r => {
        md += `- ⚠️ \`${r.id}\` ${r.name} · ${r.owner} · ${r.priority}\n`;
      });
      md += `\n`;
    }
  }

  // 二、待你决策
  md += `## 二、待你决策（需要你拍板的事项）\n\n`;
  if (actions.decisions.length === 0) {
    md += `_当前没有需要你拍板的事项。_\n\n`;
  } else {
    actions.decisions.forEach((a, i) => {
      const ts = a.time ? a.time.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }) : '';
      md += `${i + 1}. **${ts}** · ${a.who || '未知角色'}：${a.content}${a.content.length >= 120 ? '…' : ''}\n`;
    });
    md += `\n`;
  }

  // 三、待你执行
  md += `## 三、待你执行（需要你动手的动作）\n\n`;
  if (actions.executions.length === 0) {
    md += `_当前没有需要你执行的动作。_\n\n`;
  } else {
    actions.executions.forEach((a, i) => {
      const ts = a.time ? a.time.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }) : '';
      md += `${i + 1}. **${ts}** · ${a.who || '未知角色'}：${a.content}${a.content.length >= 120 ? '…' : ''}\n`;
    });
    md += `\n`;
  }

  // 四、最近进展
  md += `## 四、最近进展（${sinceStr} 内）\n\n`;
  const recentCommLog = commlog.blocks
    .filter(b => b.time && b.time >= SINCE_DATE)
    .slice(0, 10);
  if (recentCommLog.length === 0) {
    md += `_最近 ${sinceStr} 无沟通记录变更。_\n\n`;
  } else {
    recentCommLog.forEach(b => {
      const ts = b.time ? b.time.toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }) : '';
      md += `- **${ts}** · ${b.who || '?'} · ${b.content.slice(0, 80)}${b.content.length > 80 ? '…' : ''}\n`;
    });
    md += `\n`;
  }

  // 五、按角色 commit 摘要（让 owner 知道谁在动）
  md += `## 五、本期按角色 commit 摘要\n\n`;
  const roleKeys = Object.keys(roleGroups.byRole);
  if (roleKeys.length === 0 && roleGroups.unclassified.length === 0) {
    md += `_最近 ${sinceStr} 无 commit。_\n\n`;
  } else {
    roleKeys.forEach(role => {
      const commits = roleGroups.byRole[role];
      md += `**${role}**（${commits.length}）：\n`;
      commits.slice(0, 5).forEach(c => {
        const ts = c.date.toLocaleString('zh-CN', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        md += `- ${ts} \`${c.hash.slice(0, 7)}\` ${c.subject.slice(0, 60)}${c.subject.length > 60 ? '…' : ''}\n`;
      });
      md += `\n`;
    });
    if (roleGroups.unclassified.length > 0) {
      md += `**未识别角色**（${roleGroups.unclassified.length}）：\n`;
      roleGroups.unclassified.slice(0, 5).forEach(c => {
        const ts = c.date.toLocaleString('zh-CN', {
          month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        md += `- ${ts} \`${c.hash.slice(0, 7)}\` ${c.author} · ${c.subject.slice(0, 50)}…\n`;
      });
      md += `\n`;
    }
  }

  md += `---\n\n`;
  md += `_本简报由 \`scripts/gen-owner-brief.mjs\` 自动生成。下次运行：\n`;
  md += `\`\`\`bash\nnode scripts/gen-owner-brief.mjs --since=${sinceStr}\n\`\`\`\n`;

  return md;
}

// ─── 8. Notion 推送（可选） ──────────────────────────────
async function pushToNotion(md) {
  const token = process.env.NOTION_TOKEN;
  const pageId = process.env.NOTION_PAGE_ID; // 00-Owner 进度简报的 page id
  if (!token || !pageId) {
    return { ok: false, error: 'NOTION_TOKEN 或 NOTION_PAGE_ID 未配置' };
  }
  // 简化版：直接 PUT 整页 children（每次覆盖）
  // 生产实现建议用 blocks append + 旧 blocks archive，避免 race
  try {
    // 第一步：清空现有 children
    const listResp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
    });
    const listData = await listResp.json();
    for (const b of listData.results || []) {
      await fetch(`https://api.notion.com/v1/blocks/${b.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' },
      });
    }
    // 第二步：把 markdown 转成 blocks 并追加（简化：每行一个 paragraph）
    const blocks = md.split('\n').map(line => {
      if (line.startsWith('# ')) return { object: 'block', type: 'heading_1', heading_1: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } };
      if (line.startsWith('## ')) return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ type: 'text', text: { content: line.slice(3) } }] } };
      if (line.startsWith('> ')) return { object: 'block', type: 'quote', quote: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } };
      if (line.startsWith('- ')) return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: line.slice(2) } }] } };
      if (/^\d+\.\s/.test(line)) return { object: 'block', type: 'numbered_list_item', numbered_list_item: { rich_text: [{ type: 'text', text: { content: line.replace(/^\d+\.\s/, '') } }] } };
      if (line.startsWith('```')) return { object: 'block', type: 'code', code: { rich_text: [{ type: 'text', text: { content: line.replace(/^```/, '') } }], language: 'plain text' } };
      if (line === '---') return { object: 'block', type: 'divider', divider: {} };
      if (line.trim() === '') return null;
      return { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: line } }] } };
    }).filter(Boolean);
    // Notion 限制每次 append 最多 100 个 blocks
    for (let i = 0; i < blocks.length; i += 100) {
      const chunk = blocks.slice(i, i + 100);
      const resp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ children: chunk }),
      });
      if (!resp.ok) {
        return { ok: false, error: `Notion append failed: ${resp.status} ${await resp.text()}` };
      }
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── 主流程 ──────────────────────────────────────────────
async function main() {
  const commlog = parseCommLog();
  const board = parseBoard();
  const gitLog = parseGitLog();
  const roleGroups = classifyByRole(gitLog);
  const actions = extractOwnerActions(commlog.blocks, board.rows);
  const summary = extractBoardSummary(board.rows);
  const md = render({
    commlog, board, gitLog, roleGroups, actions, summary,
    sources: { comlog: COMMLOG, board: BOARD },
  });

  if (opts.stdout || opts.dryRun) {
    console.log(md);
    if (opts.dryRun) {
      console.error(`\n[DRY-RUN] 不会写入文件，也不会推送 Notion。`);
    }
  } else {
    writeFileSync(opts.output, md, 'utf8');
    console.error(`✅ 已写入：${opts.output}`);
  }

  if (opts.notion) {
    const r = await pushToNotion(md);
    if (r.ok) {
      console.error(`✅ 已推送到 Notion。`);
    } else {
      console.error(`❌ Notion 推送失败：${r.error}`);
      process.exit(1);
    }
  }
}

main().catch(e => {
  console.error(`FATAL:`, e);
  process.exit(1);
});
