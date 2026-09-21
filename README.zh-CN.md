# RDC-X：个人电脑 MCP 接口

这是独立实现的个人版工具，不依赖 Remote Desktop Commander 的运行服务，不含会员、计费、遥测或付费墙。
当前版本为 0.2.0。采用 Node.js + TypeScript + 官方 MCP SDK，提供中文本机控制面板。

## 日常使用

- 双击 `Start.cmd`：初始化私有配置、编译、启动服务并打开控制面板。
- 双击 `Dashboard.cmd`：打开已经运行的控制面板，无需复制管理密钥。
- 双击 `Stop.cmd`：停止本服务及它创建的终端会话，不停止其他程序。
- 双击 `Check.cmd`：执行项目检查。详细测试命令见后文。
- 双击 `Start-Tunnel.cmd`：主动开启临时 HTTPS 通道；本机已准备好便携版 cloudflared。

初始管理地址：`http://127.0.0.1:47832`。
初始 MCP 地址：`http://127.0.0.1:47831/mcp`，所有工具请求都需要 OAuth 访问令牌。
直接打开管理地址会要求密钥；使用 `Dashboard.cmd` 可以安全地在本机打开。
管理密钥保存在 `.rdc/admin-token.txt`，不要发送给 ChatGPT 或其他人。

## 默认权限

只授权 `F:\rdc_x\workspace`，默认文件修改逐次审批；终端、任意系统进程终止、桌面控制和公网 URL 读取默认关闭。每个已授权 OAuth 会话都可在本机面板独立切换为“本次会话免审批”，该状态仅保存在内存，服务重启、暂停访问或撤销授权后失效。
要操作其他项目，在控制面板“访问策略”中添加已存在的目录，例如：

```text
rw | F:\rdc_x\workspace
rw | F:\UnityProject
ro | F:\Reference
```

`rw` 为读写，`ro` 为只读。不存在的目录不能保存。删除所有授权目录会禁止全部文件访问。

## 接入 ChatGPT

ChatGPT 网页端不能直接访问你电脑的 localhost，需要可达的远程 MCP 通道。
本项目提供临时 HTTPS 隧道脚本，也可以使用你自己的固定 HTTPS 反向代理。
本机已下载并校验便携版 `tools\cloudflared.exe`，无需全局安装。
重新安装或迁移项目时，可双击 `Install-Tunnel.cmd`；它会下载官方版本、校验 SHA-256，并且不会开启隧道。
也可以自行运行：`winget install --id Cloudflare.cloudflared --exact`。
也可把官方 Windows 可执行文件放到 `tools\cloudflared.exe`，无需全局安装。
随后双击 `Start-Tunnel.cmd`。脚本只转发 47831，不转发管理端口 47832。
复制窗口显示的 `https://实际生成的域名/mcp`，不要填写 localhost，也不要填写管理面板地址。
在 ChatGPT 的设置或工作区设置中启用开发者模式，然后在 Apps 中创建自定义应用。
名称填 RDC-X，MCP URL 填刚才的 HTTPS 地址，认证选择 OAuth；支持动态客户端注册。
如果界面强制要求预配置客户端 ID/secret，不要把本机管理密钥填进去，需要先注册对应 OAuth 客户端。
授权页面出现验证码后，在本机面板“连接授权”中核对相同验证码、回调地址和权限，再批准。
返回授权页面完成跳转，等待工具扫描结束，然后创建应用并在对话中选择它。
使用写入工具时，ChatGPT 会获得 requestId；本机批准后它应查询 get_request_result，不应重复提交原操作。

临时域名每次开启可能改变；地址改变会撤销旧授权，需要重新连接。
Quick Tunnel 是测试用途，不提供生产级可用性保证；长期使用可配置固定域名和隧道。
OpenAI 官方还提供 Secure MCP Tunnel 方案，本项目未自动配置它所需的工作区和凭据。
本软件没有计费逻辑，但 ChatGPT 套餐、工作区权限、域名及第三方服务费用并不由本项目控制。
本次只完成了本机安装、运行和 SDK 联调；没有替你在 ChatGPT 账户中创建应用，也没有开启公网隧道。

## 重要安全边界

终端不是操作系统沙箱：批准的命令以当前 Windows 用户权限运行，可以访问白名单外的文件和网络。
需要时在本机面板开启终端，并选择“逐次审批”或针对某个 OAuth 授权启用“本次会话免审批”；需要强隔离时使用低权限专用账户或虚拟机。
“本次会话免审批”会让该授权会话的文件修改、终端、系统进程、桌面和 Unity 修改直接执行，直到会话信任被清除，因此只应在你主动发起且持续观察的会话中启用。不要批准非自己发起的配对或操作。
文件接口会拒绝目录穿越、符号链接/junction、硬链接、Windows 设备路径、ADS，以及常见凭据路径。
程序自身、配置和密钥不能通过文件工具读取或修改；修改白名单和批准操作仅在本机控制面板完成。
这些应用层检查不是抵抗本机恶意进程的操作系统安全边界，也不是经过第三方审计的安全产品。

## 已实现与范围

当前提供 60+ 个 MCP 工具，覆盖设备状态、目录/文件、图片、搜索、终端、系统信息与进程、Office/PDF、桌面控制、Unity Editor 专用桥接、审批结果与审计记录。
文档层支持 PDF 文本读取、创建、删页与合并；XLSX 工作表/范围读取、创建与单元格范围编辑；DOCX 文本读取、创建与精确文本替换（编辑会生成备份）。
公网 URL 读取默认关闭；开启后仅允许有界的 HTTP/HTTPS 文本响应，并阻止 localhost、私网地址、URL 凭据和重定向到私网的请求。
桌面层支持主屏截图、窗口列表/聚焦、SendKeys、文字输入、鼠标移动/单击/双击及剪贴板读写；剪贴板读取也作为审批门控操作。
Unity 层支持项目识别、Editor.log、安装本地 Editor Bridge、场景/Hierarchy/Selection/Components、Play Mode、打开/保存场景、菜单命令、Game View 截图，以及 GameObject 创建/删除/启停、Transform、选择与添加 Component；修改操作支持 Unity Undo。
搜索采用字面子串匹配，不是正则表达式或 glob。终端使用管道，不是完整的交互式 PTY。删除操作保留恢复副本，不能递归删除目录；移动仅支持文件且不能覆盖已有目标。
当前仍是单实例/单设备服务；多设备统一中转尚未实现。它是自托管远程 MCP 应用，不是浏览器扩展，也不需要上架公共应用商店。

## 项目目录与检查

`src` 为 TypeScript 后端；`public` 为中文控制面板；`scripts` 为启动与维护脚本；`test` 为自动化测试。
`.rdc/config.json` 保存策略；`.rdc/audit.jsonl` 保存审计记录；`.rdc/server.log` 保存运行日志。
`.rdc/backups` 保存写入前备份；`.rdc/trash` 保存删除恢复副本。需要恢复时由本机用户手动复制。
`.rdc` 包含私有数据，不要上传代码仓库、分享或拷贝给其他用户。

```powershell
cd F:\rdc_x
npm.cmd run build
npm.cmd test
npm.cmd run doctor
```

参考：OpenAI 的 Developer mode and MCP apps in ChatGPT、MCP Authorization 规范、Cloudflare Quick Tunnels 官方文档。更详细的架构和资料链接见 README.md。

最终本机验证报告见 `VERIFICATION.txt`，自动化测试详情见 `TEST-REPORT.txt`。
运行 `node scripts/verify.mjs` 可重新生成这两份报告；健康检查要求服务已启动。
