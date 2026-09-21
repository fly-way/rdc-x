# RDC-X：个人电脑 MCP 网关

RDC-X 是面向个人使用的单机自托管 MCP 网关，可让 ChatGPT 在受控边界内使用本机文件、终端、桌面、文档、系统信息和 Unity Editor 能力。

在 RDC-X 的正常使用流程中，**OpenAI Secure MCP Tunnel 现在是必需项**。本机服务本身可以先启动，以便提供登录页；但 Secure MCP Tunnel 没达到 **Ready** 之前，Dashboard 不会解锁。

## Windows 日常使用

只保留一个面向用户的 Windows 启动脚本：

```text
Start-All.cmd
```

每次 Windows 开机后运行它。它会：

1. 检查 Node.js 22+；
2. 同步 npm 依赖；
3. 执行本机配置初始化/迁移；
4. 编译 TypeScript；
5. 重启 RDC-X，保证正在运行的后台和刚拉取/编译的代码一致；
6. 自动打开本机 **Secure Tunnel 登录页**。

登录页必须提供：

- **Tunnel ID**
- **Runtime API Key**

Tunnel ID 会保存在本机，并在以后运行时自动回填。Runtime API Key 输入框使用标准密码管理器自动填充语义，因此浏览器可以自行提示保存/自动填写。

RDC-X 同时会把 Runtime API Key 使用 Windows DPAPI 加密后保存在本机，供本机 Tunnel 生命周期操作使用；但是每次新的 RDC-X 进程由 `Start-All.cmd` 启动后，仍要求在登录页提供 Runtime API Key，只有验证并把 Secure MCP Tunnel 启动到 **Ready** 才能进入 Dashboard。

本机地址：

```text
http://127.0.0.1:47832
```

`Start-All.cmd` 会通过 URL fragment 携带本机管理密钥打开该页面，不需要手工复制，管理密钥也不会打印在控制台。

## Secure Tunnel 凭据

先安装 OpenAI 官方 `tunnel-client`。RDC-X 会按以下方式寻找：

```text
<项目目录>\tools\tunnel-client.exe
系统 PATH
TUNNEL_CLIENT_PATH 环境变量
```

Tunnel ID 保存在：

```text
.rdc\secure-tunnel.json
```

Windows 下 Runtime API Key 使用 **Windows DPAPI / CurrentUser** 保护，密文保存在：

```text
.rdc\secure-tunnel-key.dpapi
```

Dashboard API 不会把已经保存的 Runtime API Key 明文读回浏览器，RDC-X 日志也不会打印它。DPAPI 密文与保存它的 Windows 用户绑定。

## 强制连接流程

```text
Start-All.cmd
      |
Secure Tunnel 登录页
      |
Tunnel ID + Runtime API Key
      |
official tunnel-client
      |
OpenAI Secure MCP Tunnel  （必须 Ready）
      |
解锁 Dashboard
      |
ChatGPT <-> RDC-X <-> Windows
```

默认端口：

```text
127.0.0.1:47831   旧版 OAuth MCP（兼容）
127.0.0.1:47832   本机登录页 / Dashboard
127.0.0.1:47833   Secure MCP Tunnel 专用 MCP
127.0.0.1:47834   tunnel-client 健康检查与本地 UI
```

47833 只绑定 loopback，**不要转发到公网**。

## 每次关机后再次使用

开机后只需要运行：

```text
Start-All.cmd
```

浏览器会先进入 Secure Tunnel 登录页：

1. Tunnel ID 如果之前保存过，会自动回填；
2. Runtime API Key 需要本次启动提供，浏览器密码管理器可以帮你自动填充；
3. RDC-X 启动 `tunnel-client`；
4. 等待 Tunnel 到达 **Ready**；
5. Ready 后自动进入 Dashboard。

不需要重新创建 OpenAI Tunnel，也不需要重新创建 ChatGPT 工作区里的 RDC-X App。

## Dashboard

Dashboard 已调整成浅色商务后台风格：

- 左侧固定导航；
- 顶部本机/Tunnel 状态；
- 绿色 Secure Tunnel 状态横幅；
- 授权目录、待审批操作、终端会话概览；
- 最近审计；
- 当前文件/终端/桌面策略；
- Connection、Approvals、Terminal、Audit、Access Policy 等页面。

如果 Secure MCP Tunnel 在使用期间停止或失去 Ready，界面会重新回到 Secure Tunnel 登录门。

Connection 页面支持：

- 打开官方 tunnel-client UI；
- 在“逐次审批”和“本次 Tunnel 会话免审批”之间切换；
- 断开当前 Tunnel 并返回登录页，更换 Tunnel ID / Runtime API Key。

旧 OAuth 配对/授权只放在 Connection 页的高级兼容区域，不再作为默认工作流。

## ChatGPT 工作区侧

Secure MCP Tunnel 负责传输，但不会绕过 ChatGPT 工作区权限。

目标 ChatGPT 工作区仍然需要允许对应的自定义/开发者 MCP App，并让 App 使用同一个 Tunnel。如果当前成员没有创建或发布 App 的权限，需要工作区管理员或其他被授权人员完成一次部署。

ChatGPT 侧的 RDC-X App 通常只需要创建一次。Windows 重启不会要求重新创建 App 或 OpenAI Tunnel 资源。

## 本机审批策略

Secure Tunnel 请求仍然经过 RDC-X 的本机安全控制。

默认情况下，写文件、终端、桌面、系统进程、Unity 修改等操作可以要求本机审批。

Connection 页面可以临时启用：

```text
本次 Tunnel 会话免审批
```

该信任只保存在内存中，RDC-X 重启后自动恢复。

Access Policy 页面控制：

- 授权目录和 ro/rw；
- 文件写入审批；
- 终端命令；
- 任意非关键系统进程终止；
- 桌面截图、鼠标、键盘、剪贴板；
- 公网 HTTP/HTTPS 文本读取；
- 旧版 OAuth 回调域名。

**终端不是操作系统沙箱。** 批准的命令使用当前 Windows 用户权限。需要更强隔离时，应使用低权限专用 Windows 账号或虚拟机。

## 已实现能力

当前包含 60+ MCP 工具，主要包括：

- 目录/文件读取、写入、编辑、移动、软删除、图片、备份与恢复；
- 文件名与文本内容搜索；
- 受管理终端与进程会话；
- 系统信息与受控进程终止；
- PDF、XLSX、DOCX 读写与编辑；
- 带 SSRF/私网保护的公网 URL 读取；
- Windows 桌面截图、窗口聚焦、键盘、鼠标与剪贴板；
- Unity 项目发现、Console、Editor Bridge、Hierarchy、Scene、Selection、Components、Game View、Play Mode、GameObject、Transform 等；
- 审批结果查询与本地审计。

## 旧版公网 OAuth 接入

47831 的 OAuth MCP 入口仍保留，供高级兼容场景手工使用，但它不再属于 RDC-X 默认登录流程，也不能替代 Dashboard 的强制 Secure MCP Tunnel 登录门。

## 私有数据

`.rdc` 包含本机私有状态，例如：

- 本机管理密钥；
- OAuth 记录；
- 审计日志；
- backups / trash；
- Tunnel ID；
- DPAPI 加密后的 Runtime API Key。

该目录已经 gitignore，不要上传、分享或复制给其他用户。

## 开发与检查

维护操作直接使用 npm / Node：

```powershell
cd F:\rdc-x
npm.cmd run build
npm.cmd test
npm.cmd run doctor
node scripts\verify.mjs
```

## 参考

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI tunnel-client: https://github.com/openai/tunnel-client
- ChatGPT Developer mode / MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP Authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/server
