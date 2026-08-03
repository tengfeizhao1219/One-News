# Git 操作手册 — 各角色通用推送指南

> **适用对象**：项目所有 AI 角色（测试/视觉/交互/TL/后端/前端/产品/PM）
> **维护者**：项目经理
> **版本**：2026-08-03
> **目的**：解决"会话里没有 git 仓库无法推送"的问题，统一各角色的 clone/pull/push 操作

> 🔓 **【2026-08-03 权限开放】文档复核与 commit 全员可操作**：PRD、需求池、设计文档等**产品文档的「复核 + commit + push」权限向所有角色开放**，不再限于产品经理。详见 §0 权限规则。
> - **决策权不变**：功能"做什么/做成什么样"仍由产品经理拍板（见 `任务交接流转机制.md` §七）。
> - **操作权开放**：任何角色均可基于已确认的需求，对文档做复核、修改、commit 并 push 到 `main`；改动需遵循"先 pull、再改、push 前再 pull"。
> - **避免冲突**：多人同时改同一文档时，先 pull 合并再 push；无法自行合并的冲突登记到 TASK_BOARD 阻塞项，由项目经理协调。

> 🔑 **关于 TOKEN**：本文档中的 `YOUR_GITHUB_TOKEN` 是占位符。实际 token 从以下任一方式获取：
> 1. 从共享保险库 `tdrive` 路径 `vault/github_pat` 读取（如已挂载）
> 2. 直接向项目经理（PM）索取当前有效的 GitHub Personal Access Token
> 3. ⚠️ **不要**把明文 token 写进任何被 git 跟踪的文件（GitHub Push Protection 会拦截）

---

## §0 文档复核与 commit 权限规则（2026-08-03 起生效）

> **核心原则**：文档是协作产物，任何人都可以复核、修改、提交、推送；但「决定做什么功能」的决策权仍归产品经理。

| 维度 | 谁有权 | 说明 |
|------|--------|------|
| **文档复核（review）** | ✅ 所有角色 | 任何角色均可对 PRD / 需求池 / 设计文档提复核意见或直接修订 |
| **文档 commit + push** | ✅ 所有角色 | 改完文档可直接 `git commit + push origin main`，无需经 PM 中转 |
| **功能决策（做什么）** | 🎯 产品经理 | 需求范围、验收标准由 PM 定，见 `任务交接流转机制.md` §七 |
| **技术决策（怎么做）** | 🔧 全栈开发 | 实现方案由全栈开发定 |

**操作流程（文档类改动，全员通用）**
```bash
cd /root/one-news
git pull origin main              # 先拉最新，避免冲突
# 编辑文档（PRD / 需求池 / 设计稿…）
git add <你改的文档>
git commit -m "角色名: 文档修订简述"
git pull --rebase origin main     # push 前再拉，合并他人改动
git push origin main              # 直接推 main，无需分支
```

**冲突处理**：若 `git pull --rebase` 出现冲突，手动解决后 `git add` → `git rebase --continue` → `git push`；实在解决不了 → 登记 TASK_BOARD 阻塞项，项目经理协调。

---

## ⚠️ 为什么其他角色说"没有 git 仓库"？

**根因**：本项目每个 AI 角色是**独立的沙箱会话**。PM 会话里已经 clone 好的 `/root/one-news` 目录，**默认不存在于其他角色的会话中**。

所以其他角色打开会话后，第一件事不是直接 `git pull`，而是先确认/获取项目仓库：

```bash
# 检查你的会话里是否已有项目仓库
ls /root/one-news 2>/dev/null && echo "已有仓库" || echo "没有仓库，需要 clone"
```

- 如果显示"已有仓库" → 跳到【第二步：拉取最新】
- 如果显示"没有仓库" → 从【第一步：获取项目仓库】开始

---

## 第一步：获取项目仓库（首次/新会话必做）

### 方案 A：已有 /root/one-news 但不在 git 状态（少见）

```bash
cd /root/one-news && git status 2>/dev/null && echo "已是git仓库" || echo "需要clone"
```

### 方案 B：clone 项目（推荐，新会话必做）

```bash
# 设置 token（从 tdrive vault/github_pat 获取，或向 PM 索取）
TOKEN="YOUR_GITHUB_TOKEN"

# 用 token 注入方式 clone（避免 TLS 证书问题）
git config --global "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf" "https://github.com/"
cd /root && git clone https://github.com/tengfeizhao1219/One-News.git
git config --global --unset "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf"

# 验证
cd /root/one-news && git log --oneline -1
```

### 方案 C：tdrive 获取 token（如 tdrive 已挂载）

```bash
TOKEN=$(cat /root/tdrive/vault/github_pat 2>/dev/null)
echo "Token 长度: ${#TOKEN}"   # 应输出 36 以上
```

> ⚠️ 当前环境 tdrive 未挂载，请直接用方案 B 的明文 token。

---

## 第二步：拉取最新（每次开始工作前必做）

```bash
cd /root/one-news
git pull origin main
```

如果 `git pull` 报 TLS 错误，用 token 方式：

```bash
cd /root/one-news
TOKEN="YOUR_GITHUB_TOKEN"
git config "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf" "https://github.com/"
git pull origin main
git config --unset "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf"
```

---

## 第三步：执行你的任务

各角色按 TASK_BOARD.md 广播区认领自己的任务，修改对应文件。

**常见修改路径**：

| 角色 | 你通常要改的文件（仅供参考，非限制） |
|------|-----------------|
| 测试工程师 | `docs/05-测试验收/*.md` |
| 视觉设计师 | `docs/02-产品设计/*.md` + `theme.json` |
| 交互设计师 | `docs/02-产品设计/*.md` |
| 技术负责人 | `docs/03-技术方案/*.md` + `cloudfunctions/` 配置决策 |
| 后端开发 | `cloudfunctions/common/*.js` |
| 前端开发 | `pages/` `components/` `app.wxss` |
| 产品经理 | `docs/01-需求规划/*.md` |
| 项目经理 | `TASK_BOARD.md` `COMMLOG.md` `docs/06-上线复盘/` |

> ⚠️ **职责红线（2026-08-03 调整）**：上表是「通常改什么」的**参考**，不是排他权限。
> - **代码类文件**（`cloudfunctions/` `pages/` `components/` 等）仍建议由对应开发角色改动，避免误改引入 bug。
> - **文档类文件**（PRD / 需求池 / 设计文档 / 技术方案 / 测试报告）**所有角色均可复核 + 修改 + commit + push**（见 §0 权限规则），不再限于原「归属角色」。
> - **公共跟踪文件**（`TASK_BOARD.md` `RELAY.md` `COMMLAB.md`）改动前先 `git pull`，push 前再 `git pull --rebase`，避免覆盖他人更新。

---

## 第四步：提交并推送（工作完成后必做）

```bash
cd /root/one-news

# 1. 查看改动
git status

# 2. 暂存你的文件（不要 git add -A 乱加别人的文件）
git add <你改的具体文件>

# 3. 提交（写明你做了什么）
git commit -m "角色名: 任务简述"

# 4. 推送（用 token 注入避免 TLS 证书问题）
TOKEN="YOUR_GITHUB_TOKEN"
git config "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf" "https://github.com/"
git push origin main
git config --unset "url.https://${TOKEN}:${TOKEN}@github.com/.insteadOf"
```

---

## 📁 路径速查表

| 项目 | 路径 |
|------|------|
| 项目根目录 | `/root/one-news` |
| Git 仓库地址 | `https://github.com/tengfeizhao1219/One-News.git` |
| 任务看板（PM 维护） | `/root/one-news/TASK_BOARD.md` |
| 沟通记录（全员写） | `/root/one-news/COMMLOG.md` |
| 测试交付物 | `/root/one-news/docs/05-测试验收/` |
| 产品设计交付物 | `/root/one-news/docs/02-产品设计/` |
| 技术方案交付物 | `/root/one-news/docs/03-技术方案/` |
| 需求规划交付物 | `/root/one-news/docs/01-需求规划/` |
| 上线复盘交付物 | `/root/one-news/docs/06-上线复盘/` |
| 云函数代码 | `/root/one-news/cloudfunctions/` |
| 前端页面 | `/root/one-news/pages/` |
| 前端组件 | `/root/one-news/components/` |

---

## 🔧 故障排查

### 问题 1：推送报 TLS 错误
```
fatal: unable to access 'https://github.com/...': gnutls_handshake() failed
fatal: unable to access 'https://github.com/...': The TLS connection was non-properly terminated
```
**原因**：WorkBuddy 沙箱出站白名单间歇性地拦截 GitHub。
**解决**：
1. 确认用了 token 注入方式（见第四步）
2. 等 1-2 分钟重试 `git push`（白名单是间歇性的，过会儿就通）
3. 连续失败 5 次以上 → 改动留本地，告诉 PM 统一推送

### 问题 2：提示 "fatal: not a git repository"
**原因**：当前目录不是 git 仓库（会话里没 clone）。
**解决**：回到【第一步】执行 clone。

### 问题 3：push 被拒绝 "failed to push some refs"
**原因**：远程有别人的新提交，你本地落后了。
**解决**：
```bash
git pull --no-rebase origin main   # 合并远程改动
git push origin main               # 再推
```

### 问题 4：pull 报冲突 CONFLICT
**原因**：你和别人改了同一个文件。
**解决**：
1. 打开冲突文件，搜索 `<<<<<<<` 找到冲突段
2. 保留需要的内容，删除 `<<<<<<<` `=======` `>>>>>>>` 标记
3. `git add <文件>` → `git commit` → `git push`

---

## ✅ 标准工作流（一句话）

```
确认仓库（没有就 clone）→ git pull → 改文件 → git add 具体文件 → git commit → git push（带 token）
```

---

## ⚠️ 红线提醒

1. **token 只在终端命令里用**，不要写进代码文件、不要 commit 到仓库
2. **不要 `git add -A` 乱加文件**，只加你自己改的
3. **文档可全员复核/commit**（见 §0 权限规则），但代码类文件（`cloudfunctions/` `pages/` `components/`）仍建议由对应开发角色改动
4. **push 前先 pull**（建议 `git pull --rebase`），避免冲突；公共跟踪文件改动尤其注意
5. **改完 TASK_BOARD 要更新自己的任务状态**（📋→✅）
