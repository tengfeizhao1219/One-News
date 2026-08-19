# LEARNINGS · AI 情报官教训库

> **目的**：让每个踩过的坑都变成可检索的经验，**同一个坑绝不踩第二次**。
> **规则**：任何修复/返工（≥2 次尝试或 ≥1 小时）完成后，当次必须追加一条；新阶段/新模块开工前必读。
> 本库由 ai-collab v2 升级时（2026-08-19）从 COMMLOG 历史提炼，后续由修复者本人维护。

---

## 教训条目（倒序，最新在上）

### [2026-08-19] 三元表达式空指针：`profile && a ? b : (profile.c ? …)`（代码）

- **症状**：intelDispatcher 发布崩溃 `Cannot read properties of null (reading 'depth')`，今日 18:00 批次卡在 staged 未发布。
- **根因**：`const highTh = profile && profile.depth === 'deep' ? 3 : (profile.depth === 'lite' ? 5 : 4)`——profile 为 null 时第一个分支为 false，但 else 分支仍访问 `profile.depth` → 空指针。
- **正确做法**：三元表达式若前置条件含 null 判断，else 分支必须重复判空：`profile && profile.depth === 'deep' ? 3 : (profile && profile.depth === 'lite' ? 5 : 4)`；或改用 if/else。调用方 `score(d, null)` 传 null 是合法场景，被调用方必须容错。
- **错误路径**：以为是部署问题反复重试（部署后旧实例未刷新的干扰）；实际先看堆栈定位代码逻辑。
- **涉及角色**：I / P


### [2026-08-19] 部署"成功"≠"生效"：首次部署未生效，需验证后确认（部署/验证）

- **症状**：cloudbase 部署 intelFetch 后日志仍是旧格式（`staged=3 brief=1`），功能未生效。
- **根因**：部署动作完成 ≠ 新代码实际加载；无生效验证步骤就标记完成。
- **正确做法**：部署后必须验证生效（看新格式日志/接口实测/对比输出），验证通过才算完成；"部署成功"只算"已提交"。
- **错误路径**：第一次部署后直接信"部署成功"，第二次重部署才发现问题。
- **涉及角色**：I / Q

### [2026-08-19] 历史数据清理漏了 raw 层（intel_ingest），跨天旧文复活（数据）

- **症状**：首页显示"今天 22:00"，实际是昨天（8/18）的数据。
- **根因**：两层问题——① 显示层 `formatLabel` 无条件返回"今天 HH:MM"，忽略 publishedAt 实际日期；② 数据层历史清理只清 `intel_staged`+`intel_current`，**漏清 `intel_ingest`（raw 层）**，旧文仍被 `freshnessDays:7` 窗口捞进本轮 brief。
- **正确做法**：清理/改动涉及多数据层时列「影响面清单」（raw/staged/current/brief 全链路）；显示层做日期边界处理（当天→"今天 HH:MM"，跨天→"MM-DD HH:MM"）。
- **涉及角色**：P / D / I

### [2026-08-19] 首页底部遮挡：修了 4 次才找到根因（前端/微信小程序）

- **症状**：首页滚动到底，最后卡片被底部遮挡。
- **根因链**：① `scroll-view` 的 `padding-bottom` 是已知坑——不撑开可滚动区域（前 2 次白修）；② 换普通 `view`+padding 后仍遮挡——真正根因是 `.intel-home` 用 `height:100vh`，iOS 会把底部手势条安全区计入，内容落到系统区之下。
- **正确做法**：微信小程序容器高度用 `windowHeight`（`--page-h`，One News 首页同款做法），不用 `100vh`；滚动容器用普通 `view` + `overflow-y:auto` 而非 `scroll-view`（需要时可加实体 spacer 双保险）。
- **错误路径**：加 padding → 加 spacer → 换 scroll-view，全是症状级修复。
- **涉及角色**：D

### [2026-08-19] position:fixed + transform 元素仍部分可见（前端/微信 WebView）

- **症状**：首页一打开有米白底部遮罩，改透明度只解决窄条。
- **根因**：微信 WebView 中 `position:fixed` + `transform:translateX(-100%)` 的元素仍部分可见，遮罩根源是覆盖层本身。
- **正确做法**：非激活态用 `visibility:hidden` + `pointer-events:none`（配 transition 延迟切换，进入立即 visible、退出等动画结束再 hidden）。
- **涉及角色**：D

### [2026-08-19] 占位卡"（定义待补充）"：下游兜底掩盖上游缺陷（数据处理）

- **症状**：首页出现 4 条「（定义待补充）」占位卡（rank 4/10/11/12）。
- **根因**：处理层写 staged 前不校验「一句话定义」，空 SOP 仍入库 → 调度层用占位文案兜底，掩盖了上游缺陷。
- **正确做法**：**质量闸门前置**——写 staged 前强校验 `parsed.definition` 必填，空则 `markIngest rejected{reason:'definition-empty'}` 留痕、不进今日关注；调度层再做降级剔除双保险（`degraded` 标记）。
- **涉及角色**：P / D

### [2026-08-18] 分支策略定晚：intel-officer 退役并入 main，三副本手动同步（Git/流程）

- **症状**：分支切换后 WorkBuddy / Desktop / One-News-latest 三副本全要手动切 main。
- **根因**：分支策略（main vs feature）未尽早拍板，feature 分支积累后才迁移。
- **正确做法**：分支策略在 Phase 0 就 owner 拍板写入 ADR；多副本场景靠 git 守护 + 统一 remote，减少手动同步。
- **涉及角色**：O / I

### [2026-08-18] GitHub DNS 劫持：沙箱内 github.com 被解析到错误 IP（环境）

- **症状**：git clone/push 到 github.com TLS 失败。
- **根因**：DNS 将 github.com 解析到错误地址（劫持/污染）。
- **正确做法**：`/etc/hosts` 写入真实 IP（140.82.113.4 github.com codeload.github.com api.github.com）或 `git -c http.curloptResolve=github.com:443:140.82.113.4`；注意沙箱重启会还原 hosts。
- **涉及角色**：I / O

### [2026-08-18] intel-stage 字体档位不跟随：isolated 下父级 CSS 变量穿透失败（前端）

- **症状**：用户改字号档位，情报屏不跟随。
- **根因**：组件 `isolated` 隔离下父级 `--font-scale` 变量穿透不进来。
- **正确做法**：组件加 properties（fontScaleValue/metaScaleValue）+ observer 显式传值，不依赖 CSS 变量穿透。
- **涉及角色**：D
