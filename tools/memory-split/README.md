# tools/memory-split/

8/8 (2026-08-08) 48KB memory 拆分工具集。

## 背景

`.workbuddy/memory/2026-08-08.md` 是单日单 PM 窗口内多角色切换(PM→FS→FE→PD)的当日流水账,46 段 / 48KB / 47 主题混杂。被 FS-20260809-JZDP1NQJ0TA6 窗口于 2026-08-09 09:15 按主题分桶拆出。

## 工具

### `split-2026-08-08.mjs`

把 `2026-08-08.md` 按 4 桶拆到 `by-window/`,主体压到 ~8KB 跨窗口大事。

```bash
# 1. dry-run 校验桶匹配(不动文件)
node tools/memory-split/split-2026-08-08.mjs --dry-run

# 2. 真拆(会自动 chmod u+w 防 read-only 阻塞)
node tools/memory-split/split-2026-08-08.mjs
```

**输出**:
- `by-window/2026-08-08-OLD-PM-PM.md` (~12K,13 段) — PM 决策 + 项目盘点 + v1.1.0 发布
- `by-window/2026-08-08-OLD-FS-FS.md` (~11K,7 段) — FS 调研 + Owner 简报实施 + 读全流转机制
- `by-window/2026-08-08-OLD-FE-FE.md` (~5K,4 段) — FE 权责 + 状态 + 待办
- `by-window/2026-08-08-OLD-PD-PD.md` (~9K,11 段) — PD 调研 + Logo 迭代 v1-v15 全史
- `2026-08-08.md` 主体:48K → 8K,留 9 段跨窗口大事
- `2026-08-08.md.bak`:仅首次生成,留底完整原文

## 注意事项

1. **idempotent**:重跑不覆盖 .bak,只覆盖 by-window 和主体(因为主体 8K < 10K 阈值,不会重复备份)
2. **chmod u+w**:原 8/8.md 是 read-only (`-r--r--r--`),脚本会自动 chmod 后再写
3. **全角冒号**:原文 21:32 / 21:35 / 22:00 段标题用全角 `：`,脚本桶定义已对齐(踩坑已修)
4. **MEMORY.md 索引**:跑完务必同步更新 `.workbuddy/memory/MEMORY.md` §七 8/8 拆分索引段
5. **Notion 同步**:跨窗口大事(主体 9 段)应写入 `~/.workbuddy/whiteboard/commlog/2026-08-09.md` 让其他 4 窗口看到
6. **本机 vs git**: `.workbuddy/` 被 .gitignore, by-window/MEMORY 不入仓;脚本是仓内可复用基础设施,各窗口本机各跑一次

## 首次拆分(2026-08-09 09:15)

- 跑窗口:FS-20260809-JZDP1NQJ0TA6
- commit:7fc0120 (SSH pushed)
- 主体大小:48K → 8K
- 总段:46 段全部分配,0 重复 0 缺
