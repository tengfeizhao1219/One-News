#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
setup_github_dns.py — 一键修复沙箱到 GitHub 的 DNS 污染

问题：沙箱默认 DNS（腾讯 183.60.x.x）把 github.com 解析到内部代理
      198.18.0.x，导致 git/curl 访问 GitHub 时 TLS 握手失败
      （gnutls_handshake() failed）。

修复：启动本地 dnsmasq，将 github 相关域名静态指向真实 IP，并把
      本机 /etc/resolv.conf 指向 127.0.0.1，使所有 git/curl 请求
      走到真实 GitHub。

用法：
    sudo python3 setup_github_dns.py

幂等：重复运行安全（会先清理旧实例与旧配置）。
"""

import os
import sys
import shutil
import subprocess
import signal

DNSMASQ_BIN = "/usr/sbin/dnsmasq"
RESOLV_CONF = "/etc/resolv.conf"
RESOLV_BACKUP = "/etc/resolv.conf.bak.githubfix"
DNSMASQ_CONF = "/etc/dnsmasq.d/github-fix.conf"
PID_FILE = "/run/dnsmasq-githubfix.pid"

# GitHub 真实 IP（已验证可直连并返回 HTTP 200）。
# 如该 IP 失效，可换成同段其他 GitHub IP（20.205.243.0/24 等）。
GITHUB_IP = "20.205.243.166"

# 需要静态解析的 GitHub 相关域名
GITHUB_DOMAINS = [
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "codeload.github.com",
    "gist.github.com",
    "avatars.githubusercontent.com",
    "githubusercontent.com",
]


def log(msg):
    print(f"[setup_github_dns] {msg}")


def run(cmd, check=True):
    log(f"$ {' '.join(cmd)}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.stdout.strip():
        print(r.stdout.strip())
    if r.returncode != 0 and check:
        if r.stderr.strip():
            print(r.stderr.strip(), file=sys.stderr)
        sys.exit(r.returncode)
    return r


def stop_existing():
    """停掉已存在的本脚本启动的 dnsmasq 实例。"""
    if os.path.exists(PID_FILE):
        try:
            with open(PID_FILE) as f:
                pid = int(f.read().strip())
            os.kill(pid, signal.SIGTERM)
            log(f"已停止旧 dnsmasq 实例 (pid={pid})")
        except Exception as e:
            log(f"停止旧实例失败（可能已退出）: {e}")
        try:
            os.remove(PID_FILE)
        except OSError:
            pass
    # 兜底：按端口查
    if shutil.which("fuser"):
        subprocess.run(["fuser", "-k", "53/udp"], capture_output=True, text=True)


def write_config():
    os.makedirs(os.path.dirname(DNSMASQ_CONF), exist_ok=True)
    lines = [
        "# 自动生成 by setup_github_dns.py — 修复 GitHub DNS 污染",
        "port=53",
        "listen-address=127.0.0.1",
        "bind-interfaces",
        "no-resolv",
        "no-hosts",
        "cache-size=1000",
    ]
    # 保留系统真实上游（腾讯 DNS），仅对 github 域名做静态覆盖
    lines.append("server=183.60.83.19")
    lines.append("server=183.60.82.98")
    for d in GITHUB_DOMAINS:
        lines.append(f"address=/{d}/{GITHUB_IP}")
    with open(DNSMASQ_CONF, "w") as f:
        f.write("\n".join(lines) + "\n")
    log(f"已写入 dnsmasq 配置: {DNSMASQ_CONF}")


def start_dnsmasq():
    run([DNSMASQ_BIN, "--conf-file=" + DNSMASQ_CONF, "--pid-file=" + PID_FILE])
    log("dnsmasq 已启动")


def patch_resolv():
    if not os.path.exists(RESOLV_BACKUP):
        shutil.copy2(RESOLV_CONF, RESOLV_BACKUP)
        log(f"已备份原 resolv.conf -> {RESOLV_BACKUP}")
    else:
        log(f"resolv.conf 备份已存在: {RESOLV_BACKUP}")
    with open(RESOLV_CONF, "w") as f:
        f.write("# 由 setup_github_dns.py 接管（GitHub DNS 修复）\n")
        f.write("nameserver 127.0.0.1\n")
    log(f"已将 {RESOLV_CONF} 指向 127.0.0.1")


def verify():
    log("验证解析结果：")
    out = subprocess.run(["getent", "hosts", "github.com"],
                         capture_output=True, text=True)
    print(out.stdout.strip() or "(空)")
    if GITHUB_IP in out.stdout:
        log(f"✅ github.com 已解析到真实 IP {GITHUB_IP}")
    else:
        log("⚠️ github.com 未解析到预期 IP，请检查 dnsmasq 状态")
    # curl 实测
    r = subprocess.run(
        ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
         "--connect-timeout", "8", "https://github.com"],
        capture_output=True, text=True)
    code = (r.stdout or "").strip()
    log(f"curl https://github.com -> HTTP {code}")
    if code == "200":
        log("✅ GitHub 访问正常，可以推送了")
    else:
        log("⚠️ GitHub 仍不可达，请人工排查网络")


def main():
    if os.geteuid() != 0:
        log("需要 root 权限，请使用 sudo 运行")
        sys.exit(1)
    if not os.path.exists(DNSMASQ_BIN):
        log(f"未找到 dnsmasq（{DNSMASQ_BIN}），请先: apt-get install -y dnsmasq-base")
        sys.exit(1)

    log("开始修复 GitHub DNS 污染 ...")
    stop_existing()
    write_config()
    start_dnsmasq()
    patch_resolv()
    verify()
    log("完成。如需还原: 恢复 /etc/resolv.conf.bak.githubfix 并 kill dnsmasq")


if __name__ == "__main__":
    main()
