# 会话沟通记录（Communication Log）

> **用途**：每个会话结束时的交接记录。按时间倒序排列。
> **格式**：时间戳 + 会话标识 + 完成内容 + 变更文件 + 遗留问题 + 注意事项。

---

## [2026-07-30] 密钥管理文档对齐 tdrive 保险库机制 | 会话：项目经理（PJM）

### 完成内容
- 更新 `docs/项目日志.md` 与 `scripts/update-project-log.sh` 的「敏感信息保险库」章节
- 密钥管理准则由「不进代码、不进 Git、不回显，存本地保险库」改为「不进代码、不进 Git 仓库（含提交历史）、不回显；但可集中存放于 tdrive 项目保险库（云盘）`vault/`」
- 机制描述对齐现状：本地 `/root/.secrets/` + `secret_*` 脚本 → tdrive `vault/`（dir_id `NbXEQRsesdqd`）+ `file_download` 临时 URL + `git -c url...insteadOf` 注入
- 待办行 `GitHub PAT 管理` → `GitHub PAT 轮换为 fine-grained（仅 One-News 仓库 write）`（需仓库所有者操作）
- 天行章节密钥路径由 `/root/.secrets/tian_api_key` 改为「天行控制台 → 云函数环境变量」

### 变更文件
- `docs/项目日志.md` — Secrets Vault 章节 + 待办行 + 天行密钥路径
- `scripts/update-project-log.sh` — `VAULT_EOF` 块（项目日志每 2h 由本脚本重生，故源头在此）
- 提交 `4d3a98d`，已 push 至 `origin/main`

### 遗留问题
- 经典 PAT（≈整账户权限）**尚未轮换为 fine-grained PAT**：需仓库所有者登录 GitHub 新建 fine-grained PAT（仅 One-News write）、撤销经典 PAT、并将新令牌更新进 tdrive `vault/github_pat`。本会话仅做文档化登记，未执行轮换（无账户权限，且不可贸然撤销唯一可用推送令牌）。

### 注意事项
- `docs/项目日志.md` 为自动生成文件，手动改会被定时任务覆盖；本次同步改了生成脚本的 `VAULT_EOF` 块，确保声明一致。
- 下一步（项目经理职责）：等**产品经理**确认交付物（A-01 点名的阅读模式需求 T-01、聚合独立分类 tab 决策、D-01 PRD 定稿）后，产出①整体项目计划 ②交付任务拆分 ③任务间交接流转机制（定稿）。

---

## [2026-07-30] 协作机制升级 v2.3（统一看板 + 跟踪表） | 会话：项目经理（PJM）

### 完成内容
- `TASK_BOARD.md` 升级为「统一任务看板」：计划内（6 阶段）+ 临时新增（Backlog A-xx）双池合并
- 新增优先级列（🔴🟡🟢）+ 认领人列，明确拉式认领规则
- `RELAY.md` 从「阻塞式接力棒」转为「既定任务跟踪表」（计划内线性交接全景视图，不阻塞）
- `ROLE_CARDS.md`：8 角色均开放 TASK_BOARD 认领/建交接任务权限；RELAY 跟踪表仅 PJM 维护
- `COLLABORATION.md`：新增统一看板认领机制 + 误用棒 3 分支（提示正确角色 + 转即席）
- 保留 PM 关口检查（方案 A）：阶段任务全 ✅ 后 PJM 把关，通过才开放下一阶段任务
- 修复「误用棒触发只拒绝不转即席」缺陷，固化 3 分支意图识别

### 变更文件
- `TASK_BOARD.md` — 重写为统一看板 v2
- `RELAY.md` — 重写为既定任务跟踪表 v2.0
- `ROLE_CARDS.md` — v1.4（看板权限 + 误用棒 3 分支）
- `COLLABORATION.md` — v2.3（看板认领 + 跟踪表）
- `COMMLOG.md` — 本记录

### 遗留问题
- 无

### 注意事项
- 角色会话初始化话术需同步更新（看板认领 + 误用棒 3 分支），见项目经理发出的新版话术
- 误用棒触发必须「提示正确角色 + 转即席」两步，不可只拒绝
- 角色认领任务后务必填「认领人」列，便于追溯

---

## [2026-07-30] 共享保险库搭建 | 会话：项目经理（PM）

### 完成内容
- 在 tdrive 项目盘根目录新建 `vault/` 目录（dir_id = `NbXEQRsesdqd`）
- 上传 `github_pat`（经典 PAT，≈整账户权限）到 `vault/github_pat`
- 上传 `vault/README.md` 使用说明（含安全须知、各角色使用方法、轮换指南）
- 用途：让所有角色会话都能从 tdrive 取令牌做 git push

### 变更文件
- tdrive: `vault/github_pat`（新建，file_id = NJZQjYLZjTkW）
- tdrive: `vault/README.md`（新建，file_id = NwguxcUAqVvh）
- 本仓库无代码变更（tdrive 操作不产生 git 提交）

### 遗留问题
- 共享的是经典 PAT（≈整账户权限），建议后续轮换为 fine-grained PAT（仅 One-News 仓库 write 权限）
- 现有文档 `update-project-log.sh` / `docs/项目日志.md` 中「密钥不进云盘」规则与本次决策冲突，待更新

### 注意事项
- `git pull` 不需要 token（仓库公开）；只有 `git push` 需要从 tdrive 取 github_pat
- 各角色使用方法：tdrive `file_download` → 读入 TOKEN → `git remote set-url` → `git push` → 还原 remote → 删除临时令牌文件
- 一旦令牌疑似泄露，立即到 GitHub 撤销/轮换

---

## [2026-07-30] 接力棒机制 | 会话：[主]

### 完成内容
- 新增 RELAY.md 接力棒机制 —— 实现会话间自动推进
- 更新 COLLABORATION.md 加入接力棒流程
- 更新 CONTEXT.md、TASK_BOARD.md 反映最新状态
- 完整流水线：[dev]→[test]→[主]，用户只需说「接棒」

### 变更文件
- RELAY.md — 新建（接力棒核心机制）
- COLLABORATION.md — 加入接力棒规范
- CONTEXT.md — 更新最新提交和协作框架
- TASK_BOARD.md — 增加角色列 + 流水线状态
- COMMLOG.md — 本记录

### 遗留问题
- 无

### 注意事项
- 新会话启动只需说「接棒」或「git pull，读 RELAY.md 接棒」
- 每个会话交付时必须更新 RELAY.md 指向下一棒

---

## [2026-07-29] 数据层三连击收尾 | 会话：[主]（数据层）

### 完成内容
- v11：正文清洗加固（contentExtractor 实体解码 + 噪音过滤 + 首页标题截断）
- v12：聚合（Juhe）L4 降级接入 + 分类透传修复（移除不可靠的 JUHE_TYPE_TO_APP 反向映射）
- v13：卡片摘要补全（空摘要自动抓正文首段兜底 enrichMissingSummaries）+ 标题截断加固（word-break/overflow-wrap + 摘要限 3 段）
- 部署 getNewsList / getNewsDetail 到云端；云端空摘要由 2/10 降至 0/10
- 数据层回归测试 178/178 通过；rebase origin/main 后 push（6b7598f）

### 变更文件
- cloudfunctions/common/contentExtractor.js — 新增 extractSummary
- cloudfunctions/getNewsList/index.js — 新增 enrichMissingSummaries，接入 L1/L4
- cloudfunctions/common/adapter.js — 分类透传，移除 JUHE_TYPE_TO_APP
- cloudfunctions/common/config.js — 聚合配置就绪
- pages/home/home.wxss — 标题截断加固
- pages/home/home.js — 摘要限 3 段
- CONTEXT.md / TASK_BOARD.md / RELAY.md / COMMLOG.md — 修正项目记忆（真实数据接入已落地）

### 遗留问题
- ~~百炼 API Key 轮换~~ — 已搁置（2026-07-30 用户决策）
- 聚合是否作为某分类主数据源 / 开放体育·生活等独立 tab（用户曾问，未决定）
- 前端（home.wxss/home.js）改动需用户在微信开发者工具重新编译预览才生效

### 注意事项
- 标题截断若是仍出现，多半是前端未重新编译（纯前端改动，云端无需操作）
- 如担心聚合 Key 泄露，可在聚合后台重置后重新注入 JUHE_API_KEY 环境变量

---

## [2026-07-28] 框架搭建 | 会话：[主]

### 完成内容
- 建立多会话协作框架（CONTEXT.md + COLLABORATION.md + TASK_BOARD.md + COMMLOG.md）
- 全部 46 个文档迁移到 tdrive 项目资产库
- 项目日志文档创建并上传

### 变更文件
- CONTEXT.md — 新建
- COLLABORATION.md — 新建
- TASK_BOARD.md — 新建
- COMMLOG.md — 新建（本文件）
- docs/项目日志.md — 已上传 tdrive

### 遗留问题
- 详情页阅读模式待开发（T-01）
- home.js 诊断日志待清理（T-05）

### 注意事项
- WXS 必须纯 ES5，参见 CONTEXT.md 关键开发红线
- 新会话启动流程：git pull → 读 CONTEXT.md → 读 TASK_BOARD.md → 认领任务

---

> **下一条记录请追加在上方（时间倒序）**
