# 一页 - 微信小程序

> 极简沉浸式新闻阅读。打开即读，上下滑动，零干扰。

---

## 快速开始

### 1. 环境准备
- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（最新稳定版）
- 已注册的微信小程序 AppID
- 开通云开发环境

### 2. 导入项目
1. 打开微信开发者工具
2. 选择「导入项目」
3. 目录选择本项目的根目录
4. 填入你的 AppID
5. 点击「确定」

### 3. 配置云开发
1. 在开发者工具中点击「云开发」按钮
2. 开通云开发环境（选择按量付费或免费额度）
3. 复制环境 ID
4. 在 `app.js` 中初始化云开发：
```js
wx.cloud.init({
  env: '你的环境ID',
  traceUser: true
})
```

### 4. 部署云函数
1. 在开发者工具中，右键 `cloudfunctions/getNewsList`
2. 选择「上传并部署：云端安装依赖」
3. 同样操作 `getNewsDetail` 和 `searchNews`

### 5. 导入数据
在云开发控制台 → 数据库 → 创建集合 `news`，导入 Mock 数据（参考 `mock/news.js` 的数据格式）。

### 6. 切换到生产模式
修改 `utils/constants.js`：
```js
const USE_MOCK = false  // 改为 false 使用云函数
```

### 7. 预览与发布
- 点击「预览」在手机上测试
- 确认无误后点击「上传」提交代码
- 在小程序后台提交审核

---

## 项目结构

```
yiyue/
├── app.js/json/wxss          # 应用入口
├── theme.json                # 暗色模式变量
├── pages/
│   ├── home/                 # 首页（卡片流）
│   ├── detail/               # 详情页
│   └── search/               # 搜索页
├── cloudfunctions/
│   ├── getNewsList/          # 获取新闻列表
│   ├── getNewsDetail/        # 获取新闻详情
│   └── searchNews/           # 搜索新闻
├── utils/
│   ├── constants.js          # 常量配置
│   ├── util.js               # 工具函数
│   └── request.js            # 请求层（Mock/云函数双模式）
└── mock/
    └── news.js               # Mock数据
```

---

## 交互说明

| 手势 | 功能 |
|------|------|
| ↑ 上滑 | 切换到下一条新闻 |
| ↓ 下滑 | 切换到上一条新闻 |
| ← 左滑 | 呼出新闻列表面板 |
| 点击卡片 | 进入详情页 |
| 详情页返回 | 回到卡片流 |

---

## 配色方案

- 浅色：暖灰背景 `#F5F3F0` + 暖白卡片 `#FAF9F7`
- 暗色：深灰背景 `#1A1A1C` + 深色卡片 `#252527`
- 分类标签：统一低饱和灰色

---

## 上线前检查清单

- [x] 替换 AppID 为你的小程序 AppID ← ✅ wx1ccb4d171dd88162
- [x] 开通云开发并配置环境 ID ← ✅ cloud1-1g9313w0bb791de0
- [ ] 部署所有云函数
- [ ] 在云数据库导入新闻数据
- [x] 将 `USE_MOCK` 改为 `false` ← ✅ 已切换
- [ ] 配置小程序后台（类目、名称、图标）
- [ ] 真机测试所有交互
- [ ] 提交审核
