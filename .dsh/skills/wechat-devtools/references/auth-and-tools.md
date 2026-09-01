# wechat-devtools 登录授权 & 工具速查

## 登录授权流程（首次或登录过期时）

```bash
# 1. 检查状态（只读）
wechatide -c ide check_wechatide_status
# 返回 loginExpired / loginUser / versionRelation

# 2. 若需登录 → 触发扫码（返回 base64 二维码图片 + taskId）
wechatide -c ide login --type image
# 结果含 taskId: login_xxx, status: pending
```

**取二维码给用户扫**：`--type image` 返回 `content[].data`（base64 JPEG）。提取后写文件：
```bash
# 从返回 JSON 抽取 data（base64）→ 保存为 /tmp/wechat-login-qr.jpg → 展示给用户
python3 -c "import json,base64,sys; d=json.load(sys.stdin); img=[c['data'] for c in d['result']['content'] if c['type']=='image'][0]; open('/tmp/wechat-login-qr.jpg','wb').write(base64.b64decode(img))"
```

**授权轮询**：用户扫码后，Skill 会收到授权完成通知（`polling_task_result` 工具查 `taskId` 状态）；登录态自动保持，后续 `auto_preview` 无需再扫码。

## wechatide 工具入口

| 工具 | 用途 |
|------|------|
| `check_wechatide_status` | 检查登录/状态（只读） |
| `login --type image` | 触发扫码登录，返回二维码 |
| `open_project_window` | 打开项目窗口（报 PROJECT_* 错时用） |
| `auto_preview --project <path>` | **推送预览到微信**（首选） |
| `create_preview_qrcode --project <path> --qr-format image` | 生成二维码 |
| `upload --project <path> --upload-version X --desc Y` | 上传体验版 |

调用统一：`wechatide -c ide <tool> [flags]`（tool 在各 skill 分组下，如 previewer/auto_preview）。

## 关键路径
- **wechatide**：`/usr/local/bin/wechatide`（PATH 内）
- **项目**：`~/Desktop/One-News`（appid `wx1ccb4d171dd88162`）
- **云函数部署**：用 `cli cloud functions deploy`（wechatide 无此工具），`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
