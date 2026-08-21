# AI 情报官 · 会话迁移与继承指南（云端 → 本地模式）

> 目的：把当前云端会话的「沟通 + 推进内容」完整继承给本地模式的新会话，让新会话无缝接棒。
> 适用：WorkBuddy 客户端「云上模式」→「本机模式（连接电脑）」切换时使用。
> 本文档由 O 主控编写（2026-08-18），与《AI情报官_协作机制.md》配套。

---

## 一、继承的三层机制（按可靠性排序）

| 层级 | 机制 | 继承什么 | 可靠性 |
|---|---|---|---|
| 1 | **文件即通信**（本项目核心） | 全部沟通记录、任务状态、计划、决策——即协作五件套 + 15 篇文档 | 🟢 100%，唯一事实来源 |
| 2 | **WorkBuddy 云端记忆**（官方） | 用户画像、历史对话索引（可检索 recall） | 🟡 画像级，自动生效 |
| 3 | **手动交接提示词**（本文 §四） | 新会话启动时一次性注入项目上下文 | 🟢 100%，建议必做 |

> 关键认知：**云端记忆只带「你是谁」，文件机制才带「项目进行到哪」。** 本项目一切推进内容已实时同步到 GitHub（`One-News#intel-officer` 分支）与 Notion（「AI 情报官项目资料」库，15 篇），本地新会话只需读文件即可 100% 继承。

---

## 二、资产位置速查（本地会话取数入口）

| 资产 | 位置 | 说明 |
|---|---|---|
| 代码（前端 `pages/intel/` + 后端 `backend/` + 13 篇文档） | GitHub `tengfeizhao1219/One-News` 仓库 **`intel-officer` 分支** | 本地 clone 即可 |
| 全部文档（15 篇，含协作五件套） | Notion 库 **「AI 情报官项目资料」**（db_id `3c06b5eb-1dd8-81fc-ba87-d7304f735dde`） | 无本地文件也能读 |
| 同步脚本 | 仓库 `ai-intel-sync/`（notion_sync.py / git_sync.sh / sync_all.sh） | 本地需重启守护 |
| 凭证 | GitHub PAT / Notion token（云端存于 secrets，权限 600） | **本地需重新配置**，见 §五 |

---

## 三、操作步骤（按顺序执行）

### Step 1：本机环境就绪
1. 电脑安装 **WorkBuddy 桌面客户端**并保持运行，与手机/小程序登录**同一微信账号**
2. 首次连接：鼠标悬停电脑端小程序图标 → **微信扫码连接**
3. 对话界面输入栏上方切到「**连接电脑**」（本机模式）

### Step 2：本地拉取项目
```bash
git clone -b intel-officer https://github.com/tengfeizhao1219/One-News.git
# 项目文件即在本仓库：pages/intel/（前端）、backend/（后端）、docs/（文档）、ai-intel-sync/（同步脚本）
```

### Step 3：新会话启动（关键）
新建会话后，把 §四 的交接提示词发给本地 AI（可先发提示词，再逐步发任务）。

### Step 4：恢复双通道同步（可选但推荐）
在本地重跑同步守护，保证本地改动实时回推 GitHub/Notion（见 §五）。

---

## 四、新会话交接提示词（复制即用）

```text
你是「AI 情报官」项目的 O 主控（Orchestrator）角色。我是从云端会话迁移到本地
模式的新会话，请先完成上下文继承，再等待我派发任务。

第一步（必读，按顺序）：
1. 读本项目仓库/工作区根目录的 CONTEXT.md —— 项目速览，第一必读
2. 读 ROLE_CARDS.md —— 7 角色定义（O/I/A/P/D/Q/K）
3. 读 TASK_BOARD.md —— 任务看板（当前所有任务状态、关口检查记录）
4. 读 COMMLOG.md —— 沟通交接记录（倒序，看最新进展）
5. 读 RELAY.md —— 既定任务跟踪表（当前阶段与里程碑）
6. 读 AI情报官_协作机制.md —— 协作总规（认领/交付/关口/Git 纪律，含 v2 质量门禁/DoD）
7. 读 LEARNINGS.md —— 教训库（本项目的坑，开工前必读）
8. 读 ADR.md —— 决策日志（owner 拍板与关键决策）
9. 如需要更细上下文，读 intel-docs/ 下其余文档（需求/调研/设计/复用审计/UI 规范等）；**涉及 UI 改动前必读《AI情报官_UI设计准则.md》**
10. 跑 `python3 scripts/check.py intel-docs` —— 一致性审计，结果纳入继承摘要（有阻断项先报告）

第二步：向用户汇报继承摘要（300 字内）：
- 当前阶段（如 Phase 2 抓取层）
- 最近完成项（参照 COMMLOG 最新 3 条）
- 当前待办（参照 TASK_BOARD 进行中任务）
- 待 owner 拍板项（参照 RELAY 末尾 + ADR 中 🔄 状态条目）
- check.py 审计结果（有阻断项先报告，不自行修复）

第三步：等待用户指令，按协作机制推进；改文件后立即 commit+push（git pull --rebase 先行）。
```

---

## 五、本地环境恢复清单

1. **凭证**：在本地建 `secrets` 文件（权限 600，勿提交仓库）：
   ```bash
   mkdir -p ~/.codebuddy/secrets && chmod 600 ~/.codebuddy/secrets
   # 内容：GITHUB_TOKEN=... / NOTION_TOKEN=... / NOTION_PARENT_PAGE_ID=...
   ```
2. **同步守护**（每 60s 轮询，可选）：
   ```bash
   bash -c 'while true; do bash ai-intel-sync/sync_all.sh >/dev/null 2>&1; sleep 60; done' &
   bash -c 'while true; do bash ai-intel-sync/git_sync.sh >/dev/null 2>&1; sleep 60; done' &
   ```
   > 注意：本地跑同步前，先把脚本里的仓库路径/远端分支改为本地实际路径。
3. **双端并行纪律**（云端+本地同时干活时）：
   - 改前 `git pull --rebase`，改后立即 commit+push（协作机制 §三）
   - 认领同一任务前先看 TASK_BOARD 状态，避免双写冲突
   - 关键决策写 COMMLOG，谁写都行，保持倒序

---

## 六、常见问题

| 问题 | 答案 |
|---|---|
| 本地新会话不读文件能继承吗？ | 只能继承 WorkBuddy 云端画像（你是谁），**继承不了项目进度**。必须读协作五件套。 |
| 云端会话还继续跑吗？ | 可以并行。两边都按 §五 纪律 pull/push，文件级无冲突风险（各自改不同文件时）。 |
| 本地没有 GitHub 凭证怎么办？ | 让新会话先只读 Notion 库（无凭证），或你把 token 配进本地 secrets 再 clone/push。 |
| 云端已配好的自定义模型/技能要重配吗？ | 模型配置是客户端侧、不跨设备（除非走云端记忆），本地需按《自定义模型配置》重配；Skills/插件同账号可同步。 |
