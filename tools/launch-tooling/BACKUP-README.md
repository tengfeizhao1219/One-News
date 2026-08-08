# 一页 One-News · 归档目录 tar 备份

> 任务来源：FS 协作机制 Review（2026-08-08）问题 4「环境韧性不足」
> 解决：每周日 02:00 自动把 `/workspace/One-News-archive/` 整个目录 tar 备份到本地+微云
> 原则：零第三方依赖、失败不阻塞、保留最近 4 份

## 脚本

**文件**：`scripts/backup-archive.sh`（约 70 行，无外部依赖）

**核心流程**：
1. 自检归档源是否存在
2. tar 打包（gzip 压缩）
3. 算 MD5 校验
4. 尝试上传到微云（如果装了 weiyun-cli）
5. 清理本地超过 4 份的旧备份
6. 输出摘要

## 安装步骤（owner 一次执行）

```bash
# 1. 复制脚本到归档目录同级
cp scripts/backup-archive.sh /workspace/backup-archive.sh
chmod +x /workspace/backup-archive.sh

# 2. 配 cron（每周日 02:00 跑）
crontab -e
# 追加这一行：
0 2 * * 0 /workspace/backup-archive.sh >> /workspace/backup.log 2>&1

# 3. （可选）第一次手动跑一次验证
/workspace/backup-archive.sh
```

## 验证清单

- [ ] 第一次手动跑输出「✅ 备份完成」
- [ ] `/tmp/one-news-backups/` 下有 `one-news-archive-YYYYMMDD-HHMMSS.tar.gz`
- [ ] 旁边有同名 `.md5` 校验文件
- [ ] 微云 `One-News/Weekly-Backup/` 目录下能看到文件
- [ ] 等一周后第二次跑成功，本地保留 2 份

## 恢复演练（季度做一次）

```bash
# 从本地恢复
cd /tmp/one-news-backups
md5 -c one-news-archive-20260808-020000.tar.gz.md5
tar -xzf one-news-archive-20260808-020000.tar.gz -C /tmp/restore-test/
ls /tmp/restore-test/One-News-archive/   # 确认能列出全部 250+ 文件
```

## 不做的事（避免过度工程）

- ❌ 不做增量备份（归档目录变化频率低，全量足够）
- ❌ 不做异地双备份（微云 + 本地够用，再加会让人忘记检查）
- ❌ 不做加密（归档内容无密钥，但若担心可加 `gpg -c` 加密层）
- ❌ 不做通知（owner 每周看一次本地 log 即可，不打扰）
