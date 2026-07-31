# 05-测试验收

> 测试工程师 + 产品经理读写目录。测试用例、报告、验收结论、Bug 清单。

---

## 📁 目录索引

### 测试用例文档
| 文件 | 说明 |
|------|------|
| `测试用例终版.md` | 58 条功能用例（首页/侧边栏/详情/搜索/暗色/兼容/异常） |
| `实时新闻-测试用例.md` | 64 条实时新闻专项用例 |
| `新闻自动更新-测试用例.md` | 新闻自动更新专项用例 |
| `Q-01-跨分类阅读测试用例.md` | 🔴 阶段五：18 条跨分类阅读测试（P0×8 + P1×10） |
| `Q-02-字体面板测试用例.md` | 🟡 阶段五：8 条字体面板测试（P1×4 + P1×4） |
| `Q-03-收藏功能测试用例.md` | 🔴 阶段五：10 条收藏功能测试（P1×5 + P1×5） |
| `Q-04-分享功能测试用例.md` | 🟡 阶段五：7 条分享功能测试（P1×5 + P1×2） |
| `Q-05-返回定位测试用例.md` | 🟢 阶段五：6 条返回定位测试（P2×4 + P2×2） |
| `Q-06-回归测试策略.md` | 🔴 阶段五：回归策略（544 自动化 + 49 新增 + 5 冒烟） |

### 测试报告
| 文件 | 说明 |
|------|------|
| `测试报告.md` | 综合测试报告 |
| `集成测试报告.md` | 端到端集成测试报告（⚠️ 待补齐） |
| `性能测试报告.md` | 性能基线报告（⚠️ 待补齐） |
| `V4回归测试报告.md` / `V5` / `V6` | 各版本回归报告 |

### 模板与策略
| 文件 | 说明 |
|------|------|
| `Bug清单模板.md` | Bug 记录格式规范 |
| `验收结论模板.md` | 阶段五验收结论汇总模板 |
| `测试策略总纲.md` | 测试分层策略、自动化范围、环境要求 |
| `A-12d-测试策略预审.md` | 阶段二 D-01 PRD §7 验收标准测试策略预审 |
| `Q-新02-真机兼容性测试计划.md` | 真机兼容性测试计划（设备矩阵+网络场景+执行步骤+通过标准） |

### 回归脚本（`test/`）
| 脚本 | 用例数 | 覆盖 |
|------|:------:|------|
| `v4-regression-data-layer.js` | 180 | 数据层 L1~L5 |
| `v4-regression-integration.js` | 173 | 集成链路 |
| `v4-regression-validator.js` | 67 | 数据校验器 |
| `v4-regression-llmsearch.js` | 55 | LLM 搜索 |
| `v5-regression-touch-architecture.js` | 7 | 手势架构 |
| `v6-regression-bug1-bug2.js` | 25 | Bug1/2 修复 |
| `v7-regression-reading-mode.js` | 37 | 阅读模式（⚠️ 仅静态检查） |

---

## 🚀 运行回归

```bash
node test/v4-regression-data-layer.js
node test/v4-regression-integration.js
node test/v4-regression-validator.js
node test/v4-regression-llmsearch.js
node test/v5-regression-touch-architecture.js
node test/v6-regression-bug1-bug2.js
node test/v7-regression-reading-mode.js
```

> 维护者：测试工程师 | 最后更新：2026-07-31（阶段五 Q-01~Q-06 测试用例交付）
