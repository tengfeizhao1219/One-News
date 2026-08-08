# Owner 简报自动生成器 · 接入指南

> 状态：v1.0 实施完成 · 触发方式：GitHub Actions `workflow_dispatch`(手动)

## 〇、目录变更(2026-08-08 23:18 FS 实施)

- **生成器**: `tools/launch-tooling/gen-owner-brief.mjs` → **`scripts/gen-owner-brief.mjs`**(仓库正典位置,与其他脚本同目录)
- **测试**: `tools/launch-tooling/test-gen-owner-brief.sh` → **`test/test-gen-owner-brief.sh`**
- **GitHub Action**: 新增 **`.github/workflows/owner-brief.yml`**(`workflow_dispatch` 手动触发版,见下文 §三 触发 B)
- **数据源 fixture**: 新增 **`test/fixtures/owner-brief/`**(COMMLOG + TASK_BOARD 2 份 mock),让 GitHub 沙箱能跑出 5 段骨架
- **本文档**(`tools/launch-tooling/README.md`)保留作为 v1.0 设计说明 + 实施笔记,后续更新只动 `scripts/gen-owner-brief.mjs` 头部注释

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

## 三、4 种触发方式(2026-08-08 实施后)

### 触发 A：owner 一键跑(推荐,常用)

**位置**: GitHub 网页 → Actions → "Owner Brief · 手动触发版" → Run workflow

**步骤**:
1. 打开 https://github.com/tengfeizhao1219/One-News/actions/workflows/owner-brief.yml
2. 点 "Run workflow" → 选 since(12h/24h/3d/7d) + 是否推 Notion
3. 等 30s ~ 1min,run 完成
4. 在 run page 看 summary(前 100 行内嵌)+ 下载 artifact `owner-brief-<run_id>`

**数据源**: GitHub 沙箱内**没有 owner 本地归档**,自动用 `test/fixtures/owner-brief/*` mock
- 想跑真源?在本地 clone 后跑"触发 D" 命令行,或配 Notion Secret 让 Action 推

### 触发 B：GitHub Actions on push main(可选,默认关闭)

如果 owner 后续想"commit 推完自动跑",在 `.github/workflows/owner-brief.yml` 取消注释:
```yaml
# on:
#   workflow_dispatch:
#     ...
#   push:
#     branches: [main]   # ← 取消注释这 2 行就生效
```
**注意**: 即使开 push 触发,产物仍只落 artifact,**不会 commit 回主分支**。这样权限最小化(`contents: read` 够用),不会污染 git 历史。

### 触发 C：本地 pre-commit hook(已弃用)

历史推荐过"本地 commit 即看到简报",**实际有 3 个问题**:
1. 依赖 owner 本地有 Node 20 + 仓库克隆
2. 沙箱内无法直接看到(必须 owner 本地终端)
3. 与"触发 A"重复,且 A 更轻

**结论**: v1.1 不再做 pre-commit 接入。

### 触发 D：命令行(开发/调试)

```bash
# 跑 mock 数据(沙箱/本地都行)
bash test/test-gen-owner-brief.sh

# 跑真源(指向 owner 本地归档)
COMMLOG_PATH=~/documents/其他/个人/One-News-archive/COMMLOG.md \
TASK_BOARD_PATH=~/documents/其他/个人/One-News-archive/TASK_BOARD.md \
node scripts/gen-owner-brief.mjs --since=24h

# 输出到 stdout 看一眼
node scripts/gen-owner-brief.mjs --stdout --since=24h

# 推 Notion(需配 NOTION_TOKEN / NOTION_PAGE_ID)
export NOTION_TOKEN="ntn_..."
export NOTION_PAGE_ID="3b66b5eb-1dd8-8110-b79c-ffa22d898d93"
node scripts/gen-owner-brief.mjs --notion --since=24h
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
- Node 20+(项目 CI 已是 node 20)
- 无 npm 依赖(纯 ESM + fetch)
- 数据源文件存在即可(COMMLOG.md / TASK_BOARD.md 在本地归档 `~/documents/其他/个人/One-News-archive/`,或仓库内 `test/fixtures/owner-brief/`)

### 部署步骤(v1.0 已完成,2026-08-08 23:18)

- [x] 1. 把 `scripts/gen-owner-brief.mjs` 放到 `scripts/` 目录 ✅
- [x] 2. 把 `test/test-gen-owner-brief.sh` 放到 `test/` 目录 ✅
- [x] 3. 配 GitHub Action `.github/workflows/owner-brief.yml`(workflow_dispatch 手动版)✅
- [x] 4. 加 `test/fixtures/owner-brief/` mock 数据(让 GitHub 沙箱能跑)✅
- [ ] 5. owner 配 Notion Secret(可选)→ 在 GitHub Repo → Settings → Secrets → `NOTION_TOKEN` + `NOTION_PAGE_ID`
- [ ] 6. owner 跑第一次"触发 A"验收

### 测试
```bash
bash test/test-gen-owner-brief.sh
```
**预期**: 用 mock 数据渲染出 5 段 markdown,stdout 输出能直接看到。

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

- [x] 在 mock 数据下能跑通,输出 5 段 markdown ✅
- [x] 在真源(COMMLOG + TASK_BOARD)下能跑通,输出含「待你决策」「待你执行」实际条目 ✅(命令行触发 D 验证)
- [x] GitHub Action 配置后,push main 触发 docs/owner-brief.md 自动更新 — **改方案**: 配置 workflow_dispatch 手动触发,产物落 artifact,不 commit 回主分支 ✅
- [ ] Notion 同步配置后,00-Owner 简报页内容被自动覆盖(等 owner 配 NOTION_TOKEN Secret + 跑一次推 Notion)
- [ ] owner 真实使用后,「二、待你决策」「三、待你执行」内容**不再为空**(即核心问题解决,等 owner 验收)

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

> 沙箱暴露的"机制跑在 GM 单一环境"问题,**也是 WorkBuddy 接入视角的独立观察**,
> 已写入 FS Review 补充 3——解药是 Notion 共享 + 归档独立 Git 仓(owner 已选 Notion 共享路径)。

## 十三、v1.0 实施记录(2026-08-08 23:18 FS)

**会话**: WorkBuddy (FS) · **commit**: `feat(fs): 推进 Owner 简报 v1.0 接入(workflow_dispatch + artifact)`

**决策变更**(相对 v1.0 草案):
1. **改方案**: push main 触发 → **workflow_dispatch 手动触发**。理由:owner 不需要"每次 commit 自动跑",要的是"我需要时一键拿"。
2. **改产物**: commit 回 `docs/owner-brief.md` → **上传 artifact**。理由:不污染 git 历史,权限 `contents: read` 就够(最安全)。
3. **加 mock fixture**: `test/fixtures/owner-brief/{COMMLOG,TASK_BOARD}.md` —— GitHub 沙箱读不到 owner 本地归档,必须给"最低可跑数据"。
4. **预演发现的 1 个格式 bug**: 角色字段若用半角方括号 `[]` + 半角冒号 `:`,脚本 `会话：\[([^\]]+)\]` 正则不匹配,渲染出"未知角色"。已在 §五 fixture 强制全角规范。

**实施产物**(本次 commit 涉及的文件):
```
新增:
  .github/workflows/owner-brief.yml     # 手动触发 Action(workflow_dispatch + artifact)
  scripts/gen-owner-brief.mjs           # 仓库正典位置(原 tools/launch-tooling/)
  test/test-gen-owner-brief.sh          # 仓库正典位置
  test/fixtures/owner-brief/COMMLOG.md  # mock fixture
  test/fixtures/owner-brief/TASK_BOARD.md

修改:
  tools/launch-tooling/README.md        # §〇/§三/§五/§九/§十三 同步现状
  test/test-gen-owner-brief.sh          # 路径从 $SCRIPT_DIR/ 改到 $REPO_ROOT/scripts/
```

**owner 验收步骤**:
1. 等 commit merge 到 main
2. 打开 https://github.com/tengfeizhao1219/One-News/actions/workflows/owner-brief.yml
3. Run workflow(since=24h + push_to_notion=false)→ 1 分钟内看到 run 完成
4. 验证 artifact 里的 5 段都有内容(应有 1 条决策 + 1 条执行 + 6 条 commit)
5. (可选) 配 `NOTION_TOKEN` + `NOTION_PAGE_ID` Secret,再跑一次勾 push_to_notion
6. 在 Notion 父页验证 00-Owner 进度简报页被全量覆盖

**待 owner 行动**:
- 配 2 个 GitHub Secret(NOTION_TOKEN / NOTION_PAGE_ID) — 可选
- 跑第一次"触发 A"验收 — 必做
- 验收完在 Notion COMMLOG 写"v1.0 简报机制已验收",FS 关单
