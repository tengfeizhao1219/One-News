# One News · Release Note v1.2.1

> 发布日期：2026-08-10 ｜ 上一版本：v1.2.0 ｜ 类型：Bugfix + 工程化

---

## 🐛 修复

1. **关于页 / 设置页空白页** — `project.config.json` 的 `packOptions.ignore` 误排除 `config/` 文件夹，导致 `require('../../config/changelog')` 运行时找不到模块、页面 JS 崩溃 → 空白页。已移除该排除规则
2. **首页卡片布局** — 恢复内容垂直居中（改回 margin-auto 方案）；标题不再被顶部状态栏/胶囊条带遮挡（padding-top 按 `menuTop + menuHeight` 动态计算）；AI 摘要完整展示（移除 4 行省略号截断，防超高由 150 字截断 + 标题 5 行 clamp 兜底）
3. **logo 浅色路径** — home dock「关于一页」头像、about 品牌 wordmark 在浅色模式下指向不存在的 `.svg`（应为 `-light` 后缀），已补修

## 🔧 工程化

- **新增 `project.private.config.json` 私有配置模板 + `.gitignore` 忽略** — 微信开发者工具每次打开项目会改写 `project.config.json`（记录本机编译/编辑器设置），是该项目频繁产生 git 冲突、且冲突标记残留破坏 JSON 导致**部署报错**的根因。拆出私有配置后，本机设置优先读写私有文件，`project.config.json` 保持共享稳定

## 📋 部署需知

- **部署报错（重要）**：若微信开发者工具报 `project.config.json` JSON 解析错误，先检查本机该文件是否残留 git 冲突标记（`<<<<<<< Updated upstream` / `=======` / `>>>>>>>`）。清理方式：
  ```bash
  git fetch origin main
  git checkout origin/main -- project.config.json   # 用远程干净版本覆盖本地
  ```
- 全局检查是否还有其他文件残留冲突标记：
  ```bash
  grep -rn "<<<<<<<\|=======\|>>>>>>>" . --include="*.json" --include="*.js" --include="*.wxml" --include="*.wxss"
  ```
- 小程序前端重新上传发布即可；本次不涉及云函数改动，无需重新部署云函数

## ✅ 验证

- v13 FE 暗色可见性契约：100/100
- b10 云函数单元测试：41/41
