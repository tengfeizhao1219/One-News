---
name: wechat-devtools
description: 微信开发者工具 CLI 封装——登录检查、编译、上传（推送体验版/开发版到绑定微信号）、生成预览二维码、部署云函数。当用户说"编译并推送小程序""上传到微信""部署云函数""生成预览二维码""检查开发者工具登录"时使用。
whenToUse: 用户要求操作微信开发者工具（编译、上传、预览、云函数部署、登录检查），或需要把小程序代码推送到绑定的微信号验证时。
---

# 微信开发者工具操作（wechat-devtools）

通过微信开发者工具 CLI 完成小程序项目的编译、上传、预览与云函数部署。
所有命令基于 macOS 微信开发者工具 CLI（`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`）。

## 前置条件

1. **登录态**：CLI 复用微信开发者工具 IDE 的登录态。执行任何操作前先检查：
   ```bash
   "/Applications/wechatwebdevtools.app/Contents/MacOS/cli" islogin
   ```
   - 返回 `{"login":true}` → 可操作
   - 返回 `{"login":false}` → **需用户在微信开发者工具中扫码登录**，登录后再继续
2. **服务端口**：微信开发者工具需开启「设置 → 安全设置 → 服务端口」，否则 CLI 连接失败
3. **项目路径**：本项目为 `~/Desktop/One-News`（`project.config.json` 的 `appid: wx1ccb4d171dd88162`）

## 常用命令

### 1. 检查登录状态
```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" islogin
```

### 2. 编译 + 上传（推送到绑定微信号）
```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" upload \
  --project ~/Desktop/One-News \
  -v "<版本号>" \
  -d "<版本描述>"
```
- 该命令会先编译（语法检查），通过后上传为**开发版/体验版**
- `-v` 版本号建议递增（如 1.0.1、1.0.2）
- `-d` 描述本次改动要点（中文即可）
- **上传后**：需在[微信公众平台](https://mp.weixin.qq.com) → 版本管理 → 将新版本「选为体验版」，绑定的微信号才能在真机打开

### 3. 生成预览二维码（真机快速预览）
```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" preview \
  --project ~/Desktop/One-News \
  -i /tmp/preview-qr.png
```
- 生成的二维码图片路径可用 `-i` 指定
- 用微信扫码即可真机预览（无需设体验版）

### 4. 部署云函数
```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" cloud functions deploy \
  --env cloud1-1g9313w0bb791de0 \
  --names <函数名1> <函数名2> \
  --project ~/Desktop/One-News
```
- `--names` 支持多个函数名（空格分隔），如 `intelProcess intelDispatcher`
- **注意**：CLI 只传代码不装依赖——函数目录必须已含 `node_modules`（缺则先 `npm install`）
- 部署前建议先 `bash scripts/check_intel.sh` 跑门禁（AI 情报官模块强校验）

### 5. 云函数信息查询
```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" cloud functions info \
  --env cloud1-1g9313w0bb791de0 --names <函数名> --project ~/Desktop/One-News
```

## 执行流程（用户说"编译并推送"时）

1. `git pull --rebase origin main`（多 AI 并行，以线上为准）
2. 如有未提交改动需确认是否随包上传（CLI upload 打包当前工作区）
3. `islogin` 检查登录态（未登录 → 提示用户扫码）
4. 选版本号（查 git log 或问用户）+ 写描述
5. 执行 `upload`，确认输出 `✔ upload`
6. 汇报：上传成功、版本号、下一步（设为体验版）

## 注意事项

- **上传会打包当前工作区全部文件**（含未提交改动），上传前确认工作区状态
- **云函数部署**：函数目录需有 `node_modules`；部署成功后再验证线上生效（插测试数据触发）
- **定时触发器**：CLI 不管理触发器（只能在 IDE/控制台配置）；查询线上触发器用 MCP 的 `queryFunctions`
- 本技能不包含页面自动化（导航/点击/截图）——那是社区 MCP 包（`@yfme/weapp-dev-mcp` 等）的能力，需要时另行接入
