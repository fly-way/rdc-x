# RDC-X：个人电脑 MCP 网关

RDC-X 是一个面向个人使用的单机自托管 MCP 网关，不依赖 Remote Desktop Commander 运行服务，也不包含账号、会员、计费、遥测或付费墙。

当前推荐的远程连接方式是 **OpenAI Secure MCP Tunnel**：RDC-X 只在本机 loopback 上提供 Tunnel 专用 MCP 入口，由官方 `tunnel-client` 主动向 OpenAI 建立出站 HTTPS 连接。

## Windows 日常使用

现在只保留一个面向用户的 Windows 启动脚本：

```text
Start-All.cmd
```

每次 Windows 开机后双击它即可。它会自动：

1. 检查 Node.js 22+；
2. 同步 npm 依赖；
3. 执行本机配置初始化与迁移；
4. 编译 TypeScript；
5. 如果 RDC-X 尚未运行，则在后台启动它；
6. 自动打开本机控制面板的“连接授权”页面；
7. 如果之前已经保存 Tunnel ID 与 Runtime API Key，则自动尝试恢复 Secure MCP Tunnel。

旧的 `Start.cmd`、`Stop.cmd`、`Dashboard.cmd`、`Start-Secure-Tunnel.cmd`、`Start-Tunnel.cmd`、`Install-Tunnel.cmd`、`Check.cmd` 已移除。

停止 RDC-X、启动/停止 Secure Tunnel、保存 Tunnel 凭据、审批操作和修改访问策略，都在本机 Dashboard 中完成。

本机 Dashboard：

```text
http://127.0.0.1:47832
```

`Start-All.cmd` 会自动携带本地管理密钥打开它，不需要手工复制管理密钥。

## 第一次配置 Secure MCP Tunnel

先安装 OpenAI 官方 `tunnel-client`。RDC-X 会按以下方式寻找：

```text
<项目目录>\tools\tunnel-client.exe
系统 PATH
TUNNEL_CLIENT_PATH 环境变量
```

然后双击：

```text
Start-All.cmd
```

浏览器会直接打开“连接授权”页面。在 **OpenAI Secure MCP Tunnel** 区域填写：

- **Tunnel ID**：格式必须是 `tunnel_` + 32 位小写十六进制字符；
- **Runtime API Key**：有权限使用该 Tunnel 的 Runtime API Key。

点击 **保存并启动 Tunnel**。

### Tunnel ID 如何保存

Tunnel ID 会以普通配置数据保存在：

```text
.rdc\secure-tunnel.json
```

以后不需要重复输入。

### Runtime API Key 如何保存

Windows 下，Runtime API Key 不交给浏览器记忆，而是采用更安全的方式：

- 使用 **Windows DPAPI / CurrentUser** 加密；
- 密文保存在：
  ```text
  .rdc\secure-tunnel-key.dpapi
  ```
- Dashboard API 不会把明文 Key 再返回给浏览器；
- RDC-X 日志不会打印明文 Runtime API Key；
- 只有保存该 Key 的 Windows 用户上下文才能正常解密使用。

因此第一次配置成功后，以后重启电脑通常只需要：

```text
Start-All.cmd
```

RDC-X 会自动读取保存的 Tunnel ID，使用当前 Windows 用户的 DPAPI 解密 Runtime API Key，并尝试自动启动 `tunnel-client`。

如果不希望继续保存 Key，可以在“连接授权”页面点击：

```text
删除已保存 Runtime API Key
```

## 本机端口

默认监听：

```text
127.0.0.1:47831   旧版 OAuth MCP
127.0.0.1:47832   RDC-X 本地 Dashboard
127.0.0.1:47833   Secure MCP Tunnel 专用 MCP
127.0.0.1:47834   tunnel-client 健康检查与本地 UI
```

推荐链路：

```text
ChatGPT
   |
OpenAI Secure MCP Tunnel
   |
official tunnel-client
   |
127.0.0.1:47833/mcp
   |
RDC-X
   |
Windows / Files / Desktop / Unity
```

47833 是专门给本机 `tunnel-client` 使用的无 OAuth 入口，只绑定 loopback。**不要把 47833 转发到公网。**

## 每次关机后再次使用

如果第一次配置已经完成，开机后只需：

```text
双击 Start-All.cmd
```

正常情况下：

1. RDC-X 自动启动；
2. 浏览器打开本机 Dashboard；
3. 已保存的 Tunnel ID 自动加载；
4. Runtime API Key 由 Windows DPAPI 解密；
5. `tunnel-client` 自动启动；
6. Dashboard 中 Tunnel 状态变为 **Ready / 可用**。

不需要重新创建 Tunnel，也不需要重新创建 ChatGPT 里的 RDC-X App。

## ChatGPT 工作区侧

Secure MCP Tunnel 只负责传输，不会绕过 ChatGPT 工作区权限。

目标 ChatGPT 工作区仍需允许相应的自定义/开发者 MCP App，并让这个 App 关联同一个 Tunnel。若当前成员没有创建或发布 App 的权限，需要由工作区管理员或其他被授权人员完成一次部署。

ChatGPT 端的 RDC-X App 创建并发布后，Windows 重启不会影响 App 本身；只要本机再次运行 `Start-All.cmd` 并恢复 Tunnel 即可。

## 本机审批策略

Secure Tunnel 请求仍然经过 RDC-X 的安全控制。

默认情况下，写文件、终端、桌面、系统进程和 Unity 修改等操作可以要求本机审批。

“连接授权”页面可以把 Secure Tunnel 临时切换成：

```text
本次 Tunnel 会话免审批
```

该信任只保存在内存中。RDC-X 重启、恢复逐次审批或相关状态被清理后会失效。

“访问策略”页面控制：

- 授权目录与 ro/rw；
- 文件写入审批；
- 终端命令；
- 任意非关键系统进程终止；
- 桌面截图、鼠标、键盘、剪贴板；
- 公网 HTTP/HTTPS 文本读取；
- 旧版 OAuth 回调域名。

**终端不是操作系统沙箱。** 批准的命令以当前 Windows 用户权限运行，能够访问该用户拥有权限的资源。需要更强隔离时，应使用低权限专用 Windows 账号或虚拟机。

## 已实现能力

当前包含 60+ MCP 工具，主要包括：

- 目录/文件读取、写入、编辑、移动、软删除、图片、备份与恢复；
- 文件名与文本内容搜索；
- 受管理终端与进程会话、命令策略；
- 系统信息与受控进程终止；
- PDF、XLSX、DOCX 读写与编辑；
- 带 SSRF/私网保护的公网 URL 读取；
- Windows 桌面截图、窗口聚焦、键盘、鼠标与剪贴板；
- Unity 项目发现、Console、Editor Bridge、Hierarchy、Scene、Selection、Components、Game View、Play Mode、GameObject、Transform 等；
- 审批结果查询与本地审计。

## 旧版公网 OAuth 接入

47831 的 OAuth MCP 入口仍保留，供高级或兼容场景手工使用。

项目不再为旧 Cloudflare Quick Tunnel 流程提供单独的 Windows `.cmd` 文件。开发者如果确实需要旧流程，底层 Node 维护脚本仍可手工调用，但 README 默认流程只推荐 Secure MCP Tunnel。

## 私有数据

`.rdc` 目录包含本机私有状态，例如：

- 管理密钥；
- OAuth 记录；
- 审计日志；
- backups / trash；
- Tunnel ID；
- DPAPI 加密后的 Runtime API Key。

该目录已加入 gitignore，不要上传、分享或复制给其他用户。

即使 Runtime API Key 已经 DPAPI 加密，`.rdc` 仍应按敏感数据目录处理。

## 开发与检查

不再额外提供 Check/Stop 等 `.cmd` 文件，维护操作直接使用 npm / Node：

```powershell
cd F:\rdc-x
npm.cmd run build
npm.cmd test
npm.cmd run doctor
node scripts\verify.mjs
```

需要停止服务时，可以直接在 Dashboard 的“连接授权”页面点击：

```text
停止 RDC-X 与 Tunnel
```

## 参考

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI tunnel-client: https://github.com/openai/tunnel-client
- ChatGPT Developer mode / MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP Authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/server
