# D-02 增量 · RQ-22 意见反馈留言板 · UI/UX 设计（v0.1）

> **编号**：RQ-22-D | **角色**：产品设计师 | **日期**：2026-08-07
> **上游**：`PRD-RQ22-意见反馈留言板.md`（v0.1，PM）| **任务**：TASK_BOARD RQ-22-D（🔴 P0）
> **对齐**：D-02 交互语言标准（§1 手势/§2 动画/§3 反馈/§5 层级/§6 布局）· D-09 导航规范 · 设置页视觉语言（UI-B9）
> **状态**：🆕 待 owner 确认 → 确认后建 FE 任务（RQ-22-FE）
> **交付物**：本规范（交互+视觉+暗色 token + 10 条 AC）+ 静态 demo（`demo/feedback-demo.html`）

---

## 1. 页面定位

| 项 | 说明 |
|----|------|
| 页面 | ① 留言板主页面 `pages/feedback/feedback`；② 文明留言公约页 `pages/feedback/rules` |
| 入口 | 设置页「意见反馈」row → `navigateTo` 留言板页（替换现有 `wx.openFeedback()`） |
| 层级 | 第 2 层页面：nav-bar（主页按钮 + 标题「意见反馈」）+ 内容区，与 settings/favorites 一致 |
| 数据 | 云端集合 `feedback`（PRD §5.1）；倒序时间流；多级嵌套（楼中楼） |

**设计基调**：留言板是轻社区页，采用「卡片式列表 + 底部固定输入区」——与新闻详情/收藏的「行式列表」区分，强化「社区讨论」语义；全部走现有 token（浅/深自动跟随），无新色板。

---

## 2. 页面结构

```
pages/feedback/feedback（留言板主页面）
├── nav-bar：主页（左，44rpx icon）+ 标题「意见反馈」（中）· D-09
├── 作者管理条（仅作者 isAuthor 可见）
│   └── 筛选入口（全部 / 违规标记）+ 留言总数「共 N 条」
├── 留言列表（scroll-view · 倒序）
│   └── 留言卡片（card）
│       ├── 头：昵称（微信用户+随机 / 作者+角标）+ 相对时间 + （作者）删除
│       ├── 内容：纯文本（≤500 字 · 多行）
│       └── 回复区（展开）
│           ├── 嵌套回复项（缩进 + 浅色底）：昵称（作者角标）+ 时间 + 内容
│           └── 回复输入框（点「回复」展开）
└── 底部固定输入区（留言板主输入）
    ├── 文本框（自适应高度 · maxlength 500）
    └── 发送按钮（主题色 · disabled 态）

pages/feedback/rules（文明留言公约页）
├── nav-bar：返回（左）+ 标题「文明留言公约」
├── 违规提示卡（进入即展示「留言未通过审核」）
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
| 作者管理条 | padding | `16rpx 32rpx 8rpx` |
| | 筛选 chip | 同设置页 seg/收藏 filter-chip 规格：28rpx · padding `10rpx 24rpx` · radius 24rpx · on 态 `--text-primary` 底白字 |
| | 计数 | `24rpx` · `--text-secondary` · 右对齐（margin-left:auto） |
| 留言列表 | padding | `16rpx 32rpx 40rpx`（左右 32rpx 与收藏页一致，不贴边） |
| 留言卡片 | 背景 | `--bg-card` · 圆角 `20rpx` |
| | padding | `24rpx` |
| | 间距 | 列表项间距 `20rpx` |
| 卡片头 | 昵称 | `28rpx/600` · `--text-primary` |
| | 作者角标 | 22rpx · padding `2rpx 10rpx` · radius `8rpx` · 主题色底白字（`--primary`） |
| | 相对时间 | `22rpx` · `--text-tertiary` · 右对齐 |
| | 删除（作者） | 24rpx · `--color-favorite`（红）· 位于头右侧 |
| 留言内容 | 字号 | `30rpx` · `--text-primary` · line-height `1.6` |
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
| 作者删除 | 留言卡头「删除」（仅 isAuthor 可见） | 确认弹窗 → feedback/delete 软删除 → 列表移除该条（及子回复） |
| 作者筛选 | 管理条筛选 chip | 全部 / 违规标记（status 标记），即时过滤 |
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
| 删除确认 | wx.showModal「确定删除这条留言？」 |
| 违规跳转 | rules 页违规提示卡 + 具体原因 |

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

## 7. 验收标准（AC · 10 条 · FE 建单用）

| # | AC |
|---|----|
| AC-01 | 设置页「意见反馈」→ navigateTo 留言板页（不再 wx.openFeedback） |
| AC-02 | 留言列表倒序展示，卡片含昵称（作者角标）+ 相对时间 + 内容 |
| AC-03 | 底部输入区提交留言，成功清空输入 + 列表刷新置顶 + toast |
| AC-04 | 30s 限频：冷却中发送被拦截，输入区上方倒计时提示 |
| AC-05 | 点「回复」展开回复输入，多级嵌套（楼中楼）缩进展示，最深 4 级收平 |
| AC-06 | 作者回复/留言昵称旁显示「作者」角标（主题色），普通用户无 |
| AC-07 | 作者可见每条留言「删除」；删除确认 → 软删除，普通用户不可见 |
| AC-08 | 作者可见顶部「筛选」（全部 / 违规标记），切换即时过滤 |
| AC-09 | 提交命中黑名单/AI 违规 → 跳转文明公约页 + 违规提示，不入库 |
| AC-10 | 文明公约页：公约文案 + 违规提示 + 返回按钮；深浅色 token 全部跟随，无硬编码 |

---

## 8. FE/FS 交接要点

- **FE（RQ-22-FE）**：`pages/feedback/feedback.{js,wxml,wxss,json}` + `rules.{...}` + 设置页入口改 `navigateTo`；按 §3/§4/§7 实施，AC-01~10 自测。
- **FS（RQ-22-FS）**：`cloudfunctions/feedback/*`（create/list/delete）+ 关键词词库 + AI 审核，按 PRD §五；接口字段对齐（parentId/rootId/isAuthor/status）。
- **红线**：WXS 纯 ES5 + touch 禁 return false；深色走 token 禁止硬编码；icon 用 `/assets/icons/*.svg`（深色 `-dark` 后缀）。

---

> **任务归属**：RQ-22-D 交付物。owner 确认 demo 后 → 建 FE 任务（RQ-22-FE，引用 AC-01~10）+ FS 接口对齐。
