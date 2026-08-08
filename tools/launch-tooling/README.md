# Owner 简报自动生成器 · 接入指南

> 状态：草案 v1.0 · 作者：WorkBuddy (PM) · 待 FS 实施 + owner 验收

## 一、为什么做这件事

**FS 协作机制 Review（2026-08-08）指出的问题 3**：
> 进度感知——你的「信息获取」成本过高...建议给需求方一个「单一事实源」

**已落地的部分**：Notion `00-Owner 进度简报` 页面（PM 维护）
**没落地的部分**：PM 维护成本高、内容空跑（heading 占位但内容空）、commit 后到简报更新有 4 小时延迟

**这个脚本解决的问题**：
- **零维护**：PM/owner 不再手写，commit 推送自动刷新
- **延迟 0**：commit 进 main → 1 分钟内简报更新
- **多源融合**：COMMLOG 沟通记录 + TASK_BOARD 任务状态 + git log commit 摘要，三者交叉

## 二、生成器核心逻辑

### 数据源
1. `COMMLOG.md` — `## [YYYY-MM-DD HH:MM] 标题 | 会话：[ROLE]` 格式的沟通记录
2. `TASK_BOARD.md` — 表格行 `| A-/R-/D-/... | 名称 | owner | 优先级 | 状态 |`
3. `git log --since=24h` — 最近 24h commit，按 author 归类到角色

### 提取规则
- **「待你决策」**：扫描 COMMLOG，匹配关键词「拍板/确认/批准/owner 决策/是否...」
- **「待你执行」**：扫描 COMMLOG，匹配关键词「owner 执行/部署/真机测试/请 owner 登录」
- **「当前状态」**：从 TASK_BOARD 抓 `🔄`（进行中）+ `✅`（已完成，限 5 条）+ `🚫`（阻塞）
- **「最近进展」**：COMMLOG 最近 10 条时间窗内
- **「本期 commit 摘要」**：git log 按角色归类（GM/FE/FS/PM/PD/PJM）

### 输出格式
5 段 markdown：
```
# Owner 进度简报 · <生成时间>
> 自动生成（来源 + 时间窗）

## 一、当前状态（一眼看进度）           ← TASK_BOARD 状态聚合
## 二、待你决策（需要你拍板的事项）      ← COMMLOG 关键词扫描
## 三、待你执行（需要你动手的动作）      ← COMMLOG 关键词扫描
## 四、最近进展（<时间窗>内）            ← COMMLOG 最近 N 条
## 五、本期按角色 commit 摘要            ← git log 按角色归类
```

## 三、3 种触发方式

### 触发 1：本地 pre-commit hook（推荐）
在 `.husky/pre-commit` 或 `.git/hooks/pre-commit` 加：
```bash
#!/usr/bin/env bash
node scripts/gen-owner-brief.mjs --since=24h
git add docs/owner-brief.md
```
**好处**：owner 本地 commit 即看到简报，零延迟。

### 触发 2：GitHub Actions on push main
新增 `.github/workflows/owner-brief.yml`：
```yaml
name: Owner Brief Auto
on:
  push:
    branches: [main]

jobs:
  brief:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 50  # 拉 50 commit 够 24h 摘要
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: 生成 Owner 简报
        run: node scripts/gen-owner-brief.mjs --since=24h
      - name: 提交 docs/owner-brief.md（如有变更）
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "actions@github.com"
          git add docs/owner-brief.md
          git diff --staged --quiet || git commit -m "docs(brief): 自动更新 Owner 进度简报"
          git push
```

### 触发 3：手动
任何时候 owner 可手动跑：
```bash
node scripts/gen-owner-brief.mjs --stdout              # 看一眼
node scripts/gen-owner-brief.mjs --since=3d            # 看 3 天
node scripts/gen-owner-brief.mjs --notion              # 同时推 Notion
```

## 四、Notion 同步

脚本支持 `--notion` 参数，把渲染结果推送到 `00-Owner 进度简报` 页。

**配置**（用 GitHub Secret 或本地 .env）：
```bash
export NOTION_TOKEN="ntn_..."
export NOTION_PAGE_ID="3b66b5eb-1dd8-8110-b79c-ffa22d898d93"  # 00-Owner 简报 page id
```

**实现方式**：
1. 列出现有 children blocks
2. 逐个 DELETE
3. 把 markdown 解析成 Notion blocks（heading/paragraph/quote/list/divider）
4. 批量 PATCH append（每批 ≤ 100）

**注意**：当前实现是「先删后写」全量覆盖，**有 race 风险**（多人同时触发会丢内容）。
生产建议改为：读旧 blocks → diff 变更 → 仅 patch 变更部分。**后续优化项**。

## 五、依赖与部署

### 依赖
- Node 20+（项目 CI 已是 node 20）
- 无 npm 依赖（纯 ESM + fetch）
- 数据源文件存在即可（COMMLOG.md / TASK_BOARD.md 在本地归档 /workspace/One-News-archive/）

### 部署步骤
1. 把 `scripts/gen-owner-brief.mjs` 放到 `scripts/` 目录
2. （可选）把 `test/test-gen-owner-brief.sh` 放到 `test/` 目录（确认她能跑通）
3. 配 GitHub Action（见 触发 2）
4. 配 Notion 同步（见 四）

### 测试
```bash
bash test/test-gen-owner-brief.sh
```
**预期**：用 mock 数据渲染出 5 段 markdown，stdout 输出能直接看到。

## 六、扩展项（v1.1 之后考虑）

- [ ] Notion 同步从「全量覆盖」改为「diff 增量」
- [ ] 输出格式支持 HTML（让 owner 在微信里也能看）
- [ ] 接入定时器：每 4h 自动跑一次（即便没 commit）
- [ ] 接入 Telegram/飞书机器人推送（owner 不在电脑前也能看）
- [ ] Owner 简报历史归档（每周一份 md 进 `docs/owner-brief-history/`）

## 七、与现有脚本的协同

- `scripts/pending-tasks.sh --github` — 已能在 GitHub Action 跑 TASK_BOARD 摘要
- `scripts/gen-kanban-changelog.mjs` — 已能从 COMMLOG + data.js 提取任务详情
- `scripts/gen-task-docs.mjs` / `gen-tasks-json.mjs` — 已能从 tasks.json 生成每任务 md/html

**Owner 简报与以上脚本不冲突，是它们的「汇总层」**：
```
COMMLOG.md ─┐
TASK_BOARD.md ─┼─→ gen-owner-brief.mjs ─→ docs/owner-brief.md
git log ─────┘                            └→ Notion 00-Owner 进度简报
```

## 八、风险与缓解

| 风险 | 缓解 |
|------|------|
| COMMLOG/TASK_BOARD 不在仓库（在归档）| 脚本可配 `COMMLOG_PATH` / `TASK_BOARD_PATH` 环境变量指向归档 |
| Notion 推送 race | 改为 diff 增量（v1.1）|
| owner 没本地 hook | GitHub Action 是兜底，最迟 push 后 5 分钟生效 |
| 关键词漏判 | 关键词表可由 PM 维护在脚本头部 `DECISION_KEYWORDS` / `EXECUTION_KEYWORDS` 数组 |

## 九、验收清单

- [ ] 在 mock 数据下能跑通，输出 5 段 markdown
- [ ] 在真源（COMMLOG + TASK_BOARD）下能跑通，输出含「待你决策」「待你执行」实际条目
- [ ] GitHub Action 配置后，push main 触发 docs/owner-brief.md 自动更新
- [ ] Notion 同步配置后，00-Owner 简报页内容被自动覆盖
- [ ] owner 真实使用后，「二、待你决策」「三、待你执行」内容**不再为空**（即核心问题解决）

## 十一、v1.0 沙箱测试记录（2026-08-08 19:31）

**测试命令**：`bash test/test-gen-owner-brief.sh`
**结论**：✅ 5 段全部正确填充，零报错。

**实测输出**：
```
# Owner 进度简报 · 2026/08/08 19:31
> 自动生成（来源：COMMLOG + TASK_BOARD + git log · 时间窗：24h）

## 一、当前状态（一眼看进度）
**已完成（2）**：
- `RQ-22` 意见反馈留言板
- `FS-05` 上线前检查

## 二、待你决策（需要你拍板的事项）
1. **08/08 09:30** · 全栈开发(FS)：AI 解读代码完成，请 owner 决策是否部署（FS-08）

## 三、待你执行（需要你动手的动作）
1. **08/08 11:00** · 全栈开发(FS)：请 owner 登录小程序后台，配置类目

## 四、最近进展（24h 内）
- **08/08 10:10** · 项目总控(PJM) · Owner 简报机制上线 + token 三层备份
- **08/08 09:30** · 全栈开发(FS) · AI 解读代码完成，请 owner 决策是否部署（FS-08）
- **08/08 11:00** · 全栈开发(FS) · 请 owner 登录小程序后台，配置类目

## 五、本期按角色 commit 摘要
_最近 24h 无 commit。_  ← 沙箱无 git，自动跳过（实际部署后会填）
```

## 十二、v1.0 沙箱发现并修复的 3 个 bug

| # | 现象 | 根因 | 修复 |
|---|------|------|------|
| 1 | 「一、当前状态」空（TASK_BOARD 有 6 条数据）| 任务 ID 正则 `[ARDTBQLM]` 太窄，RQ-/FS-/FE-/CHG-/BUG- 不在内 | 扩为 `[A-Z]{1,5}` |
| 2 | 「二」「三」重复显示同一条（FS-08）| 决策/执行关键词过宽，单条同时命中 | 决策收紧为「请 owner 拍板/是否...」，执行收紧为「请 owner 操作/登录/真机测试」|
| 3 | 时间显示 UTC（13:04）而非 owner 当地（19:31）| `toISOString()` 强转 UTC | 改用 `toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })` |

> 沙箱暴露的"机制跑在 GM 单一环境"问题，**也是 WorkBuddy 接入视角的独立观察**，
> 已写入 FS Review 补充 3——解药是 Notion 共享 + 归档独立 Git 仓（owner 已选 Notion 共享路径）。
