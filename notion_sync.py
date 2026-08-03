#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
notion_sync.py —— 将 merge_docs.py 产出的章节 Markdown 同步到 Notion。

结构：在 workspace 下创建顶层父页《一页 One-News · 产品文档统一库》，
      下挂各阶段子页（规划协作 / 需求 / 设计 / 技术 / 开发 / 测试 / 复盘 / 附录）。

特性：
  - Markdown → Notion blocks：标题/段落/有序无序列表/代码块/引用/分隔线/表格
  - 行内样式：加粗 **、** 斜体 * _ 行内代码 ` 删除线 ~~ 链接 [t](u)
  - 超长文本/代码自动按 2000 字符切分（Notion 上限）
  - 分批 append（每批 ≤100 块），429 限流指数退避
  - 幂等 upsert：复用 .notion_build/sync_state.json，重跑只更新内容不重复建页
用法：
  python3 notion_sync.py            # 全量同步
  python3 notion_sync.py --parent <page_id>   # 指定父页面（如不希望建在 workspace 根）
"""
import os, re, json, time, sys, requests
from urllib.parse import quote

REPO = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(REPO, ".notion_build")
STATE_FILE = os.path.join(BUILD, "sync_state.json")

def load_token():
    """Notion 集成 token：优先环境变量，其次本地 gitignore 的 .notion_token 文件。绝不硬编码写库。"""
    t = os.environ.get("NOTION_TOKEN")
    if t:
        return t.strip()
    local = os.path.join(REPO, ".notion_token")
    if os.path.exists(local):
        with open(local, encoding="utf-8") as f:
            return f.read().strip()
    raise SystemExit(
        "❌ 未找到 Notion token。请任选其一：\n"
        "   1) export NOTION_TOKEN=ntn_xxx  再运行 notion_sync.py\n"
        "   2) 将 token 写入 .notion_token 文件（已 gitignore，不会进仓库）")

TOKEN = load_token()
H = {"Authorization": f"Bearer {TOKEN}", "Notion-Version": "2022-06-28", "Content-Type": "application/json"}
PARENT_TITLE = "一页 One-News · 产品文档统一库"
RICH_MAX = 1900  # 行内文本单对象上限（<2000 留余量）

CODE_LANG_MAP = {
    "bash":"bash","sh":"bash","shell":"bash","zsh":"bash",
    "python":"python","py":"python","javascript":"javascript","js":"javascript",
    "json":"json","yaml":"yaml","yml":"yaml","xml":"xml","html":"html","css":"css",
    "sql":"sql","java":"java","go":"go","rust":"rust","c":"c","cpp":"c++",
    "typescript":"typescript","ts":"typescript","markdown":"markdown","md":"markdown",
    "diff":"diff","dockerfile":"docker","plaintext":"plain text","text":"plain text",
}

# ---------------- API ----------------
def api(method, url, body=None, retries=6):
    for i in range(retries):
        try:
            r = requests.request(method, "https://api.notion.com" + url, headers=H, json=body, timeout=40)
        except requests.exceptions.RequestException as e:
            if i < retries - 1:
                time.sleep(2 ** i + 1); continue
            raise
        if r.status_code == 429:
            time.sleep(2 ** i + 1.5); continue
        if r.status_code >= 400:
            print(f"  [API {r.status_code}] {method} {url}\n    {r.text[:400]}")
            if i < retries - 1 and r.status_code in (500, 502, 503, 504):
                time.sleep(2 ** i + 1); continue
            return None
        return r.json()
    return None

def page_url(pid):
    return "https://www.notion.so/" + pid.replace("-", "")

# ---------------- 行内富文本 ----------------
def _text_obj(content, **kw):
    objs = []
    # 超长文本切分（保持注解）
    while content:
        chunk = content[:RICH_MAX]
        content = content[RICH_MAX:]
        o = {"type": "text", "text": {"content": chunk}}
        if kw.get("link"):
            o["text"]["link"] = {"url": kw["link"]}
        ann = {}
        if kw.get("bold"): ann["bold"] = True
        if kw.get("italic"): ann["italic"] = True
        if kw.get("code"): ann["code"] = True
        # 注：Notion 不允许在列表项等部分块的 rich_text 上使用 strike 注解，
        # 故删除线样式仅保留文本、不加注解，避免 400 校验失败。
        if kw.get("color"): ann["color"] = kw["color"]
        if ann: o["annotations"] = ann
        objs.append(o)
    return objs

_INLINE = re.compile(r'`([^`]+)`|\*\*(.+?)\*\*|~~(.+?)~~|\*(.+?)\*|_([^_]+)_|\[([^\]]+)\]\(([^)]+)\)')

def parse_inline(text):
    rich = []
    last = 0
    for m in _INLINE.finditer(text):
        plain = text[last:m.start()]
        if plain:
            rich += _text_obj(plain)
        if m.group(1) is not None:
            rich += _text_obj(m.group(1), code=True)
        elif m.group(2) is not None:
            rich += _text_obj(m.group(2), bold=True)
        elif m.group(3) is not None:
            rich += _text_obj(m.group(3), strike=True)
        elif m.group(4) is not None:
            rich += _text_obj(m.group(4), italic=True)
        elif m.group(5) is not None:
            rich += _text_obj(m.group(5), italic=True)
        elif m.group(6) is not None:
            url = (m.group(7) or '').strip()
            # 仅保留合法绝对 URL；相对路径（./ ../）、含空格/控制符等 → 丢弃链接但保留文本，
            # 避免 Notion 400 "Invalid URL for link" 导致整批失败。
            if re.match(r'^(https?://|mailto:|tel:)', url) and not re.search(r'[\s\x00-\x1f<>"\']', url):
                if re.search(r'[\u4e00-\u9fff]', url):
                    # 非 ASCII 字符 percent 编码（保留已有 %xx）
                    url = re.sub(r'[^\x00-\x7f]', lambda c: quote(c.group(0)), url)
                rich += _text_obj(m.group(6), link=url)
            else:
                rich += _text_obj(m.group(6))
        last = m.end()
    if last < len(text):
        rich += _text_obj(text[last:])
    return rich or [{"type": "text", "text": {"content": ""}}]

def split_rich(rich, maxlen=RICH_MAX):
    """把富文本列表按总字数切分为多段（每段 <= maxlen）。"""
    out, cur, cur_len = [], [], 0
    for o in rich:
        L = len(o["text"]["content"])
        if cur_len + L > maxlen and cur:
            out.append(cur); cur, cur_len = [], 0
        # 单对象超长已在 _text_obj 切分，这里直接追加
        cur.append(o); cur_len += L
    if cur:
        out.append(cur)
    return out or [[{"type": "text", "text": {"content": ""}}]]

# ---------------- block 构造 ----------------
def para_block(text):
    blocks = []
    for seg in split_rich(parse_inline(text)):
        blocks.append({"object": "block", "type": "paragraph",
                       "paragraph": {"rich_text": seg}})
    return blocks

def heading_block(level, text):
    lvl = min(max(level, 1), 3)
    t = f"heading_{lvl}"
    return [{"object": "block", "type": t, t: {"rich_text": parse_inline(text)}}]

def list_block(kind, text):
    t = "bulleted_list_item" if kind == "bulleted" else "numbered_list_item"
    blocks = []
    for seg in split_rich(parse_inline(text)):
        blocks.append({"object": "block", "type": t, t: {"rich_text": seg}})
    return blocks

def quote_block(text):
    return [{"object": "block", "type": "quote",
             "quote": {"rich_text": parse_inline(text)}}]

def code_block(code, lang):
    lang = CODE_LANG_MAP.get((lang or "").lower(), "plain text")
    blocks = []
    for i in range(0, len(code), RICH_MAX):
        blocks.append({"object": "block", "type": "code",
                        "code": {"language": lang,
                                 "rich_text": [{"type": "text", "text": {"content": code[i:i+RICH_MAX]}}]}})
    return blocks

def table_block(rows):
    """rows: list[list[str]]，首行为表头。"""
    if not rows:
        return []
    width = max(len(r) for r in rows)
    norm = [r + [""] * (width - len(r)) for r in rows]
    children = []
    for ri, row in enumerate(norm):
        cells = [{"type": "text", "text": {"content": c}} for c in row]
        children.append({"object": "block", "type": "table_row",
                          "table_row": {"cells": [[c] for c in cells]}})
    tbl = {"object": "block", "type": "table",
           "table": {"table_width": width, "has_column_header": True,
                     "has_row_header": False, "children": children}}
    return [tbl]

# ---------------- Markdown → blocks ----------------
def md_to_blocks(md):
    lines = md.split("\n")
    blocks = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        # 代码块
        m = re.match(r'^\s*```(\w*)\s*$', line)
        if m:
            lang = m.group(1)
            buf = []
            i += 1
            while i < n and not re.match(r'^\s*```\s*$', lines[i]):
                buf.append(lines[i]); i += 1
            i += 1  # 跳过结束 ```
            blocks += code_block("\n".join(buf), lang)
            continue
        # 分隔线
        if re.match(r'^\s*([-*_])(\s*\1){2,}\s*$', line):
            blocks.append({"object": "block", "type": "divider", "divider": {}})
            i += 1; continue
        # 标题
        m = re.match(r'^(#{1,6})\s+(.*)$', line)
        if m:
            blocks += heading_block(len(m.group(1)), m.group(2).strip())
            i += 1; continue
        # 表格
        if line.strip().startswith("|") and i + 1 < n and re.match(r'^\s*\|?[\s:|-]+\|?\s*$', lines[i+1]) and '-' in lines[i+1]:
            rows = [c.strip() for c in line.strip().strip("|").split("|")]
            # 跳过分隔行
            j = i + 2
            data = [rows]
            while j < n and lines[j].strip().startswith("|"):
                data.append([c.strip() for c in lines[j].strip().strip("|").split("|")])
                j += 1
            blocks += table_block(data)
            i = j; continue
        # 引用
        if line.lstrip().startswith(">"):
            buf = []
            while i < n and lines[i].lstrip().startswith(">"):
                buf.append(lines[i].lstrip()[1:].lstrip())
                i += 1
            blocks += quote_block("\n".join(buf))
            continue
        # 列表
        m = re.match(r'^\s*[-*+]\s+(.*)$', line)
        if m:
            buf = [m.group(1)]
            i += 1
            while i < n and re.match(r'^\s*[-*+]\s+', lines[i]):
                buf.append(re.match(r'^\s*[-*+]\s+(.*)$', lines[i]).group(1)); i += 1
            for item in buf:
                blocks += list_block("bulleted", item)
            continue
        m = re.match(r'^\s*\d+\.\s+(.*)$', line)
        if m:
            buf = [m.group(1)]
            i += 1
            while i < n and re.match(r'^\s*\d+\.\s+', lines[i]):
                buf.append(re.match(r'^\s*\d+\.\s+(.*)$', lines[i]).group(1)); i += 1
            for item in buf:
                blocks += list_block("numbered", item)
            continue
        # 空行
        if not line.strip():
            i += 1; continue
        # 段落（聚合连续普通行）
        buf = [line]
        i += 1
        while i < n and lines[i].strip() and \
              not re.match(r'^\s*```', lines[i]) and \
              not re.match(r'^(#{1,6})\s', lines[i]) and \
              not re.match(r'^\s*([-*_])(\s*\1){2,}\s*$', lines[i]) and \
              not lines[i].lstrip().startswith(">") and \
              not re.match(r'^\s*[-*+]\s+', lines[i]) and \
              not re.match(r'^\s*\d+\.\s+', lines[i]) and \
              not (lines[i].strip().startswith("|") and i+1 < n and '-' in lines[i+1] and lines[i+1].strip().startswith("|")):
            buf.append(lines[i]); i += 1
        blocks += para_block("  \n".join(buf))  # 保留换行
    return blocks

# ---------------- 页面管理 ----------------
def load_state():
    if os.path.exists(STATE_FILE):
        try:
            return json.load(open(STATE_FILE, encoding="utf-8"))
        except Exception:
            return {}
    return {}

def save_state(s):
    json.dump(s, open(STATE_FILE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

def page_exists(pid):
    if not pid:
        return False
    return api("GET", f"/v1/pages/{pid}") is not None

def clear_children(pid):
    # 分页删除子块
    while True:
        data = api("GET", f"/v1/blocks/{pid}/children?page_size=100")
        if not data or not data.get("results"):
            break
        for b in data["results"]:
            api("DELETE", f"/v1/blocks/{b['id']}")
        if not data.get("has_more"):
            break

def create_page(parent_type, parent_id, title):
    body = {"parent": {parent_type: parent_id},
            "properties": {"title": [{"type": "text", "text": {"content": title}}]}}
    return api("POST", "/v1/pages", body)

def append_blocks(page_id, blocks):
    # 每批 <=100，返回本次创建的块 id
    ids = []
    for s in range(0, len(blocks), 100):
        batch = blocks[s:s+100]
        resp = api("PATCH", f"/v1/blocks/{page_id}/children", {"children": batch})
        time.sleep(0.35)
        if resp and resp.get("results"):
            ids += [b["id"] for b in resp["results"] if b.get("id")]
    return ids

def main():
    force_parent = None
    if "--parent" in sys.argv:
        force_parent = sys.argv[sys.argv.index("--parent") + 1]
    with open(os.path.join(BUILD, "chapters.json"), encoding="utf-8") as f:
        chapters = json.load(f)
    order = {"0":0,"1":1,"2":2,"3":3,"4":4,"5":5,"6":6,"A":7}
    chapters.sort(key=lambda c: order.get(c["idx"], 99))

    state = load_state()
    old_parent = state.get("parent_id")

    # 父页：workspace 级页面无法经 API 归档，故复用同一父页（仅首次创建），避免重复顶层页。
    if force_parent:
        parent_id = force_parent
        print(f"[父页] 使用指定父页 {page_url(parent_id)}")
    elif page_exists(old_parent):
        parent_id = old_parent
        print(f"[父页] 复用已有父页 {page_url(parent_id)}")
    else:
        print("[父页] 创建顶层父页 ...")
        resp = create_page("workspace", True, PARENT_TITLE)
        if not resp or "id" not in resp:
            sr = api("POST", "/v1/search", {"query": "", "page_size": 5})
            cand = next((o["id"] for o in sr.get("results", []) if o.get("parent", {}).get("type") == "workspace"), None)
            if cand:
                print(f"[父页] workspace 创建受限，回退挂到已有页 {cand}")
                resp = create_page("page_id", cand, PARENT_TITLE)
        parent_id = resp["id"]
        print(f"[父页] {PARENT_TITLE}\n       {page_url(parent_id)}")

    # 各章节子页：归档上一版子页（子页可归档），再新建——避免重复页与逐块删除限流雪崩。
    child_links = []
    for ch in chapters:
        cfile = os.path.join(REPO, ch["file"])
        with open(cfile, encoding="utf-8") as f:
            md = f.read()
        blocks = md_to_blocks(md)
        old_pid = (state.get("chapters") or {}).get(ch["idx"])
        if page_exists(old_pid):
            api("PATCH", f"/v1/pages/{old_pid}", {"archived": True})
        resp = create_page("page_id", parent_id, f"第{ch['idx']}章 {ch['title']}")
        pid = resp["id"]
        append_blocks(pid, blocks)
        child_links.append((ch, pid))
        print(f"[章节] 第{ch['idx']}章 {ch['title']} ({len(blocks)} 块) -> {page_url(pid)}")

    # 父页导航
    nav = heading_block(2, "章节导航")
    nav.append({"object": "block", "type": "divider", "divider": {}})
    for ch, pid in child_links:
        link_rt = [{"type": "text", "text": {
            "content": f"第{ch['idx']}章 {ch['title']}（{ch['docs']} 篇）",
            "link": {"url": page_url(pid)}}}]
        nav.append({"object": "block", "type": "bulleted_list_item",
                     "bulleted_list_item": {"rich_text": link_rt}})
    append_blocks(parent_id, nav)

    # 保存状态
    state = {"parent_id": parent_id,
             "chapters": {ch["idx"]: pid for ch, pid in child_links},
             "synced_at": time.strftime("%Y-%m-%d %H:%M")}
    save_state(state)

    print("\n[完成] 同步完成")
    print(f"  父页：{page_url(parent_id)}")
    print(f"  状态文件：{STATE_FILE}")
    tot = sum(ch['docs'] for ch in chapters)
    print(f"  共 {len(chapters)} 个章节 / {tot} 篇文档")

if __name__ == "__main__":
    main()
