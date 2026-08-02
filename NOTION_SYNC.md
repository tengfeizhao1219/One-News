# 产品文档统一库 · Notion 同步指南

> 维护角色：PM ｜ 适用范围：所有产品阶段文档（00-规划/自查 + 01~06 六阶段）
> 最后同步：2026-08-02

## 目标

把分散在 `docs/` 下的产品阶段文档合并为**一份统一文档**，并同步到 Notion 知识库，做到
「不再零散、一页尽览、改动即同步」。所有产品文档都遵循这一逻辑。

## 日常只需两条命令

```bash
python3 merge_docs.py    # 1) 合并 docs/ 下阶段文档 → docs/产品文档统一库.md + .notion_build/ 章节切分
python3 notion_sync.py   # 2) 将切分章节上传到 Notion（父页 + 分阶段子页）
```

## 范围约定

- **包含**：`docs/00-规划`、`docs/00-自查`、`docs/01-需求规划` ~ `docs/06-上线复盘`
  ，以及附录 `docs/资产库归档`、`docs/项目日志.md`、`docs/新会话启动指南.md`、`docs/共享保险库使用指南.md`。
- **排除**：`docs/SOP-软件开发流程基准.md`、`docs/templates/*`，以及协作框架 live 文档
  （`TASK_BOARD.md`、`COMMLOG.md`、`ROLE_CARDS.md`、`RELAY.md`、`COLLABORATION.md` 等）。
  这些属于「怎么协作」而非「产品是什么」，保持独立。

> 新增产品文档时，直接放进对应阶段文件夹即可，重跑 `merge_docs.py` 会自动纳入；
> 不要再把同类文档散落在根目录或新建同名文件。

## Notion 结构

- **顶层父页**：《一页 One-News · 产品文档统一库》（workspace 根）
- **子页**（每阶段一页）：
  - 第0章 规划与协作机制
  - 第1章 需求规划
  - 第2章 产品设计
  - 第3章 技术方案
  - 第4章 开发实现
  - 第5章 测试验收
  - 第6章 上线复盘
  - 附录·资产与日志
- 父页内含「章节导航」链接，点击直达各章。

## 幂等与状态

- Notion 集成 token 通过**环境变量 `NOTION_TOKEN`** 注入（或写入仓库根 `.notion_token` 文件，已 gitignore）。
  **请勿将明文 token 提交进仓库**（GitHub 密钥扫描会拦截推送）。运行前：
  `export NOTION_TOKEN=ntn_xxxx` 然后 `python3 notion_sync.py`。
- 重跑会**复用同一父页**，并**归档上一版子页、新建当前版**，不会重复建页。
- 状态存于 `.notion_build/sync_state.json`（已提交仓库），跨会话 / 沙箱重置后仍可复用父页，避免重复顶层页。
- ⚠️ **Notion 限制**：workspace 级页面**无法经 API 归档或删除**。若某次同步异常中断，
  可能在 workspace 根留下同名重复顶层页，需在 Notion UI 手动删除（集成无删除权限）。

## 转换与限制说明

- 支持的块：标题 / 段落 / 有序·无序列表 / 代码块 / 引用 / 分隔线 / 表格。
- 行内样式：加粗 `**`、斜体 `*` `_`、行内代码 `` ` ``、链接 `[t](u)`。
- 超长文本 / 代码自动按 2000 字符切分（Notion 上限）。
- 删除线 `~~x~~`：Notion 列表项不支持 strike 注解，转换时已自动降级为纯文本（保留内容）。
- 429 限流已内置指数退避，失败重跑即可。

## 故障排查

| 现象 | 处理 |
|------|------|
| 同步报 429 | 脚本已内置退避，直接重跑 |
| workspace 建父页失败 | 脚本自动回退挂到搜索到的某个 workspace 页 |
| 出现重复顶层页 | 在 Notion UI 手动删除旧页（API 无权删 workspace 页） |
| 内容未更新 | 先 `merge_docs.py` 再 `notion_sync.py`；确认 `.notion_build/sync_state.json` 中 parent_id 正确 |
