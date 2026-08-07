# D-02 增量 · RQ-22 意见反馈留言板 · UI/UX 设计（v1.0）

> **编号**：RQ-22-D | **角色**：产品设计师 | **日期**：2026-08-07
> **上游**：`PRD-RQ22-意见反馈留言板.md`（**v1.1 已确认**，PM）| **任务**：TASK_BOARD RQ-22-D（🔴 P0）
> **对齐**：D-02 交互语言标准（§1 手势/§2 动画/§3 反馈/§5 层级/§6 布局）· D-09 导航规范 · 设置页视觉语言（UI-B9）
> **状态**：✅ **owner 已确认（13:11）→ 开发中（RQ-22-FE / RQ-22-FS）**
> **交付物**：本规范（交互+视觉+暗色 token + **12 条 AC**）+ 静态 demo（`demo/feedback-demo.html`）
>
> **v1.0 变更（对齐 PRD v1.0 · PM commit `750853b` 12:39；owner 13:11 确认后 Q1/Q3/Q4 一并定稿）**：
> - 作者识别：openid 白名单 → `AUTHOR_OPENID` 环境变量 · 单作者（owner）· 云端校验不可伪造（PRD §4.3.2）
> - 管理入口：留言板页面内动态渲染（isAuthor 驱动）· **删除按钮卡片右下角** + **筛选 nav-bar 右侧下拉** 仅 owner 可见（PRD §4.3.3）
> - 作者昵称固定「**一页君**」；普通用户昵称「微信用户 + 随机 4 位」（PRD §4.3.4）
> - 筛选维度：全部 / 仅违规标记 / 仅我的回复（PRD §4.2 流程 2）
> - 软删除（status='deleted'）普通用户不可见、作者可查看（Q3 ✅ 已确认：作者侧已删条目灰显）
> - 字数：**不限字数**（PRD §3.1 F2 已确认；UI 不硬性截断，Q1 ✅ 已确认）
> - 展示留言总数「共 N 条」（Q4 ✅ 已确认）
> - AC 10 → **12 条**（补 AC-11 个人主体 / AC-12 回归全绿）

---

## 1. 页面定位

| 项 | 说明 |
|----|------|
| 页面 | ① 留言板主页面 `pages/feedback/feedback`；② 文明留言公约页 `pages/feedback/rules` |
| 入口 | 设置页「意见反馈」row → `navigateTo` 留言板页（替换现有 `wx.openFeedback()`） |
| 层级 | 第 2 层页面：nav-bar（主页按钮 + 标题「意见反馈」）+ 内容区，与 settings/favorites 一致 |
| 数据 | 云端集合 `feedback`（PRD §5.1）；倒序时间流；多级嵌套（楼中楼） |
| 身份 | 作者识别：openid 白名单 `AUTHOR_OPENID` 环境变量（单作者 owner）· `isAuthor` 云端判定不可伪造（PRD §4.3.2） |
| 昵称 | 普通用户：微信用户+随机 4 位（如「微信用户 8a3f」）；**作者：固定「一页君」+ 作者角标**（PRD §4.3.4） |

**设计基调**：留言板是轻社区页，采用「卡片式列表 + 底部固定输入区」——与新闻详情/收藏的「行式列表」区分，强化「社区讨论」语义；全部走现有 token（浅/深自动跟随），无新色板。

---

## 2. 页面结构

```
pages/feedback/feedback（留言板主页面）
├── nav-bar：主页（左，44rpx icon）+ 标题「意见反馈」（中）+ 筛选「筛选 ▾」（右，仅作者 isAuthor 可见）· D-09
├── 管理计数条（仅作者）：留言总数「共 N 条」
├── 留言列表（scroll-view · 倒序）
│   └── 留言卡片（card）
│       ├── 头：昵称（微信用户+随机 / 一页君+作者角标）+ 相对时间
│       ├── 内容：纯文本（多行 · 不限字数）
│       ├── 右下角（仅作者）：删除「🗑」按钮
│       └── 回复区（展开）
│           ├── 嵌套回复项（缩进 + 浅色底）：昵称（作者角标）+ 时间 + 内容
│           └── 回复输入框（点「回复」展开）
└── 底部固定输入区（留言板主输入）
    ├── 文本框（自适应高度 · 不限字数）
    └── 发送按钮（主题色 · disabled 态）

pages/feedback/rules（文明留言公约页）
├── nav-bar：返回（左）+ 标题「文明留言公约」
├── 违规提示卡（进入即展示「留言未通过审核」+ 具体违规原因）
├── 公约文案（编号列表）
└── 返回留言板按钮
```

---

## 3. 尺寸与位置参数（rpx · 750 设计稿）

### 3.1 留言板主页面
| 元素 | 参数 | 值 |
|------|------|-----|
| 页面背景 | — | `--bg-page` |
| nav-bar | 同 D-09 | top=menuTop · height=menuHeight+24rpx · bg `--bg-page` |
| nav-bar 筛选（仅作者） | 位置 | 标题右侧 · 「筛选 ▾」`28rpx` · `--text-secondary` · 点击弹下拉（全部/仅违规标记/仅我的回复）|
| 管理计数条（仅作者） | 计数 | `24rpx` · `--text-secondary` · padding `16rpx 32rpx 8rpx` |
| 留言列表 | padding | `16rpx 32rpx 40rpx`（左右 32rpx 与收藏页一致，不贴边） |
| 留言卡片 | 背景 | `--bg-card` · 圆角 `20rpx` |
| | padding | `24rpx` |
| | 间距 | 列表项间距 `20rpx` |
| 卡片头 | 昵称 | `28rpx/600` · `--text-primary` |
| | 作者角标 | 22rpx · padding `2rpx 10rpx` · radius `8rpx` · 主题色底白字（`--primary`）· 文字「作者」 |
| | 相对时间 | `22rpx` · `--text-tertiary` · 右对齐 |
| 留言内容 | 字号 | `30rpx` · `--text-primary` · line-height `1.6` |
| 删除（仅作者） | 位置 | **卡片右下角**（PRD §4.3.3 ASCII）· 24rpx · `--color-favorite`（红）· 图标 🗑 + 文字 |
| 回复区 | 缩进 | 距卡片左缘 `16rpx` |
| | 背景 | `--bg-subtle`（浅灰，区分嵌套）· 圆角 `16rpx` · padding `16rpx` |
| | 回复项 | 昵称 24rpx/500 + 时间 20rpx + 内容 28rpx/1.55 |
| | 回复按钮 | 24rpx · `--text-secondary` · 内容下方 |
| 底部输入区 | 位置 | 固定底部（absolute bottom:0） |
| | 背景 | `--bg-card` + 顶部 `1rpx --divider` + 上内边距 `16rpx` |
| | 文本框 | min-height `72rpx` · max-height `200rpx` · padding `16rpx 24rpx` · radius `16rpx` · bg `--tag-bg` · 30rpx |
| | 发送按钮 | 高 `72rpx` · padding `0 32rpx` · radius `36rpx` · bg `--primary` 白字 30rpx · disabled 态 opacity .4 |
| | 30s 冷却提示 | 输入区上方 `20rpx` 居中 · `--text-secondary` · 24rpx |

### 3.2 文明公约页
| 元素 | 参数 | 值 |
|------|------|-----|
| 页面背景 | — | `--bg-page` |
| 违规提示卡 | 背景 `--color-warning-subtle` · 圆角 20rpx · padding 24rpx · 内容 28rpx（⚠️ 图标 32rpx） |
| 公约标题 | `36rpx/700` · 分组标题同设置页 group-label |
| 公约条目 | 编号圆点（primary）+ 28rpx/1.7 · `--text-body` |
| 返回按钮 | 高 88rpx · radius 44rpx · bg `--primary` 白字 30rpx · 底部 padding 40rpx |

---

## 4. 交互规范（对齐 D-02 §1/§2/§3）

| 场景 | 交互 | 反馈 |
|------|------|------|
| 进入留言板 | 设置页「意见反馈」navigateTo | 列表加载（骨架屏 3 条） |
| 提交留言 | 输入 + 点发送 | ① 30s 限频校验：未到时间 → toast「请 N 秒后再试」；② 调 create；③ 成功 → 清空输入 + 列表刷新置顶 + toast「留言成功」 |
| 违规拦截 | create 返回 BLOCKED | 跳转 `rules` 页（携带违规原因），不入库 |
| 回复 | 点留言卡「回复」→ 展开回复输入框 | 输入 + 发送 → 追加到该留言回复区（正序） |
| 嵌套展示 | 多级回复 | 同层缩进 `16rpx`，最深 4 级后收平（防过深） |
| 作者删除 | 留言卡**右下角**「🗑 删除」（仅 isAuthor 可见） | 确认弹窗 → feedback/delete 软删除（status='deleted'）→ 普通用户不可见、作者侧已删条目灰显可查看 |
| 作者筛选 | nav-bar 右侧「筛选 ▾」下拉（仅 isAuthor 可见） | 全部 / 仅违规标记 / 仅我的回复，即时过滤 |
| 冷却提示 | 30s 内再次提交 | 输入区上方显示「请 N 秒后再试」倒计时（每秒更新），倒计时结束消失 |
| 动画 | 列表刷新/回复展开 | ≤300ms ease；toast 120ms 淡入/淡出 |

> 手势：仅点击/输入，无新拖拽手势；回复展开为点击切换；删除用按钮+确认，不用左滑（区别于收藏页，避免混淆）。

---

## 5. 状态设计

| 状态 | 说明 |
|------|------|
| 加载中 | 顶部 3 条骨架（同收藏页 skeleton-item） |
| 空态 | 无留言：「还没有留言，来说两句吧」（icon + 文案 + 去首页） |
| 输入框聚焦 | 输入区上移（键盘弹起），列表滚动到底 |
| 发送 disabled | 空内容 / 冷却中 |
| 删除确认 | wx.showModal「确定删除这条留言？」→ 软删除；作者侧已删条目灰显（可查看） |
| 违规跳转 | rules 页违规提示卡 + 具体原因（BLOCKED 返回违规标记） |

---

## 6. 暗色 Token（全部沿用现有，无新增色板）

| 语义 | 浅色 | 深色 |
|------|------|------|
| 页面背景 | `--bg-page` #F5F3F0 | #000000 |
| 卡片/输入区 | `--bg-card` #FAF9F7 | #0D0D0D |
| 回复区底 | `--bg-subtle` #F0EEEA | #1A1A1C |
| 输入框底 | `--tag-bg` #EEECE8 | #1C1C1E |
| 主文字 | `--text-primary` #1C1C1E | #FFFFFF |
| 次要文字 | `--text-secondary` #6B6B70 | #999999 |
| 弱文字 | `--text-tertiary` #8A8A8E | #666666 |
| 正文 | `--text-body` #5E5E60 | #D4D4D4 |
| 主题色/发送/角标 | `--primary` #007AFF | #0A84FF |
| 删除 | `--color-favorite` #FF3B30 | #FF453A |
| 分隔 | `--divider` #E8E6E1 | #1C1C1E |
| 违规提示底 | `--color-warning-subtle` rgba(245,158,11,.15) | rgba(255,159,10,.15) |

---

## 7. 验收标准（AC · 12 条 · FE 建单用）

| # | AC |
|---|----|
| AC-01 | 设置页「意见反馈」→ navigateTo 留言板页（不再 wx.openFeedback） |
| AC-02 | 留言列表倒序展示，卡片含昵称（作者角标「作者」）+ 相对时间 + 内容 |
| AC-03 | 底部输入区提交留言，成功清空输入 + 列表刷新置顶 + toast |
| AC-04 | 30s 限频：冷却中发送被拦截，输入区上方倒计时提示 |
| AC-05 | 点「回复」展开回复输入，多级嵌套（楼中楼）缩进展示，最深 4 级收平 |
| AC-06 | 作者昵称固定「一页君」+ 回复/留言旁显示「作者」角标（主题色），普通用户无 |
| AC-07 | 作者可见每条留言「🗑 删除」（卡片右下角）；删除确认 → 软删除，普通用户不可见 |
| AC-08 | 作者可见 nav-bar 右侧「筛选 ▾」下拉（全部 / 仅违规标记 / 仅我的回复），切换即时过滤 |
| AC-09 | 提交命中黑名单/AI 违规 → 跳转文明公约页 + 违规提示，不入库 |
| AC-10 | 文明公约页：公约文案 + 违规提示 + 返回按钮；深浅色 token 全部跟随，无硬编码 |
| AC-11 | 个人主体小程序可用（不依赖微信 msgSecCheck；用智谱 GLM-4-Flash 文本审核替代） |
| AC-12 | 回归：v5/v6/v7/v10/v11/v13 全绿 |

---

## 8. FE/FS 交接要点

- **FE（RQ-22-FE）**：`pages/feedback/feedback.{js,wxml,wxss,json}` + `rules.{...}` + 设置页入口改 `navigateTo`；按 §3/§4/§7 实施，AC-01~12 自测。
  - 作者控件仅根据云函数返回 `isAuthor` 渲染（不可伪造）：删除按钮（卡片右下角）+ nav-bar 筛选下拉。
- **FS（RQ-22-FS）**：`cloudfunctions/feedback/*`（create/list/delete）+ 关键词词库 + AI 审核，按 PRD §五。
  - 作者识别：openid 白名单 → 环境变量 `AUTHOR_OPENID`（单作者 owner）· `isAuthor` 云端判定、delete 内再次校验（PRD §4.3.2/§4.3.3）
  - create 复用「留言 + 回复」（parentId 区分）；列表查询 `rootId=null, status='visible'` 倒序；回复正序
  - 软删除：status='deleted'；BLOCKED 返回违规标记供前端展示原因
- **红线**：WXS 纯 ES5 + touch 禁 return false；深色走 token 禁止硬编码；icon 用 `/assets/icons/*.svg`（深色 `-dark` 后缀）。

**owner 已确认（13:11，Q1/Q3/Q4 一并定稿）**：Q1 字数不限（PRD §3.1 F2）· Q3 软删除作者侧灰显可查看 · Q4 展示留言总数「共 N 条」。

---

> **任务归属**：RQ-22-D 交付物。owner 确认 demo 后 → 建 FE 任务（RQ-22-FE，引用 AC-01~12）+ FS 接口对齐。
