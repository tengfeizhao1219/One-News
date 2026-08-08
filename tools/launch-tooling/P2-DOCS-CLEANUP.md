# P2 文档归档治理 · 操作清单

> 任务来源：FS 协作机制 Review（2026-08-08）问题 5「文档结构性冗余」
> 目标：解决 `docs/产品文档统一库.md`（1.5MB 重复产物）+ `docs/tasks/` 41 个任务档案与 TASK_BOARD/COMMLOG 三处重叠
> 执行位置：owner 本地 `/workspace/One-News-archive/`

## 待办 1：merge_docs.py 停维护

**背景**：
- `merge_docs.py` 是把 docs/ 下所有单篇 md 合并成 `产品文档统一库.md` 的脚本
- 产物 1.5MB，**与单篇文档 100% 内容重复**
- 存在理由曾是「一页尽览」，但**读取协议已禁读它**（说明它已失去使用价值）

**操作**：
```bash
# 1. 标记为 deprecated（保留 1 个版本，不删）
cd /workspace/One-News-archive
mkdir -p .deprecated
mv merge_docs.py .deprecated/merge_docs.py.v20260808
echo "# DEPRECATED 2026-08-08" > merge_docs.py.deprecated.md
cat >> merge_docs.py.deprecated.md <<'EOF'
本脚本已停维护。

原因：产物 `docs/产品文档统一库.md`（1.5MB）与单篇文档内容 100% 重复，
且读取协议已禁读，AI 协作者无任何场景需要它。

替代方案：
- 看完整目录：直接 ls docs/
- 跨文档查询：让 AI 按需读单篇
- 全景浏览：跑 `node scripts/gen-owner-brief.mjs --since=30d` 生成的 Owner 简报

如有特殊需求恢复，请联系 owner。
EOF

# 2. 产物文件保留为「历史快照」，加 README 说明
mv docs/产品文档统一库.md .deprecated/产品文档统一库.md.v20260808
echo "已停维护。详见 .deprecated/merge_docs.py.deprecated.md" > docs/产品文档统一库.md

# 3. 在 COMMLOG 留痕
echo "## [2026-08-08 19:45] merge_docs.py 停维护 + 产物归档 | 会话：[WorkBuddy PM]
FS Review 问题 5 落实：merge_docs.py 标记 deprecated，产物归档到 .deprecated/
理由：1.5MB 重复内容，读取协议已禁读，无 AI 协作者使用" >> COMMLOG.md
```

**验收**：
- [ ] `merge_docs.py` 不再被任何 cron / GitHub Action / 文档生成脚本调用
- [ ] `docs/产品文档统一库.md` 被替换为 3 行说明
- [ ] COMMLOG 留痕
- [ ] owner 真实工作流无中断（已确认读取协议不依赖它）

---

## 待办 2：docs/tasks/ 41 个任务档案归档治理

**背景**：
- `docs/tasks/` 存了 41 个 RQ-/TL-/UI-/UX-/D-/Q-/RV- 任务的双向 HTML+MD
- 与 TASK_BOARD（任务状态）+ COMMLOG（决策记录）**三处信息重叠**
- 已闭环的任务文档**仍占着目录** —— AI 协作者上手会误以为这些是"待办"

**操作**：
```bash
# 1. 按"已闭环 vs 进行中 vs 待办"分目录
cd /workspace/One-News-archive/docs/tasks
mkdir -p _archive/2025-Q3 _archive/2025-Q4 _archive/2026-Q1 _archive/2026-Q2

# 2. 写归档规则脚本
cat > _archive/RULES.md <<'EOF'
# tasks/ 归档规则（2026-08-08 起执行）

## 何时归档
任务满足以下**全部**条件时，归档到 `_archive/<季度>/`：
- 状态为 `✅` 或 `🚫（已弃）`
- TASK_BOARD 同步过状态（避免双重真源）
- COMMLOG 至少有 1 条「完成」留痕

## 何时删除
满足以下**任一**条件时，可删：
- 是 merge_docs.py 产物（重复内容）
- 是 30 天前的草稿（无 commit、无评审）

## 季度归档
- 每季度最后一天自动归档（cron）
- 归档后 _archive/ 内容仍可在 AI 上下文读取，但默认不在「当前任务」列表
EOF

# 3. 实际归档（owner 手动执行，因为要 review 内容）
# 例：把所有 2025 年的 RQ-1 ~ RQ-15 移到 _archive/2025-Q3/
for d in RQ-1 RQ-2 RQ-3 RQ-4 RQ-5; do
  if [ -d "$d" ] && grep -q "✅" "$d/index.md" 2>/dev/null; then
    mv "$d" _archive/2025-Q3/
    echo "归档: $d"
  fi
done

# 4. 在 TASK_BOARD 加注释
echo "<!-- 2026-08-08: docs/tasks/_archive/ 不再进入 TASK_BOARD 默认视图 -->" >> ../TASK_BOARD.md
```

**验收**：
- [ ] `docs/tasks/` 根目录只剩「进行中」+「待办」任务
- [ ] `docs/tasks/_archive/` 按季度分目录
- [ ] TASK_BOARD 状态与 tasks/ 目录结构同步（不再三处都查）
- [ ] AI 协作者下次读 TASK_BOARD 时，「一、当前状态」不再混入已闭环任务

---

## 通用原则（写进 ROLE_CARDS.md 的 review 节）

1. **真源唯一**：任务状态只在 TASK_BOARD，决策只在 COMMLOG
2. **衍生文档**：tasks/<id>/ 是「一次性的快照」，闭环即归档
3. **不要 merge**：单篇 md 是 AI 最佳粒度，合并产物是噪音
4. **归档而非删除**：保留历史可追溯性，但隔离出「当前上下文」

---

## 风险

| 风险 | 缓解 |
|------|------|
| 归档时漏掉进行中任务 | 归档脚本前先 `git log docs/tasks/<id>/` 看最近 commit |
| AI 协作者找不到归档任务 | _archive/ 仍可读，仅不进默认视图 |
| owner 误删任务 | 归档目录 `.deprecated/` 加 `chmod -w` 防误删 |
