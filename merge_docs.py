#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
合并「一页 One-News」产品阶段文档为统一 Markdown，并产出按章节切分的待上传文件。

范围（推荐方案）：
  - 包含：docs/00-规划、docs/00-自查、docs/01-需求规划 ~ docs/06-上线复盘
          + docs/资产库归档、docs/项目日志.md、docs/新会话启动指南.md、docs/共享保险库使用指南.md（附录）
  - 排除：docs/SOP-软件开发流程基准.md、docs/templates/* （协作流程/模板，保持独立）

产物：
  - docs/产品文档统一库.md              单一统一文档（含目录）
  - .notion_build/chapters.json        章节元信息（供 notion_sync.py）
  - .notion_build/ch<idx>_<slug>.md    每个章节一个文件（一个 Notion 子页）
"""
import os, re, json, datetime

REPO = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(REPO, "docs")
BUILD = os.path.join(REPO, ".notion_build")

# 章节定义： (输出索引, 章节标题, [源目录/文件相对 docs 的路径])
CHAPTERS = [
    ("0", "规划与协作机制", ["00-规划", "00-自查"]),
    ("1", "需求规划",       ["01-需求规划"]),
    ("2", "产品设计",       ["02-产品设计"]),
    ("3", "技术方案",       ["03-技术方案"]),
    ("4", "开发实现",       ["04-开发实现"]),
    ("5", "测试验收",       ["05-测试验收"]),
    ("6", "上线复盘",       ["06-上线复盘"]),
    ("A", "附录·资产与日志", ["资产库归档", "项目日志.md", "新会话启动指南.md", "共享保险库使用指南.md"]),
    ("C", "代码快照", []),  # 特殊：不收集 docs/，由 collect_code_files() 单独处理
]

EXCLUDE_FILES = {"SOP-软件开发流程基准.md"}

CODE_SNAPSHOT_DIRS = [
    ("pages", "pages"),
    ("cloudfunctions", "cloudfunctions"),
    ("components", "components"),
    ("utils", "utils"),
    ("test", "test"),
]
CODE_EXTENSIONS = {".js", ".wxml", ".wxss", ".wxs", ".json", ".py", ".html", ".css", ".sh", ".yml", ".yaml", ".md"}
CODE_EXCLUDE_DIRS = {"node_modules", ".git", ".notion_build", ".git-staging", "__pycache__", ".github", "assets", "images", "demo"}

def slugify(s):
    s = re.sub(r"[^\w一-鿿\-]+", "-", s)
    return s.strip("-")[:60]

def demote_heading(line):
    """源文件标题降级 2 级（上限 6），保留标题正文，避免盖过章节/文档标题。"""
    m = re.match(r'^(#{1,6})(\s)(.*)$', line)
    if m:
        n = min(len(m.group(1)) + 2, 6)
        return '#' * n + ' ' + m.group(3)
    return line

def collect_files(rel_paths):
    """返回 (绝对路径, 显示标题) 列表，保持文件夹顺序、文件按名排序。"""
    out = []
    for rp in rel_paths:
        full = os.path.join(DOCS, rp)
        if os.path.isdir(full):
            for fn in sorted(os.listdir(full)):
                if fn.endswith(".md") and fn != "README.md":
                    out.append((os.path.join(full, fn), fn[:-3]))
        elif os.path.isfile(full) and full.endswith(".md"):
            out.append((full, os.path.basename(full)[:-3]))
    return out

def render_doc(title, path):
    """渲染单篇文档：## 标题 + 降级后的正文（跳过源文件首行自带 H1，避免与文档标题重复）。"""
    with open(path, encoding="utf-8") as f:
        lines = f.read().splitlines()
    buf = [f"## {title}", ""]
    skipped_first_h1 = False
    for ln in lines:
        if not skipped_first_h1 and re.match(r'^#\s', ln):
            skipped_first_h1 = True
            continue
        buf.append(demote_heading(ln))
    buf.append("")
    return "\n".join(buf)

def collect_code_files():
    """递归收集 CODE_SNAPSHOT_DIRS 下的代码文件，返回按目录分组的 [(目录名, [(相对路径, 绝对路径)])]"""
    groups = []
    for dir_name, dir_rel in CODE_SNAPSHOT_DIRS:
        full_dir = os.path.join(REPO, dir_rel)
        if not os.path.isdir(full_dir):
            continue
        files = []
        for root, dirs, filenames in os.walk(full_dir):
            dirs[:] = [d for d in dirs if d not in CODE_EXCLUDE_DIRS and not d.startswith(".")]
            for fn in sorted(filenames):
                ext = os.path.splitext(fn)[1].lower()
                if ext in CODE_EXTENSIONS:
                    abs_path = os.path.join(root, fn)
                    rel_path = os.path.relpath(abs_path, REPO)
                    files.append((rel_path, abs_path))
        if files:
            groups.append((dir_name, files))
    return groups

def render_code_snapshot(title, files):
    """渲染代码快照：目录树 + 每个文件的源码。超过 1900 字符的文件截断标注。"""
    lines = [f"## {title}", "", f"> 代码快照 · {len(files)} 个文件 · GitHub 不可用时可从 Notion 资产库独立恢复源码"]
    lines.append("> 生成：" + datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    lines.append("")
    lines.append("### 文件清单")
    lines.append("")
    for rel_path, _ in files:
        depth = rel_path.count(os.sep)
        lines.append(f"{'  ' * depth}- `{rel_path}`")
    lines.append("")
    for rel_path, abs_path in files:
        lines.append(f"### `{rel_path}`")
        lines.append("")
        try:
            with open(abs_path, encoding="utf-8", errors="replace") as f:
                content = f.read()
        except Exception:
            content = "(无法读取)"
        ext = os.path.splitext(rel_path)[1].lower()
        lang = {".js":"javascript",".wxml":"xml",".wxss":"css",".wxs":"javascript",
                ".json":"json",".py":"python",".html":"html",".css":"css",
                ".sh":"bash",".yml":"yaml",".yaml":"yaml",".md":"markdown"}.get(ext, "")
        if len(content) > 1900:
            lines.append(f"```{lang}")
            lines.append(content[:1900])
            lines.append("```")
            lines.append(f"> ⚠️ {len(content)} 字符，已截断。完整内容见 GitHub。")
        else:
            lines.append(f"```{lang}")
            lines.append(content)
            lines.append("```")
        lines.append("")
    return "\n".join(lines)

def main():
    os.makedirs(BUILD, exist_ok=True)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    chapters_meta = []
    unified_parts = [
        "<!-- 本文件由 notion_sync 流水线自动合并生成，请勿手动编辑；源文件变动后重新运行 merge_docs.py + notion_sync.py 即可同步到 Notion -->",
        "# 一页 One-News · 产品文档统一库",
        "",
        f"> 自动合并时间：{now}  ",
        "> 范围：产品阶段文档（00-规划/自查 + 01~06 六阶段）+ 附录资产日志；不含 SOP / templates / 协作框架 live 文档（TASK_BOARD、COMMLOG、ROLE_CARDS 等）。",
        "> 同步目标：Notion 父页《一页 One-News · 产品文档统一库》（key: ntn_2882...）",
        "",
        "## 目录",
        "",
    ]
    toc = []

    for idx, title, rels in CHAPTERS:
        files = collect_files(rels)
        files = [(p, t) for (p, t) in files if os.path.basename(p) not in EXCLUDE_FILES]
        # 跳过 templates 目录（collect_files 已不进 templates，这里双保险）
        files = [(p, t) for (p, t) in files if "templates" not in p.replace(REPO, "")]
        if not files:
            continue
        chapter_md = "\n\n".join(render_doc(t, p) for p, t in files)
        slug = slugify(title)
        chap_path = os.path.join(BUILD, f"ch{idx}_{slug}.md")
        with open(chap_path, "w", encoding="utf-8") as f:
            f.write(chapter_md)
        chapters_meta.append({
            "idx": idx, "title": title, "file": os.path.relpath(chap_path, REPO),
            "docs": len(files), "bytes": len(chapter_md.encode("utf-8")),
        })
        anchor = f"第{idx}章-{title}" if idx != "A" else f"附录-{title}"
        anchor = slugify(anchor)
        toc.append(f"- 第{idx}章 {title}（{len(files)} 篇）")
        unified_parts.append(f"# 第{idx}章 {title}" if idx != "A" else f"# 附录 {title}")
        unified_parts.append("")
        unified_parts.append(f"> 本章含 {len(files)} 篇文档，见下方各节。")
        unified_parts.append("")
        unified_parts.append(chapter_md)
        unified_parts.append("")
        print(f"[章节] 第{idx}章 {title}: {len(files)} 篇, {len(chapter_md.encode('utf-8'))} 字节 -> {os.path.basename(chap_path)}")

    # ---- 代码快照章节（第C章）----
    code_groups = collect_code_files()
    if code_groups:
        total_code = sum(len(files) for _, files in code_groups)
        code_parts = []
        for dir_name, files in code_groups:
            code_parts.append(render_code_snapshot(dir_name, files))
        code_md = "\n\n".join(code_parts)
        slug_c = slugify("代码快照")
        cp = os.path.join(BUILD, f"chC_{slug_c}.md")
        with open(cp, "w", encoding="utf-8") as f:
            f.write(code_md)
        chapters_meta.append({
            "idx": "C", "title": "代码快照", "file": os.path.relpath(cp, REPO),
            "docs": total_code, "bytes": len(code_md.encode("utf-8")),
        })
        toc.append(f"- 附录·代码快照（{total_code} 个文件）")
        unified_parts.append("# 附录 代码快照")
        unified_parts.append("")
        unified_parts.append(f"> 代码快照，{total_code} 个文件。GitHub 不可用时从 Notion 资产库独立恢复全量源码。")
        unified_parts.append("")
        unified_parts.append(code_md)
        unified_parts.append("")
        print(f"[章节] 附录·代码快照: {total_code} 个文件, {len(code_md.encode('utf-8'))} 字节 -> {os.path.basename(cp)}")

    unified_parts.extend(["", "---", "", f"> 文档结束 · 共 {len(chapters_meta)} 个章节 · 生成于 {now}"])
    unified_text = "\n".join(unified_parts)
    # 把目录写回 unified（替换占位）
    unified_text = unified_text.replace("## 目录\n\n", "## 目录\n\n" + "\n".join(toc) + "\n\n", 1)
    unified_out = os.path.join(DOCS, "产品文档统一库.md")
    with open(unified_out, "w", encoding="utf-8") as f:
        f.write(unified_text)
    with open(os.path.join(BUILD, "chapters.json"), "w", encoding="utf-8") as f:
        json.dump(chapters_meta, f, ensure_ascii=False, indent=2)

    total_docs = sum(c["docs"] for c in chapters_meta)
    total_bytes = os.path.getsize(unified_out)
    print(f"\n[完成] 统一文档: {unified_out}")
    print(f"        章节数={len(chapters_meta)}  文档数={total_docs}  体积={total_bytes} 字节 (~{total_bytes//1024} KB)")
    print(f"        章节切分文件位于: {BUILD}")

if __name__ == "__main__":
    main()
