---
name: notion-task-claim
description: 从 Notion TASK_BOARD 在线拉取最新任务并认领、改代码、PATCH 同步回线上。当用户说"领取任务/领任务/认领任务/检查任务/看看有什么活"时，必须走线上 Notion database（网上才是最新真相源），不得用本地任务板或本地 TASK_BOARD.md 当真相。适用于 One News 项目任何角色窗口（PM/PD/FS/FE）。
agent_created: true
---

# Notion Task Claim — 线上拉任务 + 认领 + 同步

## Overview

当用户说「领取任务 / 领任务 / 认领任务 / 检查任务 / 看看有什么活」时，**一定指去线上 Notion TASK_BOARD 拉最新任务列表**。线上 database 才是最权威的最新源，本地任务板（TaskList）、本地 `TASK_BOARD.md` 都只是缓存/旧快照，**不可作准**。

本 skill 提供完整工作流：查询 → 解析 → 认领 → 改代码 → PATCH 状态同步 → COMMLOG 广播。

## 触发词 / 使用时机

- "领取任务" / "领任务" / "认领任务" / "检查任务" / "看&#039;任务/bug" / "还有什么活"
- 任何需要查看 or 更新项目任务状态的请求

## 核心纪律（必须遵守）

1. **线上为准**：拉任务一律走 Notion TASK_BOARD database（POST query），**禁用**本地任务板当真相。
2. **Token 从 keys/SECRETS.md 读**，经环境变量注入，**不硬编码**进脚本/对话正文。
3. **PATCH 页面属性可行**（HTTP 200 已验证，Token B）；**POST 创建任务仍 404**（新建任务走 COMMLOG 兜底）。
4. **汇报用中文自然语言**，禁止自造任务代号（如「BUG-FE-01」这类是 TASK_BOARD 里已存在的真实标题可直接引用，但新代号须 owner 拍板）。
5. 改代码前 `git status` + `git pull --rebase`；commit 前缀带角色（`fix(fe):` 等）；**改动默认必推**。
6. 共享白板/MEMORY/COMMLOG **禁止第一人称**，用 sid 或角色前缀。

## 工作流（Workflow-Based）

### Step 1 — 读取凭据（环境变量）

```bash
cd "{workspace}"
export NOTION_TOKEN="$(grep -oP 'ntn_[A-Za-z0-9]+' .workbuddy/keys/SECRETS.md | head -1)"
export TASK_BOARD_ID="3b66b5eb-1dd8-8107-80ef-f8546b076e4f"
```

> 字段细节见 `references/project-config.md`。

### Step 2 — 拉任务列表（线上）

```bash
node .workbuddy/skills/notion-task-claim/scripts/query-taskboard.mjs --json
# 只想看某角色：
node .workbuddy/skills/notion-task-claim/scripts/query-taskboard.mjs --role=前端 --json
```

输出 `{ stats, tasks[] }`。关注：
- **待认领**（`状态=📋` 且负责人为我）
- **进行中**（`状态=🔄`，负责人为我可接手）
- 记录每个任务的 `page` id（后续 PATCH / 取正文用）

### Step 3 — 看任务正文

对候选任务用 REST 拉正文 blocks：

```bash
PAGE_ID="<page_id>"
curl -s "https://api.notion.com/v1/blocks/$PAGE_ID/children?page_size=50" \
  -H "Authorization: Bearer $NOTION_TOKEN" -H "Notion-Version: 2022-06-28" \
  | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);for(const b of j.results||[]){const t=b.type;const rt=b[t];if(rt&&rt.rich_text){const s=rt.rich_text.map(x=>x.plain_text||"").join("");if(s.trim())console.log("·",s)}else if(t==="bulleted_list_item"||t==="numbered_list_item"){const s=(rt&&rt.rich_text||[]).map(x=>x.plain_text||"").join("");if(s.trim())console.log("·",s)}}})'
```

理解任务要做什么（尤其是否引用设计稿，如 D-04 v0.2 某节）。

### Step 4 — 认领 & 改代码

1. `git status` + `git pull --rebase` 确认本地干净、与他人不冲突。
2. 只改本任务范围内的文件，不动他人 worker 正在改的部分。
3. 改前读目标文件，改后语法检查（`node --check` for JS / python json for JSON）。
4. 有回归测试则跑（如 `node test/v10-regression-fe-c1-bugfix.js`），确保通过。

### Step 5 — 提交 & 推送

```bash
git add <files>
git commit -m "fix(fe): 简述（任务标题）
- 改动点 1
- 改动点 2
回归：v10 通过 53 / 失败 0"
git push
```

### Step 6 — PATCH 回线上（状态同步）

```bash
node .workbuddy/skills/notion-task-claim/scripts/patch-status.mjs <page_id> --status="✅ 已完成" --date="$(date +%F)"
#if 需要改负责人：
node .workbuddy/skills/notion-task-claim/scripts/patch-status.mjs <page_id> --owner="前端"
```

验证返回 `OK  HTTP 200`。

### Step 7 — COMMLOG 广播 + 记忆

交接广播（交付物 + 下游动作 + 注意事项）：

```bash
cat >> ~/.workbuddy/whiteboard/commlog/$(date +%F).md << 'EOF'

---

## HH:MM — <标题>（<角色>, commit `<hash>`）

**交付物**：<文件/commit/测试结果>
**下游动作**：<owner 真机验收 / QA 写验收> 
**注意事项**：<权威源取舍、待办>
EOF
```

再把当日改动 append 到 `{workspace}/.workbuddy/memory/$(date +%F).md`；对可复用决策写进项目 `MEMORY.md`。

## 资源

### scripts/
- `query-taskboard.mjs` — 线上拉任务并结构化输出（`--role`/`--json`）。
- `patch-status.mjs` — PATCH 任务状态/负责人/日期（HTTP 200）。

### references/
- `project-config.md` — 页面 id 索引、Token 选择、权限现状、字段约定。

## 经验 / 坑

- **「领任务」走线上**：本地任务板可能全 completed 而线上刚挂了新 bug，务必线上。
- **PATCH 页面属性 OK**：项目历史误判「只能 GET」，实际 Token B PATCH 状态 200 已验证，勿再说需要 owner 加 connection。
- **文案以设计稿为权威**：Task 描述与设计稿冲突时，以 design 文档（已锁版本）为准，并在交付说明里标注。
- **不带密码进 skill**：token 只从 SECRETS.md 读，改 SECRETS.md 时同步校验本 skill 的 config 引用未破坏。
