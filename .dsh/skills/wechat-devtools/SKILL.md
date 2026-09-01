---
name: wechat-devtools
description: 微信小程序「编译并推送到微信号」能力封装——auto_preview 直接把预览推送到开发者微信（无需二维码/后台设置）、create_preview_qrcode 生成二维码、upload 上传体验版、部署云函数、登录检查。当用户说"编译并推送小程序""推送预览到我的微信""上传到微信""部署云函数""生成预览二维码""检查开发者工具登录"时使用。主要用 wechatide skill 工具（比旧 cli preview/upload 更优：auto_preview 一键推送到微信）。
whenToUse: 用户要求操作微信开发者工具（编译、推送预览到微信、上传体验版、云函数部署、登录检查），或需要把小程序代码推到绑定微信号真机验证时。
version: 2.0.0
---

# 微信开发者工具操作（wechat-devtools）

One News 项目（`~/Desktop/One-News`，appid `wx1ccb4d171dd88162`）的编译、推送预览、上传、云函数部署能力。
**首选 `wechatide` skill 工具**（`auto_preview` 把预览直接推送到开发者微信，无需生成二维码/后台设体验版），比旧 `cli preview/upload` 更顺滑。

## 前置条件

1. **登录态**：操作前先检查，未登录则触发扫码登录（二维码给用户扫）。
   ```bash
   wechatide -c ide check_wechatide_status   # 只读，含 loginExpired/loginUser
   wechatide -c ide login --type image        # 触发扫码登录，返回二维码
   ```
   - 若返回 `login/pending` → 用 `login --type image` 取二维码给用户微信扫，扫完轮询授权
2. **项目窗口**：通常 `auto_preview` 无需先开窗（previewer skill 声明「无需先 open_project_window」）；若工具报 `PROJECT_*` 错误，先 `wechatide -c ide open_project_window --project <path>`
3. **项目路径**：`~/Desktop/One-News`（已配 `themeLocation: theme.json`，避免 800059）

## 核心能力（按需选）

### 1. 编译并推送预览到开发者微信（★★ 首选，用户最常用）
```bash
wechatide -c ide auto_preview --project ~/Desktop/One-News
```
- **直接推送到绑定微信号**，微信收到预览消息，点开即真机预览
- 可选定位到指定页面/携带参数：
  ```bash
  wechatide -c ide auto_preview --project ~/Desktop/One-News \
    --page-path pages/detail/detail --query id=xxx
  ```
- 成功返回 `{"ok":true,"result":{"success":true}}`

### 2. 生成预览二维码（分享/他人扫码）
```bash
wechatide -c ide create_preview_qrcode --project ~/Desktop/One-News --qr-format image
```
- `--qr-format`: window（开发者工具弹窗置顶）/ image（返回二维码图片）/ terminal / base64
- 生成的二维码图路径通过返回内容获取。

### 3. 上传体验版 / 开发版（用户明确要求时才走）
```bash
wechatide -c ide upload --project ~/Desktop/One-News --upload-version 1.0.1 --desc "改动说明"
```
- 上传后如需真机打开，配置体验成员后走「体验版」路径；**默认优先用 auto_preview**（无需上传即预览）

### 4. 部署云函数
```bash
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" cloud functions deploy \
  --env cloud1-1g9313w0bb791de0 \
  --names <函数名1> <函数名2> \
  --project ~/Desktop/One-News
```
- `--names` 支持多函数（空格分隔）；CLI 只传代码不装依赖——函数目录须已有 `node_modules`
- 部署前建议 `bash scripts/check_intel.sh` 跑门禁（AI 情报官强校验）

## 失败速查

| 情况 | 处理 |
|------|------|
| `themeLocation = theme.json 不存在`(800059) | 已修复 project.config.json；确认 `themeLocation: theme.json` 存在 |
| `login/pending` | `wechatide -c ide login --type image` 取二维码 → 用户微信扫 → 等授权 |
| `PROJECT_*` / `APPID_ERROR` | `wechatide -c ide open_project_window --project <path>` 开窗 |
| push 超时（git） | 用 `bash scripts/git_push.sh`（含退避+频率保护），勿裸 `git push` |
| 用户拒绝上传 | 不自动重试 upload；问用户是否重试 |

## 注意
- **首选 auto_preview**（直接推微信），upload 仅在用户明确要"上传体验版/开发版"时用
- 改 wxss/wxml 后 auto_preview 会自动编译生效，无需先手动编译
- 云函数部署用 `cli cloud functions deploy`（`wechatide` 无云函数部署工具）；依赖缺失先切到函数目录 `npm install`
