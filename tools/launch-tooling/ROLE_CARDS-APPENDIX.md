# ROLE_CARDS.md 追加节 · 「机制 review 记录」

> 直接追加到 `/workspace/One-News-archive/ROLE_CARDS.md` 文件末尾。
> 用途：让机制自我进化可追溯，避免再开新文件造成 FS Review 提到的「文档冗余」。

---

## 十三、机制 Review 记录

> 本节是「协作机制本身」的修订日志。FS 提出的机制诊断、owner 决策、落地结论，
> 都沉淀在这里，不再开新文件。每条 review 一节，按时间倒序。

### Review 1 · 2026-08-08 · FS 协作机制全局 Review

**Reviewer**：[全栈开发(FS)]
**Review 对象**：以 AI 多角色会话为主体、owner 为需求方的项目推进机制
**Owner 决议**：全部 6 条诊断 + 3 条补充均认可，逐条推进

#### 诊断 1：多角色会话是结构化分工还是过度工程？
- **结论**：保留 GM + PM + FS + PD + FE 5 角色，**任务并行不多时其他角色不启用**（按需启停）
- **替代方案**：5 角色硬砍到 2 角色（PM+FS）→ **未采纳**，因为会影响 1.0 期间并行能力
- **触发器**：每个 sprint 开始由 PJM 评估「并行度」决定启用哪些角色

#### 诊断 2：AI 验收 AI —— 同源盲区是最大质量隐患
- **结论**：**外置验证优先于 AI 内部交叉验收**
- **已落地**（FS 8/8）：`.github/workflows/ci.yml` 跑 `node --check` + test/*.js
- **下一步**：CI 跑通后，所有 v1.0 之前的关键路径必须有运行时验证

#### 诊断 3：进度感知信息过载
- **结论**：Owner 简报改为**触发式自动生成**
- **Owner 工作**：WorkBuddy 提交 PR `gen-owner-brief.mjs`（v1.0 mock 测试通过）
- **待 FS 实施**：放 `scripts/` 目录，配 GitHub Action

#### 诊断 4：环境韧性不足（token 丢失 + TLS 拦截）
- **结论**：双轨制
  - 立即：归档目录每周 tar 备份到微云（**owner 待办**，WorkBuddy 已交付 `backup-archive.sh`）
  - 中期：Notion 共享给第三方 AI（owner 已选这条路径，**待 owner 给 Notion share URL**）

#### 诊断 5：文档结构性冗余
- **结论**：merge_docs.py 停维护 + tasks 档案归档治理
- **Owner 工作**：执行 `P2-DOCS-CLEANUP.md` 操作清单（已交付）

#### 诊断 6：文件读写占大头
- **结论**：广播区设「置顶焦点」只留 3 条，COMMLOG 周粒度轮换
- **Owner 工作**：PJM 下次会话开始执行

#### WorkBuddy 独立补充
- **补充 1**：建议 5 角色 → 2 角色太激进，owner 选了「按需启停」折中
- **补充 2**：Owner 简报从「PM 维护」改为「触发式自动生成」（见诊断 3 落地）
- **补充 3**：沙箱撞 TLS_ERROR 暴露「机制只考虑了 GM 单一环境」——解药是 Notion 共享

#### Review 1 决策汇总表

| 优先级 | 事项 | 状态 |
|--------|------|------|
| P0 | Notion 共享给第三方 AI | ⏳ owner 待给 Notion share URL |
| P0 | 5 角色按需启停 | ✅ 折中方案已定 |
| P1 | Owner 简报触发式自动生成 | ✅ WorkBuddy 已交付 v1.0 mock 测试 |
| P1 | CI 门禁 | ✅ FS 8/8 已落地（commit 12b70bc） |
| P2 | 归档目录 tar 备份 | ✅ WorkBuddy 已交付 `backup-archive.sh`，owner 待执行 cron 安装 |
| P2 | merge_docs 停维护 + tasks 归档 | ✅ WorkBuddy 已交付 `P2-DOCS-CLEANUP.md`，owner 待执行 |
| P2 | 广播/日志精简 | ⏳ PJM 下次会话执行 |

### Review 模板（下次用）

```markdown
### Review N · YYYY-MM-DD · 主题

**Reviewer**：[角色]
**Review 对象**：（机制 / 单模块 / 单文档）
**Owner 决议**：

#### 诊断 N
- **现象**：
- **结论**：
- **替代方案**：
- **Owner 工作**：

#### 决策汇总表
| 优先级 | 事项 | 状态 |
|--------|------|------|
```
