# RDC-X

RDC-X 是一个面向个人/私有环境的自托管 MCP 网关，用于让 ChatGPT 通过受控接口访问一台已授权的 Windows 电脑。

当前版本：**0.2.0**

推荐连接方式是 **OpenAI Secure MCP Tunnel**。RDC-X 的 MCP 服务只监听本机 loopback，由 OpenAI 官方 `tunnel-client` 主动建立到 OpenAI 的出站连接，不需要直接向公网暴露本机 MCP 端口。

## 主要功能

RDC-X 当前提供 60+ 个 MCP 工具，主要包括：

- 文件和目录：列出、读取、写入、编辑、移动、搜索、备份、恢复、软删除；
- 终端和受管理进程会话；
- Windows 桌面截图、窗口聚焦、鼠标、键盘、剪贴板；
- 系统信息和受控进程终止；
- PDF、DOCX、XLSX 的读取和编辑；
- 带私网/SSRF 防护的公网 HTTP/HTTPS 文本读取；
- Unity Editor：项目发现、Console、Hierarchy、Scene、Selection、Game View、Play Mode、GameObject、Transform、Component 等；
- 本机审批、审计日志和访问策略。

RDC-X 主要用于单台已授权电脑的个人使用，不包含账号系统、订阅、付费逻辑或遥测。

## 环境要求

推荐的 Windows 环境需要：

- Windows 10 或 Windows 11；
- Node.js **22 或更高版本**；
- Git；
- OpenAI 官方 `tunnel-client`；
- 一个 OpenAI Secure MCP Tunnel ID；
- 一个有权使用该 Tunnel 的 Runtime API Key；
- 一个已经配置 RDC-X 自定义/开发者 MCP App 的 ChatGPT 工作区。

RDC-X 会按下面顺序寻找 `tunnel-client`：

```text
TUNNEL_CLIENT_PATH 环境变量
<rdc-x目录>\tools\tunnel-client.exe
系统 PATH
```

Windows 下，如果本地文件缺失，`Start-All.cmd` 会自动从 OpenAI 官方 `openai/tunnel-client` GitHub Release 下载当前架构的最新正式版，校验 Release 提供的 SHA-256 后安装到 `<rdc-x目录>\tools\tunnel-client.exe`。

## 安装

克隆项目：

```powershell
git clone https://github.com/fly-way/rdc-x.git
cd rdc-x
```

Windows 日常只需要使用一个启动入口：

```text
Start-All.cmd
```

它会自动检查 Node.js、同步 npm 依赖、检查并在缺失时安装 OpenAI 官方 `tunnel-client`、初始化本机配置、编译 RDC-X、在需要时重启本机服务，并打开浏览器。

如果只想单独安装或修复 `tunnel-client`：

```powershell
node scripts\install-tunnel.mjs
```

不需要修改系统 PATH，也不需要全局安装；可执行文件和 Release 元数据都保存在已被 gitignore 的 `tools\` 目录。

## 第一次使用

运行：

```powershell
.\Start-All.cmd
```

浏览器会打开 Secure Tunnel 登录页。

需要填写：

- **Tunnel ID**：格式为 `tunnel_` + 32 位小写十六进制字符；
- **Runtime API Key**：有权限使用该 Tunnel 的 Runtime API Key。

然后点击：

```text
连接并进入 Dashboard
```

RDC-X 会启动官方 `tunnel-client`，并等待 OpenAI Secure MCP Tunnel 进入 **Ready** 状态。只有 Tunnel Ready 后才会进入控制台。

### Tunnel ID 和 Runtime API Key 如何保存

Tunnel ID 保存在：

```text
.rdc\secure-tunnel.json
```

Windows 下 Runtime API Key 会通过当前 Windows 用户的 DPAPI 保护，并以密文形式保存在：

```text
.rdc\secure-tunnel-key.dpapi
```

Dashboard API 不会把已经保存的 Runtime API Key 明文返回给浏览器，RDC-X 日志也不会打印它。

登录输入框同时使用标准浏览器密码管理器语义，因此 Edge/Chrome 等浏览器也可以提供自动填充。

## 日常启动

Windows 开机后运行：

```powershell
cd <rdc-x目录>
.\Start-All.cmd
```

浏览器会打开 Secure Tunnel 登录页。

如果 Tunnel ID 已经保存，会自动回填；输入或由浏览器自动填充 Runtime API Key，然后建立连接。

正常链路：

```text
Start-All.cmd
      |
RDC-X 本机服务
      |
Secure Tunnel 登录
      |
official tunnel-client
      |
OpenAI Secure MCP Tunnel
      |
ChatGPT 中的 RDC-X App
      |
本机 RDC-X 工具
```

## 本机端口

默认端口：

| 端口 | 用途 |
| --- | --- |
| `127.0.0.1:47831` | OAuth MCP 兼容入口 |
| `127.0.0.1:47832` | 本机登录页和 Dashboard |
| `127.0.0.1:47833` | Secure MCP Tunnel 的本机 MCP 目标 |
| `127.0.0.1:47834` | tunnel-client 本机健康检查/UI |

**47833 只绑定 loopback。不要直接暴露到公网。**

## Dashboard

本机 Dashboard 用于查看和管理：

- Secure MCP Tunnel 是否 Ready；
- Tunnel ID 和本机 MCP 目标；
- 等待审批的操作；
- 授权目录数量；
- 受管理终端会话；
- 最近审计事件；
- 文件、终端、桌面等访问策略；
- Tunnel 审批模式；
- 中英文界面。

界面支持：

```text
中文
English
```

语言偏好会保存在浏览器中。

如果 Secure MCP Tunnel 在运行过程中失去 Ready，网页会返回 Tunnel 登录页，而不是继续把电脑显示为可远程访问状态。

## 访问策略

RDC-X 通过本机策略明确限定 ChatGPT 可以使用的能力。

可以在 Dashboard 中配置：

- 只读/读写授权目录；
- 文件修改是否需要逐次本机审批；
- 终端命令；
- 系统进程控制；
- 桌面控制；
- 公网文本读取；
- OAuth 兼容场景的回调域名。

授权目录示例：

```text
rw | F:\UnityProject
ro | F:\Reference
```

如果授权目录列表为空，则禁止全部文件访问。

### 审批模式

Secure Tunnel 默认可以对受保护的修改操作使用逐次审批。

本机用户也可以临时开启“本次 Tunnel 会话免审批”。这个信任状态只保存在内存中，RDC-X 重启后会自动恢复。

### 终端安全

**终端不是操作系统沙箱。**

被批准的终端命令会使用当前运行 RDC-X 的 Windows 用户权限执行，因此可能访问该用户本身有权限访问的资源。

需要更强隔离时，建议使用专门的低权限 Windows 用户或虚拟机运行 RDC-X。

## ChatGPT 工作区配置

Secure MCP Tunnel 负责连接传输，但 ChatGPT 工作区权限仍然有效。

目标 ChatGPT 工作区需要创建并发布一个使用同一 Tunnel 的 RDC-X 自定义/开发者 MCP App。

如果当前成员没有创建或发布 App 的权限，需要由有权限的工作区管理员或其他被授权人员完成。

正常重启 Windows 后，不需要重新创建 ChatGPT App，也不需要重新创建 OpenAI Tunnel 资源。

## 更新 RDC-X

在项目目录执行：

```powershell
git pull
.\Start-All.cmd
```

`Start-All.cmd` 会重新编译并重启当前本机服务，保证浏览器前端和后台运行的是同一版本。

## `spawn tunnel-client ENOENT` 排错

这个错误表示 Windows 找不到 `tunnel-client` 可执行文件，并不是 Tunnel ID 或 Runtime API Key 校验失败。

在 RDC-X 目录执行：

```powershell
node scripts\install-tunnel.mjs
.\tools\tunnel-client.exe --version
```

确认版本可以输出后，重新运行 `Start-All.cmd` 再连接。如果你有意把 `tunnel-client.exe` 放在其他位置，可以只为 RDC-X 进程设置 `TUNNEL_CLIENT_PATH` 为该文件的完整路径。

## 检查与诊断

常用命令：

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run doctor
node scripts\verify.mjs
```

本机日志和运行状态存放在：

```text
.rdc
```

不要上传或分享该目录。这里可能包含本机管理密钥、审计数据、Tunnel 信息和 DPAPI 保护后的凭据材料。

## 项目结构

```text
src/                  TypeScript 服务端和 MCP 服务
public/               本机登录页和 Dashboard
scripts/              初始化、启动和诊断脚本
test/                 自动化测试
tools/                可选的 tunnel-client 放置目录
.rdc/                 本机私有运行状态（gitignore）
Start-All.cmd          Windows 主启动入口
```

## 文档

- [English README](README.md)
- [Secure MCP Tunnel 说明](SECURE-MCP-TUNNEL.md)

外部参考：

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI tunnel-client: https://github.com/openai/tunnel-client
- ChatGPT Developer mode / MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP: https://modelcontextprotocol.io/
