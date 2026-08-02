#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""一次性清理：归档父页下所有子页面（消除并发同步产生的重复子页），并返回数量。"""
import os, sys, json, time
import importlib.util

spec = importlib.util.spec_from_file_location("notion_sync", os.path.join(os.path.dirname(os.path.abspath(__file__)), "notion_sync.py"))
ns = importlib.util.module_from_spec(spec)
# 让 notion_sync 用当前进程的 NOTION_TOKEN 环境变量
spec.loader.exec_module(ns)

PARENT = "3b06b5eb-1dd8-81d9-8557-e95336541afb"
H = ns.H

def api(method, url, body=None):
    return ns.api(method, url, body)

# 列出父页所有子块（含已归档）
kids = []
start = None
while True:
    u = f"/v1/blocks/{PARENT}/children?page_size=100"
    if start:
        u += f"&start_cursor={start}"
    data = api("GET", u)
    if not data:
        break
    kids += data.get("results", [])
    if data.get("has_more") and data.get("next_cursor"):
        start = data["next_cursor"]
    else:
        break

child_pages = [b for b in kids if b.get("type") == "child_page"]
others = [b for b in kids if b.get("type") != "child_page"]
print(f"[清理] 父页子块总数={len(kids)}，其中 child_page={len(child_pages)}，其它(导航等)={len(others)}")

archived = 0
for b in child_pages:
    pid = b["id"]
    if b.get("archived"):
        print(f"  已归档跳过 {pid}")
        continue
    r = api("PATCH", f"/v1/pages/{pid}", {"archived": True})
    if r is not None:
        archived += 1
        print(f"  归档子页 {pid} 标题={b.get('child_page',{}).get('title','?')}")
    time.sleep(0.3)

print(f"[清理] 已归档 {archived} 个子页（重复/旧版）。")
print("[清理] 现在父页下变为空，可安全执行单一干净同步。")
