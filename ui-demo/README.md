# AI 情报官 · UI 设计基准页

> **本目录是 UI 的「最终确认源」**：所有页面设计的唯一基准。任何 UI 改动（设计/实现/评审）**必须先改本页 → 确认 → 再落地到小程序**，禁止临时做单页 demo 推翻已确认方案。
> 访问：GitHub Pages（部署后见仓库 Settings → Pages）。

## 包含页面

| 页 | 说明 |
|---|---|
| 首页 | 卡片流 + 对你最重要 tag + 浅蓝底 + 本周可试用 |
| 详情 | 结论标题 + 三段式叙事 + 落到你这里 + 了解更多/想试试 + 深入了解入口 |
| 我的 | 身份画像 + 合规（信息源/推送暂不支持） |
| 初始化 | 4 步 stepper（身份/领域/深度/合规，自动回填） |
| 深入了解 | 一键深挖 + 自定义话题搜索 + AI 综合解读 |

## 功能

- **多项目可扩展**：顶部项目选择器（当前：AI 情报官）。新增项目 = 在 `PROJECTS` 数据对象加一项（name + pages），页面/标注全数据驱动，无需改框架。
- **页面切换**：顶部导航切换各项目页面
- **深浅色**：一键切换，双套验证
- **设计标注模式**：点击任意元素 → **右侧滑出标注抽屉**，显示：设计意图 / 关键参数（字号·圆角·间距·颜色 token）/ 小程序代码位置 / 对应设计准则；附「复制标注 JSON」按钮——**结构化数据，AI 可直接读取**（可读性/可用性第一）
- 标注数据源：`PROJECTS[project].pages[page].notes[]`（selector/name/intent/params/code/guideline）

## 如何维护（所有 AI 遵守）

1. **改 UI 先改本页**：新设计/调整先在此实现 → 确认 → 再改小程序 `pages/intel/*` 与 `components/intel-stage/*`。
2. **设计标注同步**：新增/修改元素时，必须补 `data-note`（设计意图）与 `data-code`（小程序对应类名/文件），保证可追溯。
3. **准则**：遵守 `intel-docs/AI情报官_UI设计准则.md`。
4. **标注必须详细**：每个元素补全 intent（为什么）/ params（具体参数）/ code（代码位置）/ guideline（准则），AI 可读性第一。
4. 改动提交后 GitHub Actions 自动部署到 Pages。

## 部署

- 源：`ui-demo/` 目录（main 分支）
- 方式：`.github/workflows/gh-pages.yml`（Actions 构建部署到 gh-pages 分支）
- 手动触发：Actions 页面 re-run workflow
