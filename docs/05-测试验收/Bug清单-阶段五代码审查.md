# Bug 清单 — 阶段五 代码审查发现

> **审查人**：测试工程师 | **审查日期**：2026-07-31
> **审查范围**：阶段四 B-01~B-07 + UX-FIX01~06 全部变更文件

---

## #1 🟡 reading-engine.js: `_buildMergedList` 空分类回退定位越界

| 项 | 内容 |
|----|------|
| **Bug ID** | BUG-20260731-001 |
| **严重度** | 🟡 中（罕见触发，但后果是定位到错误新闻） |
| **模块** | `pages/detail/reading-engine.js` §`_buildMergedList` |
| **行号** | L154-156 |

### 复现条件
入口分类的所有 `getNewsList` 请求均失败（该分类返回空 list），且 `entryNewsId` 未匹配到任何条目，触发 category+index 回退定位。

### 根因
```javascript
// L123: 每个分类无论有无数据都会写入 indexes
indexes[catId] = startIdx  // 空分类的 startIdx 等于 merged.length（不会增长）

// L154-156: 回退定位
var catStart = indexes[this._entryCategory] || 0
entryGlobalIndex = catStart + Math.min(this._entryIndex, (merged.length - catStart - 1))
```

当该分类为空时：`catStart == merged.length`，则 `merged.length - catStart - 1 = -1`，`Math.min(entryIndex, -1) = -1`，最终 `entryGlobalIndex = merged.length - 1`（上一条分类的末条），而非报错或兜底到 0。

### 期望行为
空分类应定位到 `catStart`（即 merged 末尾位置，显示"该分类无数据"或兜底到相邻分类首条）。

### 修复建议
```javascript
if (!foundEntry && this._entryCategory) {
  var catStart = indexes[this._entryCategory] || 0
  var catSize = merged.length - catStart
  if (catSize <= 0) {
    entryGlobalIndex = 0  // 空分类兜底到首条
  } else {
    entryGlobalIndex = catStart + Math.min(this._entryIndex, catSize - 1)
  }
}
```

---

## #2 🟡 detail.js: 分享占位图预生成时序竞态

| 项 | 内容 |
|----|------|
| **Bug ID** | BUG-20260731-002 |
| **严重度** | 🟡 中（D-05 设计走查已标记为 🔴 #1，UX-FIX02 修复不完整） |
| **模块** | `pages/detail/detail.js` §`_pregenPlaceholder` / `onShareAppMessage` |
| **行号** | L366-416 |

### 复现条件
1. 进入详情页
2. 在 300ms 内（Canvas 组件 attached 前）点击分享按钮
3. 新闻本身无 `picUrl`

### 根因
UX-FIX02 用 300ms setTimeout 等待 Canvas 组件初始化，但用户可能在 300ms 内就点击分享。此时 `this._placeholderCache === undefined`，`onShareAppMessage` 的 `imageUrl` 降级为 `undefined`，微信使用默认小程序图标——丢失了分类主题色占位图。

### 期望行为
① 分享按钮在占位图就绪前禁用或显示 loading 态；② 或 `onShareAppMessage` 检测到缓存未就绪时同步生成简易占位图（纯色 base64）。

### 修复建议
```javascript
// 方案 A: 分享按钮初始 disabled，占位图就绪后启用
data: { shareReady: false },
_pregenPlaceholder: function() {
  // ...生成成功后
  that.setData({ shareReady: true })
}

// 方案 B: onShareAppMessage 同步兜底
onShareAppMessage: function() {
  var imageUrl = news.picUrl || this._placeholderCache
  if (!imageUrl) {
    // 同步生成简单纯色占位图（不需要 Canvas）
    imageUrl = this._getSimplePlaceholder(news.category)
  }
}
```

---

## #3 🟢 detail.js: 分享标题截断可能拆分 emoji

| 项 | 内容 |
|----|------|
| **Bug ID** | BUG-20260731-003 |
| **严重度** | 🟢 低（emoji 出现在新闻标题中概率低） |
| **模块** | `pages/detail/detail.js` §`onShareAppMessage` |
| **行号** | L399-401 |

### 复现条件
新闻标题包含多字节 emoji（如 👨‍👩‍👧‍👦，由多个 UTF-16 码元组成），且 `'一页 | ' + title` 总长度 > 30。

### 根因
`title.slice(0, 29)` 按 UTF-16 码元切割，可能从 emoji 中间截断产生 `\uD83D` 孤立的 surrogate half，导致渲染为 �。

### 修复建议
```javascript
// 使用 Array.from 安全截断（按 codepoint）
var chars = Array.from(title)
if (chars.length > 30) {
  title = chars.slice(0, 29).join('') + '…'
}
```

---

## #4 🟢 detail.js: `_engine.init()` 回调可能在页面销毁后执行

| 项 | 内容 |
|----|------|
| **Bug ID** | BUG-20260731-004 |
| **严重度** | 🟢 低（仅控制台 warning，不崩溃） |
| **模块** | `pages/detail/detail.js` §`_initEngine` |
| **行号** | L117-139 |

### 复现条件
进入详情页后，在 `engine.init()` 完成前立即返回（如网络慢 > 2s 时用户不耐烦退出）。

### 根因
`engine.init().then(function() { that.setData(...) })` 的 Promise 回调不检查页面是否已销毁。

### 期望行为
页面销毁后不调用 setData（微信会打印 "page not found" warning）。

### 修复建议
```javascript
onUnload: function() { this._destroyed = true },
// 在回调中检查
engine.init().then(function() {
  if (that._destroyed) return
  that.setData(...)
})
```

---

## 审查总结

| 统计 | 数量 |
|------|:---:|
| 🔴 阻断 | 0 |
| 🟡 中 | 2（#1 空分类越界 / #2 分享竞态） |
| 🟢 低 | 2（#3 emoji截断 / #4 页面销毁回调） |
| **合计** | **4** |

### 建议处理优先级
1. **#2 分享竞态** → 前端开发（D-05 走查已标记，UX-FIX02 修复不完整，建议追加修复）
2. **#1 空分类越界** → 技术负责人确认是否需修（概率低但后果为定位错误）
3. **#3/#4** → 可遗留至后续迭代

> **审查人**：测试工程师 | **日期**：2026-07-31
