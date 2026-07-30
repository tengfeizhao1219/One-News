# 实时新闻 - 代码评审记录

> 迭代编号：Iteration 4  
> 评审日期：2026-07-28  
> 评审人：架构师  
> 提交人：开发

---

## 一、变更概览

| 文件 | 操作 | 行数变化 | 说明 |
|------|------|---------|------|
| `cloudfunctions/common/config.js` | **新增** | +38 | API Key 配置、超时、缓存参数 |
| `cloudfunctions/common/cache.js` | **新增** | +74 | 内存缓存工具（TTL 过期机制） |
| `cloudfunctions/common/adapter.js` | **新增** | +142 | 数据适配器（天行/聚合字段映射） |
| `cloudfunctions/common/tianApi.js` | **新增** | +95 | 天行数据 API 封装（重试+超时） |
| `cloudfunctions/common/juheApi.js` | **新增** | +89 | 聚合数据 API 封装（备用） |
| `cloudfunctions/getNewsList/index.js` | **重写** | +163 | 三层缓存 + 三级降级 |
| `cloudfunctions/searchNews/index.js` | **重写** | +92 | API 搜索 + 降级客户端过滤 |
| `utils/request.js` | **微调** | +23 | 新增 handleApiError + 错误码传递 |
| `pages/home/home.js` | **修改** | +30 | 骨架屏/错误/空状态 + 下拉刷新 |
| `pages/home/home.wxml` | **修改** | +35 | 骨架屏 UI + 状态页面 |
| `pages/home/home.wxss` | **修改** | +120 | 骨架屏动画 + 状态页样式 |
| `pages/home/home.json` | **修改** | +2 | 启用下拉刷新 |
| `mock/news.js` | **标记废弃** | +3 | @deprecated 注释 |

**总计**：新增 5 文件，修改 8 文件，净增约 800 行

---

## 二、架构评审

### 2.1 数据流

```
前端 request.js → 云函数 getNewsList/searchNews
                      ├── 第1层：内存缓存（5min TTL）
                      ├── 第2层：云数据库缓存（15min TTL）
                      └── 第3层：天行数据 API（主）
                               └── 降级：聚合数据 API（备）
                                    └── 降级：过期缓存兜底
                                         └── 降级：错误提示
```

### 2.2 关键设计决策

| 决策 | 理由 | 评审结论 |
|------|------|---------|
| 内存缓存使用全局变量 | 云函数实例内跨请求复用 | ✅ 通过 |
| 搜索降级拉全量 50 条过滤 | 天行 API 原生搜索不可用时的保底方案 | ✅ 通过 |
| 骨架屏使用 shimmer + gradient 动画 | 无需额外资源，CSS 纯实现 | ✅ 通过 |
| API Key 存环境变量 | 安全最佳实践 | ✅ 通过 |
| 保留 mock 数据文件 | 本地无网络调试 | ✅ 通过 |

---

## 三、代码质量检查

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 所有模块语法正确 | ✅ 通过 | Node.js 验证通过 |
| 云函数接口签名不变 | ✅ 通过 | `{ code, data: { list, total, hasMore } }` |
| formatNewsItem 输出格式不变 | ✅ 通过 | 前端兼容 |
| 错误处理完整 | ✅ 通过 | 超时/限流/降级/重试全覆盖 |
| 空数据/空关键词处理 | ✅ 通过 | 参数校验 + 友好提示 |
| 分类映射覆盖所有分类 | ✅ 通过 | recommend/tech/sports/life/international |
| XSS 防护 | ✅ 通过 | stripHtml 去除 HTML 标签 |

---

## 四、问题清单

| # | 级别 | 描述 | 状态 |
|---|------|------|------|
| 1 | P0 | **API Key 未配置**：需注册天行数据并设置环境变量 `TIAN_API_KEY` | ⚠️ 待处理 |
| 2 | P1 | **news_cache 集合未创建**：需在 CloudBase 控制台创建缓存集合 | ⚠️ 待处理 |
| 3 | P2 | 聚合数据 API Key 可选，暂不阻塞 | 📝 记录 |

---

## 五、评审结论

- [x] **有条件通过** — 条件：配置天行数据 API Key + 创建 news_cache 集合后即可部署测试
- [ ] ~~无条件通过~~
- [ ] ~~不通过~~

---

## 六、签字

| 角色 | 结论 | 日期 |
|------|------|------|
| 架构师 | 有条件通过 | 2026-07-28 |
| 开发 | 代码已完成 | 2026-07-28 |
