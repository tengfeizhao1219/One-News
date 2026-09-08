# One News 项目 · AI 协作推进总指南

> **本文目的**：让任何一个新 AI 会话在 10 分钟内读懂本项目的协作方式、代码/文档管理规则，立即接活干活。
> **生成时间**：2026-09-08。以仓库内最新文档为准（本文是索引与总纲，细节冲突时以各专项规范为准）。
> **一句话概括**：这是一个由多个 AI 会话并行开发、owner（真人）只做决策拍板的微信小程序项目；一切沟通靠「文件即通信」，一切安全靠「先 pull、加锁、只提交自己的文件」。

---

## 一、项目是什么

| 项 | 内容 |
|---|---|
| 产品 | **One News（一页）**——极简资讯微信小程序（卡片流阅读）；内嵌 **AI 情报官** 模块（`pages/intel/`，把 25 个 AI 信源梳理成「与你有关」的叙事化情报） |
| 技术栈 | 微信小程序原生（WXML/WXSS/JS）+ 微信云开发（CloudBase 云函数 + 云数据库） |
| appid | `wx1ccb4d171dd88162` |
| 云环境 | `cloud1-1g9313w0bb791de0` |
| 本地工作目录 | `~/Desktop/One-News`（**微信开发者工具直接打开此目录编译**，即「单副本编辑模式」） |
| GitHub | `tengfeizhao1219/One-News`，**`main` 分支 = 唯一事实来源** |
| 团队构成 | owner（真人，唯一决策者）+ **多个并行 AI 会话**（DeepSeek / WorkBuddy / 其他客户端），无人类工程师 |

**仓库顶层结构**：
```
pages/            小程序页面（home/detail/intel 家族/设置/历史等）
components/       组件（含 intel-stage 桥接组件、single-page-card 等）
utils/            前端工具（shareCard/followUp/intelHistory/cloud 等）
cloudfunctions/   云函数（见 §八清单）
backend/          后端源码母本（部署前同步到 cloudfunctions/ 副本）
ui-demo/          HTML 交互 demo（UI 改动先做 demo 给 owner 确认）
docs/             项目级规范（多会话防覆盖规范等）
intel-docs/       AI 情报官文档库（协作五件套/需求/设计/UI 规范/教训库）
scripts/          运维脚本（git_push.sh / check_intel.sh / file-lock.sh 等）
```

---

## 二、多 AI 并行协作机制（最核心，必读）

### 2.1 为什么有这套机制

多个 AI 会话 + owner（微信开发者工具手动编辑）**共享同一个本地目录**（单副本编辑模式），同时改同一个文件 → **后写者静默覆盖先写者**，git 只能事后发现。因此有一套强制纪律（完整版见 `docs/多会话防覆盖操作规范.md`）。

### 2.2 每次编辑必走的三步流程（强制）

```bash
# ① 编辑前：拉最新，以线上为准
git pull --rebase

# ② 看有没有人正在改你要动的文件（文件锁）
bash scripts/file-lock.sh status
bash scripts/file-lock.sh lock <文件相对路径> <会话标识>   # 拿到锁才能编辑

# ③ 编辑后：释放锁 → 只提交自己改的文件
bash scripts/file-lock.sh unlock <文件相对路径> <会话标识>
git add <改动的文件列表>        # ⚠️ 严禁 git add -A / git add .
git commit -m "类型: 简述"
bash scripts/git_push.sh        # 推送统一走脚本（见 §三）
```

- **会话标识约定**：AI 会话用 `session-I` / `session-D` / `session-O` 等（角色名），owner 手动编辑用 `session-devtools`。锁 TTL 30 分钟自动过期。
- **锁被占用时不得硬编辑**：等其解锁或协商分工；确认无人在编辑才可 `force-unlock`。

### 2.3 工作区红线

- ❌ 工作区里**未提交的他人 WIP 勿动、勿提交**（常见如其他会话改了一半的文件、`cloudfunctions/*/package-lock.json`）。每次开工先 `git status --short` 辨认归属。
- ❌ 禁止 `git push --force` 覆盖他人提交；禁止 `--no-verify` 绕过 pre-push 门禁。
- ❌ 不 lock 就编辑、跨文件大批量提交、push 前不 pull。
- ✅ 改动完成即本地 commit（保护成果）；拿不准归属的问题在 `intel-docs/COMMLOG.md` 广播。

### 2.4 角色体系（可选用的分工框架）

项目定义过 7 个角色（见 `intel-docs/ROLE_CARDS.md`）：**O** 主控编排 / **I** 基础设施 / **A** 数据源适配 / **P** LLM 处理 / **D** 推送UI / **Q** 校验 / **K** 文档。
实际运作以「owner 直接派发 + 各会话自主推进」为主，角色卡用于明确职责边界与产出物归属。子 Agent 模式：主会话可派生子 Agent 临时扮演角色，子 Agent 读 `ROLE_CARDS.md` + `CONTEXT.md` 获得身份。

---

## 三、Git 纪律与推送节奏

### 3.1 标准推送入口：`bash scripts/git_push.sh`（禁止裸 `git push`）

内置：60s 推送间隔保护（`~/.cache/one-news-last-push`）、指数退避重试（10→120s，最多 5 次）、强制 HTTP/1.1（规避 HTTP2 framing 错误）、pre-push 门禁自动执行。

### 3.2 pre-push 门禁

`.git/hooks/pre-push`（新 clone 需先 `bash scripts/install-hooks.sh`）自动跑 `scripts/check_intel.sh`：关键逻辑存在性校验（防止并行覆盖弄丢清理类静默逻辑）+ 冲突标记扫描。**失败拒推，不可绕过。**

### 3.3 推送节奏（防 GitHub 二级限流）

背景：高频 push（实测峰值 10 次/时）触发 GitHub **secondary rate limit**——写操作挂起/超时（`SSL_ERROR_SYSCALL`/`Empty reply`），读操作正常。

| 时机 | 动作 |
|---|---|
| 每次改动完成 | `git add <指定文件>` + `git commit`（本地提交随时做） |
| 常规推送 | 攒批推（3-5 个 commit 一次），或由**隔天第一次对话的会话**统一推送累积提交（owner 2026-09-01 拍板） |
| 紧急/线上事故修复 | 可立即 `bash scripts/git_push.sh`，并在 COMMLOG 注明「紧急推送」 |
| 兜底 | launchd 每日 **23:30** 自动跑 `scripts/daily-commit-push.sh`（`com.one-news.daily-push`；有改动才提交推送，日志 `/tmp/one-news-daily-push.log`）。注意它用 `git add -A`——**所以工作区平时要保持干净，别留不想入库的文件** |
| push 失败时 | 等 60-120s 再用脚本重试，**不要立即重试轰炸**；先 `git fetch` 确认是否其实已推上去 |

### 3.4 网络故障速查

| 现象 | 处置 |
|---|---|
| push 卡死/超时/SSL 错误 | 冷却窗口，等 5-10 分钟用 `git_push.sh` 重试 |
| `HTTP2 framing layer` | 脚本已强制 HTTP/1.1；或 `git config http.version HTTP/1.1` |
| github.com 被解析到 198.18.x（沙箱代理） | 读通常正常、写易挂起——用脚本的重试循环；必要时 `git -c http.curloptResolve=github.com:443:140.82.113.4 pull --rebase` |

---

## 四、文档体系（「文件即通信」，一切靠文件交接）

> 核心理念：**没有 IM、没有会议**。所有沟通记录、任务状态、决策都落在仓库文件里，任何新会话读文件即可 100% 继承上下文。

### 4.1 必读文件地图（按顺序）

| 顺序 | 文件 | 作用 |
|---|---|---|
| 1 | `intel-docs/CONTEXT.md` | 项目速览，任何角色的「记忆外挂」，第一必读 |
| 2 | `intel-docs/COMMLOG.md` | **沟通交接记录**（倒序，最新在上）——看最新 3-5 条即知当前进展 |
| 3 | `intel-docs/AI情报官_会话迁移与继承指南.md` | 接手指南 + **会话恢复块**（最新一轮的快速接续块） |
| 4 | `intel-docs/LEARNINGS.md` | **教训库**——开工前必读，同一个坑绝不踩第二次 |
| 5 | `intel-docs/ADR.md` | 决策日志（owner 拍板的原因与备选，不用翻 COMMLOG 猜） |
| 6 | `intel-docs/TASK_BOARD.md` / `RELAY.md` | 任务看板（状态机：📋→🔄→✅/🚫）与计划跟踪表 |
| 7 | `intel-docs/AI情报官_协作机制.md` | 协作总规（认领/交付/关口检查/DoD/文件锁纪律） |
| 8 | `intel-docs/AI情报官_文档导航与交叉引用索引.md` | 需求/调研/设计/拆解四份核心文档的跳读入口 |

### 4.2 专项规范（按需读）

| 场景 | 必读 |
|---|---|
| 任何 UI 改动 | `intel-docs/AI情报官_UI设计准则.md`（项目 UI 宪法，owner 拍板）+ `AI情报官_UI规范_v1.md` + `AI情报官_深浅色模式规范.md` |
| 多会话并发 | `docs/多会话防覆盖操作规范.md`（本文 §二 的完整版） |
| Git 推送 | `intel-docs/GIT推送规范.md` |
| 情报官技术设计 | `AI情报官_设计文档_v1.md`、`情报详情页话题搜索_技术设计.md` 等 |

### 4.3 文档维护纪律

- COMMLOG **倒序追加**：每次交付/交接必留痕（日期 | 角色 | 事项 | 状态）；这是多 AI 之间唯一的「广播频道」。
- 修复/返工（≥2 次尝试或 ≥1 小时）→ 当次必须写 LEARNINGS；owner 拍板 → 写 ADR。
- 文档与代码同步提交入库；Notion 有镜像库（「AI 情报官项目资料」），但 **GitHub 仓库为事实源**。

---

## 五、UI 设计规范（owner 拍板的项目宪法，所有 AI 必须遵守）

1. **简洁**：删掉对用户无意义的元素（如「已完成收集」状态条）；用视觉形态引导操作，不堆重复设计；文案极简。
2. **禁止系统 emoji / 系统图标**作为 UI 元素（🔍✨🟢⚠️ 一律不行）——要么不显示图标，要么**自绘 SVG 专属图标**（放 `assets/icons/`，注意深色模式需 `-dark` 变体）。
3. **交互跟随大众习惯**：点击有反馈（hover-class）、返回在左上、列表可点有箭头；不做反直觉交互。
4. **设备与原生约束**：自定义导航需与胶囊对齐（menuTop/menuHeight）；状态栏背景层防透出；safe-area 安全区；尺寸用 rpx。
5. **风格一致**：卡片流 + 轻高亮；**颜色/字号/圆角只用 `theme.json` 的 CSS 变量（--text-primary、--bg-card、--primary 等），禁止新增 hex 色值**（有 `scripts/lint-theme-usage.mjs` 可查）。

**UI 改动标准流程**：先在 `ui-demo/` 做 1:1 HTML demo → owner 确认 → 再落小程序代码（对照规范逐项走查）。AI 不得自行改色值/换图标/省略 loading-empty-error 三态。

---

## 六、工具链与环境

### 6.1 微信开发者工具（编译与真机预览）

- 封装技能：`~/.agents/skills/wechat-devtools/`（SKILL.md 含全部命令；仓库内 `.dsh/skills/` 有副本）。
- **推送预览到 owner 微信（最常用）**：`wechatide -c ide auto_preview --project ~/Desktop/One-News`（改 wxml/wxss 自动编译生效；先 `check_wechatide_status` 确认登录态，未登录用 `login --type image` 出二维码给 owner 扫）。
- 上传体验版：`wechatide -c ide upload ...`（owner 明确要求时才用）。

### 6.2 云函数部署

```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" cloud functions deploy \
  --env cloud1-1g9313w0bb791de0 --names <函数名...> --project ~/Desktop/One-News
```
- CLI 只传代码不装依赖——**函数目录必须已有 node_modules**；部署前建议跑 `bash scripts/check_intel.sh` 门禁。
- ⚠️ **intelSearch 特别教训**（线上挂过 3 次）：部署必须 ① 同步 `backend/intelSearch/index.js` → `cloudfunctions/intelSearch/` 副本 ② 改写 require（`../common/`→`./common/`）③ `installDependency: 'TRUE'` ④ 部署后 `getFunctionDetail` 验证 `InstallDependency===TRUE` 且 CodeSize>1MB。
- 部署后**必须验证生效**（触发一次看数据变化），不接受「部署成功」作为完成。

### 6.3 其他环境事实

- 凭证（GitHub PAT / Notion token / LLM keys）：`~/Desktop/Deepseek/.secrets.env`（600，**绝不入库**）。
- TCB Node SDK 临时目录：`/tmp/tcb-sdk`（/tmp 清理后需重建并 `npm install @cloudbase/node-sdk`）。
- 微信 `wx.cloud.callFunction` 无 timeout 参数（忽略即可）；MCP `invokeFunction` 传参用顶层 `params`。

---

## 七、数据链路与云开发资源速查

### 7.1 新闻主链路（One News 正文）

```
newsFetcher(定时 5 节点 05/08/12/18/20 点, cron 7 段: 0 0 5,8,12,18,20 * * * *)
  → news_raw（原始抓取）
  → newsPipeline 三段流水线 process→ai→publish（aiStatus: pending/processing/done）
      · selfHealScheduler 每 10 分钟自愈卡死批次
      · publish: 全量替换 news_cache（wipe+insert）+ pending 守卫 + 跨实例锁（system_kv.publish_lock, 90s TTL）
      · garbleGate 乱码门禁（轻/重分级：轻则清洗、重则打回重跑或丢弃）
  → news_cache（前端展示库）
rssFetcher：RSS 源轮询（36 源），与 newsFetcher 错峰
```

### 7.2 情报官链路（intel_* 命名空间，与主链路物理隔离）

```
intelRssPoll(巡检抓取) → intel_ingest → intelProcess(LLM SOP 五步) → intel_staged
  → intelDispatcher 发布闸门 → intel_current(isCurrent 指针) + intel_current_archive
关注后续：followUpCheck(定时, Tavily+LLM 判新, 14 天时间窗, historyUpdates 去重)
话题搜索：intelSearch(Tavily+LLM, 前端 _doCallSearch 传 profile/history)
```

### 7.3 关键纪律

- 云函数环境时区 = **UTC**：存储一律 UTC；北京时间显示/判断一律用 `backend/common/beijingTime.js`，**禁止裸用 getHours/getFullYear**。
- cron 表达式**必须 7 段**（秒 分 时 日 月 周 年）。
- MCP 写数据库 `action=update` 是**整文档替换**不是字段合并——改单字段必须先读完整文档再写。
- dedup 与 wipe 全量替换有已知顺序问题（先 dedup 后 wipe 会误删，待修，见 §九）。

---

## 八、云函数清单（截至 2026-09-08）

| 分类 | 函数 |
|---|---|
| 新闻主链路 | newsFetcher / rssFetcher / newsPipeline / getNewsList / getNewsDetail / getNewsDelta / getBrowseHistory / recordBrowse / getUserFavorites / setNewsRetained |
| 情报官 | intelFetch / intelRssPoll / intelProcess / intelDispatcher / intelBrief / intelGetList / intelGetDetail / intelSearch / intelProfile / intelManualRun / intelCleanup |
| 关注/反馈 | followUpCheck / feedback-create / feedback-list / feedback-delete |

数据库集合：`news_raw` / `news_staging` / `news_cache` / `intel_ingest` / `intel_staged` / `intel_current` / `intel_current_archive` / `intel_sources` / `intel_health` / `intel_profile` / 关注相关集合 / `system_kv`（跨实例锁等）。

---

## 九、当前状态与待办（截至 2026-09-08，以最新 COMMLOG/恢复块为准）

**最近完成**：
- 朋友圈单页模式（scene 1154）统一为首页同款卡片：新建 `components/single-page-card`（样式完整复制首页卡片），home/detail 单页只渲染该组件；`utils/shareCard.js` v2 改 base64url 紧凑打包（旧 percent-JSON 400 字中文 ≈3600 字符超长风险）
- intel 详情页深挖历史（折叠/持久化）、浏览历史+收藏 30 天滚动清除（utils/intelHistory.js + pages/intel/history）、详情页话题搜索

**进行中/待办**：
1. 🔴 朋友圈单页**真机复验**（owner 分享→朋友圈点开应=纯单页首页卡片样式；异常看 vConsole）
2. 🟡 news_cache AI summary 乱码（U+FFFD）根治待查——疑似 LLM 响应流断字节在 cleanUtf8 之外路径写入（contentFetcher 已修 Buffer.concat 主路径）
3. 🟡 publish 的 dedup+wipe 顺序缺陷（先 dedup 后 wipe 误删条目，方案待 owner 拍板后改）
4. 工作区他人 WIP：`cloudfunctions/followUpCheck/package-lock.json` 未跟踪，勿提交

**微信平台硬限制备忘（朋友圈单页 scene 1154）**：禁一切路由跳转 / 禁 wx.login / 云函数被拦（-501023）/ 本地存储不共用 → 落地页只能读分享 query；仅 Android 能分享到朋友圈；不支持自定义 path 仅 query。

---

## 十、高频坑速查（LEARNINGS 精选，完整版读 `intel-docs/LEARNINGS.md`）

| 坑 | 正确做法 |
|---|---|
| macOS 自带 bash 3.2：`$VAR` 后跟中文/全角字符报 unbound variable | 变量一律写 `${VAR}`（含 `${VAR:-默认}`） |
| 并行改同一文件致静默覆盖（清理逻辑丢失） | 文件锁 + check_intel.sh 存在性校验 + push 前自查 |
| 读 wxml 后又写同文件导致标签失衡 | 整文件读入再一次性写；改完 grep 数 `<block`/`</block>` 平衡 |
| MCP update 全量替换清空字段 | 先读快照留底，update 传完整文档 |
| 云函数 UTC 时区错 8 小时 | 用 beijingTime.js |
| intelSearch 部署后 `Cannot find module` | installDependency=TRUE + 部署后 getFunctionDetail 校验 |
| GitHub push 挂起/SSL 错误 | 二级限流冷却，等 5-10 分钟走 git_push.sh 重试 |
| 微信 query 超长被截断/丢弃 | 分享 query 控制在 ≈1000 字符内（中文用 base64url 而非 percent 编码） |

---

## 十一、新会话接手清单（复制即用的启动动作）

```text
1. cd ~/Desktop/One-News && git pull --rebase          # 以线上为准
2. git log --oneline -15                                # 看最近提交
3. 读 intel-docs/AI情报官_会话迁移与继承指南.md 的「会话恢复块」
4. 读 intel-docs/COMMLOG.md 最新 3-5 条 + LEARNINGS.md
5. git status --short                                   # 辨认他人 WIP，勿动勿提交
6. bash scripts/file-lock.sh status                     # 看活动文件锁
7. 开工：lock → 改 → unlock → add 指定文件 → commit → bash scripts/git_push.sh
8. 收尾：COMMLOG.md 倒序留痕一行；重要教训写 LEARNINGS；owner 拍板写 ADR
9. 小程序改动验证：wechatide -c ide auto_preview --project ~/Desktop/One-News 推给 owner 真机
```

**给新会话的交接提示词（owner 发任务时附带）**：

```text
你是 One News 项目的新 AI 会话。项目协作方式见仓库 docs/AI协作推进总指南.md（先完整读一遍），
然后按其 §十一 清单完成上下文继承（pull → 读恢复块/COMMLOG/LEARNINGS → 辨认他人 WIP），
向我汇报 300 字内的继承摘要（当前进展/待办/你建议的下一步），之后等我的具体任务指令。
纪律：改前 pull+加锁、只提交自己的文件、推送走 scripts/git_push.sh、交付后在 COMMLOG 留痕。
```

---

## 十二、任务完成定义（DoD，标 ✅ 前逐条核对）

- [ ] 文档已更新（约定文件/接口/配置与导航索引同步）
- [ ] 无 TODO/FIXME/占位残留；语法检查通过（JS 用 `node --check`）
- [ ] 影响面已声明（数据/显示/部署/兼容）；部署类改动有**生效验证证据**
- [ ] 小程序 UI 改动符合 §五 UI 宪法（theme tokens、无系统 emoji、三态覆盖）
- [ ] COMMLOG 已留痕；push 走 git_push.sh 且门禁通过
