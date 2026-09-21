'use strict';

const $ = id => document.getElementById(id);
const hash = new URLSearchParams(location.hash.slice(1));
let key = hash.get('key') || sessionStorage.getItem('rdcx-key') || '';
history.replaceState(null, '', location.pathname);

let snapshot;
let busy = false;
let loadedSettings = false;
let lastLists = '';
let currentView = 'overview';
let locale = localStorage.getItem('rdcx-lang') || (navigator.language?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en');

const messages = {
  'zh-CN': {
    'brand.gateway':'PERSONAL DESKTOP GATEWAY','brand.secureAccess':'SECURE DESKTOP ACCESS','brand.secureDesktop':'Secure Desktop',
    'common.continue':'继续','common.show':'显示','common.hide':'隐藏','common.resume':'恢复访问','common.pause':'暂停','common.viewAll':'查看全部 →',
    'common.enabled':'已启用','common.disabled':'已关闭','common.allowed':'允许','common.approvalRequired':'需要审批','common.perAction':'逐次审批','common.sessionTrusted':'本次会话免审批','common.saved':'已保存',
    'unlock.kicker':'LOCAL ADMIN ACCESS','unlock.title':'打开本机控制台','unlock.hint':'请从 <code>Start-All.cmd</code> 打开此页面；如果你是手动打开，也可以输入本机管理密钥。','unlock.keyLabel':'本机管理密钥','unlock.keyPlaceholder':'输入本机管理密钥','unlock.note':'管理密钥只用于 127.0.0.1 本机控制，不要发送给 ChatGPT。',
    'gate.visualTitle':'安全连接<br>你的电脑。','gate.visualBody':'RDC-X 通过 OpenAI Secure MCP Tunnel 将 ChatGPT 安全连接到这台电脑。Tunnel 成功就绪后才能进入 Dashboard。','gate.privateTitle':'PRIVATE BY DEFAULT','gate.privateBody':'仅本机回环 · 凭据本地处理 · 人工掌控',
    'gate.title':'连接 Secure Tunnel','gate.intro':'输入 Tunnel ID 与 Runtime API Key。连接达到 <b>Ready</b> 后，RDC-X 才会解锁 Dashboard。','gate.tunnelId':'Tunnel ID','gate.runtimeKey':'Runtime API Key','gate.keyPlaceholder':'输入 Runtime API Key',
    'gate.credentialTitle':'Tunnel ID 会保存在本机','gate.credentialBody':'Runtime API Key 会使用当前 Windows 用户的 DPAPI 加密保存；浏览器也可以自行提供密码自动填充。','gate.submit':'连接并进入 Dashboard','gate.waiting':'等待凭据','gate.help1':'首次使用需要 OpenAI Platform 创建的 Tunnel ID 和 Runtime API Key。','gate.help2':'RDC-X 不会把 Runtime API Key 打印到日志。',
    'gate.running':'Tunnel 已在运行；本次 Start-All 仍需验证凭据后才能进入 Dashboard。','gate.live':'tunnel-client 已启动，正在等待 OpenAI Control Plane Ready。','gate.savedKey':'Tunnel ID 已记录；请输入 Runtime API Key 以解锁本次 Dashboard。','gate.connecting':'正在启动 tunnel-client，并等待 OpenAI Secure MCP Tunnel Ready…','gate.connected':'Tunnel Ready，正在进入 Dashboard…','gate.badTunnelId':'Tunnel ID 格式必须是 tunnel_ + 32 位小写十六进制字符。','gate.keyRequired':'本次启动必须输入 Runtime API Key。',
    'nav.overview':'概览','nav.approvals':'操作审批','nav.connection':'连接','nav.sessions':'终端会话','nav.audit':'审计日志','nav.policy':'访问策略','sidebar.localService':'本机服务',
    'status.tunnelReady':'Tunnel 已就绪','status.thisComputer':'这台电脑','status.ready':'就绪','status.live':'在线','status.offline':'离线',
    'overview.pausedTitle':'远程访问已暂停','overview.pausedBody':'恢复后 ChatGPT 才能调用 RDC-X 工具。','overview.activeTitle':'安全访问已启用','overview.activeBody':'OpenAI Secure MCP Tunnel 已就绪，这台电脑可以接受 ChatGPT 的 RDC-X 工具调用。',
    'overview.tunnelUi':'Tunnel UI','overview.approval':'审批','overview.trusted':'免审批','overview.welcome':'欢迎使用 RDC-X','overview.subtitle':'本机策略决定 ChatGPT 能访问哪些目录、终端与桌面能力。',
    'overview.authorizedDirs':'授权目录','overview.authorizedDirsHint':'文件访问边界','overview.awaitingApproval':'等待审批','overview.awaitingApprovalHint':'需要本机确认的操作','overview.terminalSessions':'终端会话','overview.terminalEnabled':'终端已启用','overview.terminalDisabled':'终端已关闭',
    'overview.recentActivity':'最近活动','overview.recentActivityHint':'最新本机审计事件','overview.accessSnapshot':'访问概览','overview.accessSnapshotHint':'当前高层访问策略',
    'policy.fileWrites':'文件写入','policy.terminal':'终端','policy.desktop':'桌面控制','policy.approvalMode':'审批模式',
    'approvals.title':'操作审批','approvals.subtitle':'核对并批准由 ChatGPT 发起的受控操作。','approvals.empty':'当前没有需要本机批准的操作。','approvals.details':'查看完整参数','approvals.approve':'批准并执行','approvals.reject':'拒绝','approvals.result':'执行结果','approvals.confirmProcess':'终端/进程操作拥有当前 Windows 用户权限。\n\n确定执行？',
    'connection.title':'连接','connection.subtitle':'Secure MCP Tunnel 是 RDC-X 的必需远程连接。','connection.loopbackHint':'只有 loopback MCP 目标会暴露给 tunnel-client。','connection.localTarget':'本机 MCP 目标','connection.keyStored':'已使用 Windows DPAPI 保存','connection.keyMissing':'未保存','connection.openTunnelUi':'打开 tunnel-client UI','connection.trustSession':'本次 Tunnel 会话免审批','connection.restoreApproval':'恢复逐次审批','connection.changeCredentials':'更换 Tunnel 凭据',
    'connection.legacyTitle':'Legacy OAuth 兼容','connection.legacyBody':'47831 OAuth MCP 接口仍保留用于高级兼容场景，但不是 RDC-X 的默认连接方式。','connection.pendingPairings':'待处理 OAuth 配对','connection.authorizations':'OAuth 授权','connection.revokeOAuth':'撤销全部 OAuth 授权','connection.clearOAuth':'清空 OAuth 客户端注册','connection.noPairings':'没有待处理的 Legacy OAuth 配对。','connection.noAuthorizations':'没有 Legacy OAuth 授权。',
    'connection.pairApprove':'验证码一致，允许连接','connection.trustConfirm':'开启后，Secure MCP Tunnel 的文件修改、终端、系统进程、桌面和 Unity 修改可直接执行，直到服务重启或恢复逐次审批。\n\n确定继续？','connection.heroTrustConfirm':'切换为本次 Tunnel 会话免审批？高权限操作将可直接执行直到服务重启或恢复逐次审批。','connection.reconnectConfirm':'这会断开当前 Secure MCP Tunnel，并返回登录页以重新输入 Tunnel ID 和 Runtime API Key。\n\n确定继续？','connection.legacyConfirm':'确定执行此 Legacy OAuth 操作？',
    'sessions.title':'终端会话','sessions.subtitle':'RDC-X 创建并管理的命令行会话。','sessions.empty':'当前没有 RDC-X 管理的终端会话。','sessions.stop':'停止进程',
    'audit.title':'审计日志','audit.subtitle':'本机记录最近 200 条操作事件，不保存 Token、文件正文或 stdin 正文。',
    'settings.title':'访问策略','settings.subtitle':'定义 ChatGPT 通过 RDC-X 可以使用的本机能力。','settings.deviceName':'设备名称','settings.legacyOrigin':'Legacy OAuth HTTPS 源地址','settings.legacyOriginHint':'仅兼容旧的 47831 OAuth MCP 流程；不要加 /mcp。','settings.roots':'授权目录','settings.rootsHint':'每行使用 <code>rw | path</code> 或 <code>ro | path</code>。空列表会禁止全部文件访问。',
    'settings.fileWriteApproval':'文件写入审批','settings.fileWriteApprovalHint':'默认要求文件修改逐次审批','settings.terminalCommands':'终端命令','settings.terminalCommandsHint':'允许执行终端命令','settings.processControl':'系统进程控制','settings.processControlHint':'允许终止任意非关键系统进程','settings.desktopControl':'桌面控制','settings.desktopControlHint':'允许截图、窗口、鼠标与键盘控制','settings.networkFetch':'网络文本读取','settings.networkFetchHint':'允许读取公网 HTTP/HTTPS 文本',
    'settings.terminalWarning':'终端不是操作系统沙箱。批准的命令拥有当前 Windows 用户权限；需要强隔离时请使用低权限专用账号或虚拟机。','settings.oauthHosts':'允许的 OAuth 回调域名','settings.oauthHostsHint':'逗号分隔的精确域名，不支持通配符。','settings.save':'保存访问策略','settings.localService':'本机服务','settings.shutdownHint':'停止 RDC-X 会同时停止由它管理的 Secure MCP Tunnel。','settings.shutdown':'停止 RDC-X 与 Tunnel','settings.saved':'访问策略已保存。','settings.badRoot':'目录格式应为：rw | F:\\Project 或 ro | F:\\Reference','settings.terminalConfirm':'终端不是操作系统沙箱，命令拥有当前 Windows 用户权限。\n\n确定启用？','settings.highPrivilegeConfirm':'你正在开启高权限系统/桌面控制。若 Tunnel 同时设为免审批，ChatGPT 可以直接执行这些操作。\n\n确定继续？','settings.shutdownConfirm':'停止 RDC-X 与由它管理的 Secure MCP Tunnel？\n\n之后运行 Start-All.cmd 可重新启动。','settings.stopped':'RDC-X 正在停止。','settings.stoppedGate':'RDC-X 已停止。再次使用请运行 Start-All.cmd。',
    'error.invalidResponse':'本机 RDC-X 服务返回了无效响应。','error.staleBackend':'当前运行的 RDC-X 后台版本比此页面旧。请再次运行 Start-All.cmd，使后台与 Dashboard 使用同一版本。','error.requestFailed':'请求失败','error.adminKey':'需要本机管理密钥。','error.bootstrapKey':'Runtime API Key 是进入 Dashboard 的必需项。','error.tunnelId':'Tunnel ID 必须是 tunnel_ 加 32 位小写十六进制字符。','error.tunnelTimeout':'Secure MCP Tunnel 未能在 20 秒内就绪。请检查 Tunnel ID、Runtime API Key、网络连接和 tunnel-client 安装。','error.otherClient':'另一个 tunnel-client 正在使用 127.0.0.1:47834。请先关闭旧 tunnel-client，再重试。',
    'status.pending':'等待中','status.approved':'已批准','status.rejected':'已拒绝','status.completed':'已完成','status.failed':'失败','status.started':'已启动','status.stopped':'已停止','status.updated':'已更新','status.resumed':'已恢复','status.paused':'已暂停','status.forgotten':'已删除','status.exited':'已退出'
  },
  en: {
    'brand.gateway':'PERSONAL DESKTOP GATEWAY','brand.secureAccess':'SECURE DESKTOP ACCESS','brand.secureDesktop':'Secure Desktop',
    'common.continue':'Continue','common.show':'Show','common.hide':'Hide','common.resume':'Resume access','common.pause':'Pause','common.viewAll':'View all →',
    'common.enabled':'Enabled','common.disabled':'Disabled','common.allowed':'Allowed','common.approvalRequired':'Approval required','common.perAction':'Per-action approval','common.sessionTrusted':'Session trusted','common.saved':'Saved',
    'unlock.kicker':'LOCAL ADMIN ACCESS','unlock.title':'Open local console','unlock.hint':'Open this page from <code>Start-All.cmd</code>. If you opened it manually, enter the local admin key.','unlock.keyLabel':'Local admin key','unlock.keyPlaceholder':'Enter local admin key','unlock.note':'The admin key is only for 127.0.0.1 local control. Never send it to ChatGPT.',
    'gate.visualTitle':'Secure access<br>to your computer.','gate.visualBody':'RDC-X securely connects ChatGPT to this computer through OpenAI Secure MCP Tunnel. The Dashboard unlocks only after the tunnel is Ready.','gate.privateTitle':'PRIVATE BY DEFAULT','gate.privateBody':'Loopback only · Local credential handling · Human in control',
    'gate.title':'Connect Secure Tunnel','gate.intro':'Enter your Tunnel ID and Runtime API Key. RDC-X unlocks the Dashboard only after the connection reaches <b>Ready</b>.','gate.tunnelId':'Tunnel ID','gate.runtimeKey':'Runtime API Key','gate.keyPlaceholder':'Enter Runtime API Key',
    'gate.credentialTitle':'Tunnel ID is stored locally','gate.credentialBody':'The Runtime API Key is protected with Windows DPAPI for the current user. Your browser may also offer password autofill.','gate.submit':'Connect and enter Dashboard','gate.waiting':'Waiting for credentials','gate.help1':'First-time setup requires a Tunnel ID and Runtime API Key created in OpenAI Platform.','gate.help2':'RDC-X never prints the Runtime API Key to its logs.',
    'gate.running':'The tunnel is already running. Enter credentials for this Start-All session to unlock the Dashboard.','gate.live':'tunnel-client is running and waiting for OpenAI Control Plane readiness.','gate.savedKey':'Tunnel ID is already stored. Enter the Runtime API Key to unlock this Dashboard session.','gate.connecting':'Starting tunnel-client and waiting for OpenAI Secure MCP Tunnel to become Ready…','gate.connected':'Tunnel Ready. Opening Dashboard…','gate.badTunnelId':'Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters.','gate.keyRequired':'Runtime API Key is required for this startup.',
    'nav.overview':'Overview','nav.approvals':'Approvals','nav.connection':'Connection','nav.sessions':'Terminal sessions','nav.audit':'Audit log','nav.policy':'Access policy','sidebar.localService':'Local service',
    'status.tunnelReady':'Tunnel Ready','status.thisComputer':'This computer','status.ready':'Ready','status.live':'Live','status.offline':'Offline',
    'overview.pausedTitle':'Remote access is paused','overview.pausedBody':'Resume access before ChatGPT can call RDC-X tools.','overview.activeTitle':'Secure access is active','overview.activeBody':'OpenAI Secure MCP Tunnel is Ready and this computer can accept RDC-X tool calls from ChatGPT.',
    'overview.tunnelUi':'Tunnel UI','overview.approval':'Approval','overview.trusted':'Trusted','overview.welcome':'Welcome to RDC-X','overview.subtitle':'Local policy controls which files, terminal features and desktop capabilities ChatGPT can use.',
    'overview.authorizedDirs':'Authorized directories','overview.authorizedDirsHint':'File access boundaries','overview.awaitingApproval':'Awaiting approval','overview.awaitingApprovalHint':'Operations needing local consent','overview.terminalSessions':'Terminal sessions','overview.terminalEnabled':'Terminal enabled','overview.terminalDisabled':'Terminal disabled',
    'overview.recentActivity':'Recent activity','overview.recentActivityHint':'Latest local audit events','overview.accessSnapshot':'Access snapshot','overview.accessSnapshotHint':'Current high-level policy',
    'policy.fileWrites':'File writes','policy.terminal':'Terminal','policy.desktop':'Desktop control','policy.approvalMode':'Approval mode',
    'approvals.title':'Approvals','approvals.subtitle':'Review and approve controlled operations requested by ChatGPT.','approvals.empty':'There are no operations waiting for local approval.','approvals.details':'View full parameters','approvals.approve':'Approve and run','approvals.reject':'Reject','approvals.result':'Execution result','approvals.confirmProcess':'Terminal/process operations run with the current Windows user privileges.\n\nContinue?',
    'connection.title':'Connection','connection.subtitle':'Secure MCP Tunnel is the required remote connection for RDC-X.','connection.loopbackHint':'Only the loopback MCP target is exposed to tunnel-client.','connection.localTarget':'Local MCP target','connection.keyStored':'Stored with Windows DPAPI','connection.keyMissing':'Not stored','connection.openTunnelUi':'Open tunnel-client UI','connection.trustSession':'Trust this Tunnel session','connection.restoreApproval':'Restore per-action approval','connection.changeCredentials':'Change Tunnel credentials',
    'connection.legacyTitle':'Legacy OAuth compatibility','connection.legacyBody':'The port 47831 OAuth MCP endpoint remains available for advanced compatibility, but it is not the default RDC-X connection.','connection.pendingPairings':'Pending OAuth pairings','connection.authorizations':'OAuth authorizations','connection.revokeOAuth':'Revoke all OAuth authorizations','connection.clearOAuth':'Clear OAuth client registrations','connection.noPairings':'No pending Legacy OAuth pairings.','connection.noAuthorizations':'No Legacy OAuth authorizations.',
    'connection.pairApprove':'Code matches — allow connection','connection.trustConfirm':'This lets Secure MCP Tunnel perform file changes, terminal, process, desktop and Unity mutations directly until RDC-X restarts or per-action approval is restored.\n\nContinue?','connection.heroTrustConfirm':'Trust this Tunnel session? High-privilege operations can run directly until RDC-X restarts or approval is restored.','connection.reconnectConfirm':'This disconnects the current Secure MCP Tunnel and returns to sign-in so you can enter a new Tunnel ID and Runtime API Key.\n\nContinue?','connection.legacyConfirm':'Continue with this Legacy OAuth action?',
    'sessions.title':'Terminal sessions','sessions.subtitle':'Command-line sessions created and managed by RDC-X.','sessions.empty':'There are no RDC-X managed terminal sessions.','sessions.stop':'Stop process',
    'audit.title':'Audit log','audit.subtitle':'The local audit keeps the latest 200 events and does not store tokens, file bodies or stdin bodies.',
    'settings.title':'Access policy','settings.subtitle':'Define which local capabilities ChatGPT may use through RDC-X.','settings.deviceName':'Device name','settings.legacyOrigin':'Legacy OAuth HTTPS origin','settings.legacyOriginHint':'Only used by the legacy port 47831 OAuth MCP flow. Do not append /mcp.','settings.roots':'Authorized roots','settings.rootsHint':'Use <code>rw | path</code> or <code>ro | path</code> on each line. An empty list denies all file access.',
    'settings.fileWriteApproval':'File write approval','settings.fileWriteApprovalHint':'Require per-action approval for file mutations by default','settings.terminalCommands':'Terminal commands','settings.terminalCommandsHint':'Allow terminal command execution','settings.processControl':'System process control','settings.processControlHint':'Allow termination of arbitrary non-critical system processes','settings.desktopControl':'Desktop control','settings.desktopControlHint':'Allow screenshots, windows, mouse and keyboard control','settings.networkFetch':'Network text fetch','settings.networkFetchHint':'Allow public HTTP/HTTPS text retrieval',
    'settings.terminalWarning':'Terminal execution is not an operating-system sandbox. Approved commands run with the current Windows user privileges. Use a dedicated low-privilege account or VM for stronger isolation.','settings.oauthHosts':'Allowed OAuth redirect hosts','settings.oauthHostsHint':'Exact hostnames separated by commas. Wildcards are not allowed.','settings.save':'Save access policy','settings.localService':'Local service','settings.shutdownHint':'Stopping RDC-X also stops the Secure MCP Tunnel managed by it.','settings.shutdown':'Stop RDC-X and Tunnel','settings.saved':'Access policy saved.','settings.badRoot':'Root format must be: rw | F:\\Project or ro | F:\\Reference','settings.terminalConfirm':'Terminal is not an operating-system sandbox and commands run with the current Windows user privileges.\n\nEnable it?','settings.highPrivilegeConfirm':'You are enabling high-privilege process/desktop control. If the Tunnel is also trusted, ChatGPT may run these operations directly.\n\nContinue?','settings.shutdownConfirm':'Stop RDC-X and its managed Secure MCP Tunnel?\n\nRun Start-All.cmd to start it again.','settings.stopped':'RDC-X is stopping.','settings.stoppedGate':'RDC-X has stopped. Run Start-All.cmd to use it again.',
    'error.invalidResponse':'Invalid response from the local RDC-X service.','error.staleBackend':'The running RDC-X backend is older than this page. Run Start-All.cmd again so the backend and Dashboard use the same version.','error.requestFailed':'Request failed','error.adminKey':'Local admin key is required.','error.bootstrapKey':'Runtime API Key is required to enter the Dashboard.','error.tunnelId':'Tunnel ID must be tunnel_ followed by 32 lowercase hexadecimal characters.','error.tunnelTimeout':'Secure MCP Tunnel did not become Ready within 20 seconds. Check the Tunnel ID, Runtime API Key, network access and tunnel-client installation.','error.otherClient':'Another tunnel-client is already using 127.0.0.1:47834. Close the old tunnel-client and try again.',
    'status.pending':'Pending','status.approved':'Approved','status.rejected':'Rejected','status.completed':'Completed','status.failed':'Failed','status.started':'Started','status.stopped':'Stopped','status.updated':'Updated','status.resumed':'Resumed','status.paused':'Paused','status.forgotten':'Deleted','status.exited':'Exited'
  }
};

function t(keyName) {
  return messages[locale]?.[keyName] ?? messages.en[keyName] ?? keyName;
}

function translateBackendError(message) {
  const value = String(message || '');
  if (/Runtime API Key is required to enter the Dashboard/i.test(value)) return t('error.bootstrapKey');
  if (/Tunnel ID must be tunnel_/i.test(value)) return t('error.tunnelId');
  if (/did not become ready within 20 seconds/i.test(value)) return t('error.tunnelTimeout');
  if (/Another tunnel-client is already using 127\.0\.0\.1:47834/i.test(value)) return t('error.otherClient');
  return value;
}

function applyI18n() {
  document.documentElement.lang = locale;
  document.querySelectorAll('[data-i18n]').forEach(element => {
    element.textContent = t(element.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(element => {
    element.innerHTML = t(element.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(element => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-language-select]').forEach(select => { select.value = locale; });
  $('toggleGateKey').textContent = $('gateApiKey').type === 'password' ? t('common.show') : t('common.hide');
  showView(currentView);
}

async function setLanguage(next) {
  locale = next === 'en' ? 'en' : 'zh-CN';
  localStorage.setItem('rdcx-lang', locale);
  applyI18n();
  if (snapshot && !$('dashboardShell').hidden) renderDashboard(snapshot);
  else if (!$('tunnelGate').hidden && key) await bootstrap();
}

document.querySelectorAll('[data-language-select]').forEach(select => {
  select.addEventListener('change', event => { void setLanguage(event.target.value); });
});

function toast(message, error = false) {
  const target = $('toast');
  target.textContent = translateBackendError(message);
  target.className = error ? 'error' : '';
  target.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { target.hidden = true; }, 5000);
}

async function api(url, body) {
  const response = await fetch('/api' + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'X-RDC-Admin': key,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let result;
  try {
    result = await response.json();
  } catch {
    result = { error: t('error.invalidResponse') };
  }

  if (!response.ok) {
    if (response.status === 404 && (url.startsWith('/bootstrap') || url.startsWith('/tunnel/'))) {
      throw new Error(t('error.staleBackend'));
    }
    throw new Error(translateBackendError(result.error || t('error.requestFailed')));
  }
  return result;
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function empty(target, message) {
  target.replaceChildren(node('div', message, 'empty'));
}

function action(label, fn, className = 'outline') {
  const button = node('button', label, className);
  button.type = 'button';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await fn();
      await refresh();
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

function setGateStatus(mode, message) {
  const target = $('gateStatus');
  target.className = 'gate-status' + (mode ? ' ' + mode : '');
  target.replaceChildren(
    node('span', undefined, 'status-dot ' + (mode === 'loading' || mode === 'connected' ? '' : 'muted-dot')),
    node('span', translateBackendError(message))
  );
}

function showAdminUnlock() {
  $('adminUnlock').hidden = false;
  $('tunnelGate').hidden = true;
  $('dashboardShell').hidden = true;
}

function showGate(state) {
  $('adminUnlock').hidden = true;
  $('tunnelGate').hidden = false;
  $('dashboardShell').hidden = true;

  if (!$('gateTunnelId').value.trim() && state?.tunnelId) $('gateTunnelId').value = state.tunnelId;

  if (state?.lastError) setGateStatus('error', state.lastError);
  else if (state?.ready) setGateStatus('', t('gate.running'));
  else if (state?.live) setGateStatus('loading', t('gate.live'));
  else if (state?.hasApiKey) setGateStatus('', t('gate.savedKey'));
  else setGateStatus('', t('gate.waiting'));
}

function showDashboard() {
  $('adminUnlock').hidden = true;
  $('tunnelGate').hidden = true;
  $('dashboardShell').hidden = false;
  showView(currentView);
}

function showView(view) {
  const valid = ['overview','requests','connections','sessions','audit','settings'];
  if (!valid.includes(view)) view = 'overview';
  currentView = view;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === 'view-' + view));
  document.querySelectorAll('.nav-item[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  const viewKey = {overview:'nav.overview',requests:'nav.approvals',connections:'nav.connection',sessions:'nav.sessions',audit:'nav.audit',settings:'nav.policy'}[view];
  if ($('breadcrumb')) $('breadcrumb').textContent = t(viewKey);
}

async function bootstrap() {
  if (!key) {
    showAdminUnlock();
    return;
  }
  try {
    const state = await api('/bootstrap');
    sessionStorage.setItem('rdcx-key', key);
    if (state.dashboardUnlocked && state.ready) await refresh();
    else showGate(state);
  } catch (error) {
    if (/admin key/i.test(error.message) || /管理密钥/.test(error.message)) {
      sessionStorage.removeItem('rdcx-key');
      key = '';
      showAdminUnlock();
    } else {
      showGate({ lastError: error.message });
    }
  }
}

function shortTunnelId(value) {
  if (!value) return '--';
  if (value.length < 22) return value;
  return value.slice(0, 14) + '…' + value.slice(-8);
}

function translatedStatus(value) {
  const keyName = 'status.' + String(value || '').toLowerCase();
  return messages[locale][keyName] || value;
}

function auditRows(target, items) {
  target.replaceChildren();
  if (!items.length) return empty(target, locale === 'zh-CN' ? '暂无审计记录。' : 'No audit events yet.');
  for (const item of items) {
    const row = node('div', undefined, 'audit-row');
    row.append(
      node('time', new Date(item.time).toLocaleTimeString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')),
      node('code', item.action),
      node('span', translatedStatus(item.outcome), 'outcome ' + (item.outcome === 'failed' ? 'failed' : ''))
    );
    if (item.detail) row.title = JSON.stringify(item.detail);
    target.append(row);
  }
}

function renderLists(data) {
  const signature = JSON.stringify([locale, data.approvals, data.pairings, data.authorizations, data.sessions, data.audit]);
  if (signature === lastLists) return;
  lastLists = signature;

  const approvals = $('approvalList');
  approvals.replaceChildren();
  if (!data.approvals.length) empty(approvals, t('approvals.empty'));

  for (const item of data.approvals) {
    const box = node('article', undefined, 'request');
    const head = node('div', undefined, 'request-head');
    head.append(node('strong', item.action), node('span', translatedStatus(item.status), 'badge'));
    box.append(head, node('p', new Date(item.createdAt).toLocaleString(locale === 'zh-CN' ? 'zh-CN' : 'en-US')));

    const details = node('details');
    details.open = item.status === 'pending';
    details.append(node('summary', t('approvals.details')), node('pre', JSON.stringify(item.preview, null, 2)));
    box.append(details);

    if (item.status === 'pending') {
      const actions = node('div', undefined, 'actions');
      actions.append(
        action(t('approvals.approve'), async () => {
          if ((item.action.includes('process') || item.action === 'force_terminate') && !confirm(t('approvals.confirmProcess'))) return;
          await api('/approvals/' + item.id, { approve: true });
        }, 'primary'),
        action(t('approvals.reject'), () => api('/approvals/' + item.id, { approve: false }), 'outline danger-text')
      );
      box.append(actions);
    }

    if (item.result !== undefined || item.error) {
      const result = node('details');
      result.append(node('summary', t('approvals.result')), node('pre', item.error || JSON.stringify(item.result, null, 2)));
      box.append(result);
    }
    approvals.append(box);
  }

  const pairs = $('pairList');
  pairs.replaceChildren();
  if (!data.pairings.length) empty(pairs, t('connection.noPairings'));

  for (const item of data.pairings) {
    const box = node('article', undefined, 'request');
    box.append(node('strong', item.name), node('div', item.pin, 'pin'), node('p', item.redirect), node('p', item.scopes.join(' / ')));
    const actions = node('div', undefined, 'actions');
    actions.append(
      action(t('connection.pairApprove'), () => api('/pairings/' + item.id, { approve: true }), 'primary'),
      action(t('approvals.reject'), () => api('/pairings/' + item.id, { approve: false }), 'outline danger-text')
    );
    box.append(actions);
    pairs.append(box);
  }

  const auths = $('authorizationList');
  auths.replaceChildren();
  if (!data.authorizations?.length) empty(auths, t('connection.noAuthorizations'));

  for (const item of data.authorizations || []) {
    const trusted = item.approvalMode === 'trusted';
    const box = node('article', undefined, 'request');
    box.append(
      node('strong', item.clientName),
      node('p', item.scopes.join(' / ')),
      node('span', trusted ? t('common.sessionTrusted') : t('common.perAction'), 'pill ' + (trusted ? 'success-pill' : ''))
    );
    const actions = node('div', undefined, 'actions');
    if (trusted) {
      actions.append(action(t('connection.restoreApproval'), () => api('/authorizations/' + item.grantId + '/approval-mode', { mode: 'default' })));
    } else {
      actions.append(action(t('connection.trustSession'), async () => {
        if (!confirm(t('connection.trustConfirm'))) return;
        await api('/authorizations/' + item.grantId + '/approval-mode', { mode: 'trusted' });
      }));
    }
    box.append(actions);
    auths.append(box);
  }

  const sessions = $('sessionList');
  sessions.replaceChildren();
  if (!data.sessions.length) empty(sessions, t('sessions.empty'));

  for (const item of data.sessions) {
    const box = node('article', undefined, 'request');
    box.append(node('strong', `PID ${item.pid || '-'} · ${item.state}`), node('pre', item.command), node('p', item.cwd));
    if (item.state === 'running') box.append(action(t('sessions.stop'), () => api('/sessions/' + item.id + '/stop', {}), 'outline danger-text'));
    sessions.append(box);
  }

  auditRows($('recentAudit'), data.audit.slice(0, 7));
  auditRows($('auditList'), data.audit);
}

function populateSettings(config) {
  $('name').value = config.name;
  $('publicUrl').value = config.publicUrl;
  $('rootsInput').value = config.roots.map(root => (root.write ? 'rw' : 'ro') + ' | ' + root.path).join('\n');
  $('writeApproval').checked = config.requireWriteApproval;
  $('terminalEnabled').checked = config.terminalEnabled;
  $('systemProcessEnabled').checked = !!config.systemProcessControlEnabled;
  $('desktopEnabled').checked = !!config.desktopControlEnabled;
  $('networkFetchEnabled').checked = !!config.networkFetchEnabled;
  $('oauthHosts').value = config.oauthRedirectHosts.join(', ');
  loadedSettings = true;
}

function renderDashboard(data) {
  const config = data.config;
  const tunnel = data.secureTunnel;
  const pending = data.approvals.filter(item => item.status === 'pending').length + data.pairings.length;
  const runningSessions = data.sessions.filter(item => item.state === 'running').length;
  const trusted = tunnel.approvalMode === 'trusted';

  $('topDeviceName').textContent = config.name;
  $('topTunnelBadge').querySelector('span').textContent = t('status.tunnelReady');
  $('heroStatus').textContent = locale === 'zh-CN' ? '就绪' : 'READY';
  $('heroTunnelId').textContent = shortTunnelId(tunnel.tunnelId);
  $('heroEndpoint').textContent = tunnel.endpoint.replace(/^http:\/\//, '');
  $('rootCount').textContent = config.roots.length;
  $('pendingCount').textContent = pending;
  $('sessionCount').textContent = runningSessions;
  $('terminalSummary').textContent = config.terminalEnabled ? t('overview.terminalEnabled') : t('overview.terminalDisabled');
  $('navPending').textContent = pending;
  $('navPending').hidden = pending === 0;

  $('writePolicy').textContent = config.requireWriteApproval ? t('common.approvalRequired') : t('common.allowed');
  $('terminalPolicy').textContent = config.terminalEnabled ? t('common.enabled') : t('common.disabled');
  $('desktopPolicy').textContent = config.desktopControlEnabled ? t('common.enabled') : t('common.disabled');
  $('overviewApprovalMode').textContent = trusted ? t('common.sessionTrusted') : t('common.perAction');

  $('pausedBanner').hidden = !config.paused;
  $('heroPause').querySelector('b').textContent = config.paused ? t('common.resume') : t('common.pause');
  $('heroPause').querySelector('span').textContent = config.paused ? '▶' : 'Ⅱ';

  $('heroApprovalText').textContent = trusted ? t('overview.trusted') : t('overview.approval');
  $('connectionTunnelId').textContent = tunnel.tunnelId || '--';
  $('secureTunnelEndpoint').textContent = tunnel.endpoint || '--';
  $('secureTunnelKeyStatus').textContent = tunnel.hasApiKey ? t('connection.keyStored') : t('connection.keyMissing');
  $('secureTunnelApproval').textContent = trusted ? t('common.sessionTrusted') : t('common.perAction');
  $('secureTunnelTrust').hidden = trusted;
  $('secureTunnelRestore').hidden = !trusted;
  $('connectionReadyBadge').textContent = tunnel.ready ? (locale === 'zh-CN' ? '就绪' : 'READY') : tunnel.live ? (locale === 'zh-CN' ? '在线' : 'LIVE') : (locale === 'zh-CN' ? '离线' : 'OFFLINE');

  const error = $('secureTunnelError');
  error.hidden = !tunnel.lastError;
  error.textContent = tunnel.lastError ? translateBackendError(tunnel.lastError) : '';

  if (!loadedSettings) populateSettings(config);
  renderLists(data);
}

async function refresh() {
  if (!key || busy) return;
  busy = true;
  try {
    snapshot = await api('/state');

    if (!snapshot.dashboardUnlocked || !snapshot.secureTunnel?.ready) {
      const gateState = await api('/bootstrap');
      showGate(gateState);
      return;
    }

    sessionStorage.setItem('rdcx-key', key);
    showDashboard();
    renderDashboard(snapshot);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
  }
}

$('localKeyForm').addEventListener('submit', async event => {
  event.preventDefault();
  key = $('localAdminKey').value.trim();
  if (!key) return;
  await bootstrap();
});

$('gateForm').addEventListener('submit', async event => {
  event.preventDefault();
  const tunnelId = $('gateTunnelId').value.trim();
  const runtimeApiKey = $('gateApiKey').value.trim();
  const submit = $('gateSubmit');

  if (!/^tunnel_[0-9a-f]{32}$/.test(tunnelId)) {
    setGateStatus('error', t('gate.badTunnelId'));
    return;
  }
  if (!runtimeApiKey) {
    setGateStatus('error', t('gate.keyRequired'));
    return;
  }

  submit.disabled = true;
  setGateStatus('loading', t('gate.connecting'));

  try {
    await api('/bootstrap/connect', { tunnelId, runtimeApiKey });
    setGateStatus('connected', t('gate.connected'));
    $('gateApiKey').value = '';
    loadedSettings = false;
    lastLists = '';
    currentView = 'overview';
    await refresh();
  } catch (error) {
    setGateStatus('error', error.message);
  } finally {
    submit.disabled = false;
  }
});

$('toggleGateKey').addEventListener('click', () => {
  const input = $('gateApiKey');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  $('toggleGateKey').textContent = show ? t('common.hide') : t('common.show');
});

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

function openTunnelUi() {
  if (snapshot?.secureTunnel?.uiUrl) window.open(snapshot.secureTunnel.uiUrl, '_blank', 'noopener');
}
$('heroTunnelUi').addEventListener('click', openTunnelUi);
$('openTunnelUi').addEventListener('click', openTunnelUi);

async function setTunnelApproval(mode) {
  await api('/tunnel/approval-mode', { mode });
  await refresh();
}

$('secureTunnelTrust').addEventListener('click', async () => {
  if (!confirm(t('connection.trustConfirm'))) return;
  try { await setTunnelApproval('trusted'); } catch (error) { toast(error.message, true); }
});

$('secureTunnelRestore').addEventListener('click', async () => {
  try { await setTunnelApproval('default'); } catch (error) { toast(error.message, true); }
});

$('heroApproval').addEventListener('click', async () => {
  try {
    if (snapshot?.secureTunnel?.approvalMode === 'trusted') {
      await setTunnelApproval('default');
    } else {
      if (!confirm(t('connection.heroTrustConfirm'))) return;
      await setTunnelApproval('trusted');
    }
  } catch (error) {
    toast(error.message, true);
  }
});

$('reconnectTunnel').addEventListener('click', async () => {
  if (!confirm(t('connection.reconnectConfirm'))) return;
  try {
    await api('/tunnel/stop', {});
    const state = await api('/bootstrap');
    $('gateApiKey').value = '';
    showGate(state);
  } catch (error) {
    toast(error.message, true);
  }
});

async function togglePause() {
  try {
    await api('/pause', { paused: !snapshot.config.paused });
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
}
$('heroPause').addEventListener('click', togglePause);
$('resumeFromBanner').addEventListener('click', togglePause);

for (const [id, url] of [['revoke', '/revoke'], ['resetClients', '/clients/reset']]) {
  $(id).addEventListener('click', async () => {
    if (!confirm(t('connection.legacyConfirm'))) return;
    try {
      await api(url, {});
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const roots = $('rootsInput').value.split('\n').filter(value => value.trim()).map(line => {
      const match = /^(rw|ro)\s*\|\s*(.+)$/i.exec(line.trim());
      if (!match) throw new Error(t('settings.badRoot'));
      return { path: match[2].trim(), write: match[1].toLowerCase() === 'rw' };
    });

    if ($('terminalEnabled').checked && !snapshot.config.terminalEnabled && !confirm(t('settings.terminalConfirm'))) return;

    if ((($('systemProcessEnabled').checked && !snapshot.config.systemProcessControlEnabled) ||
         ($('desktopEnabled').checked && !snapshot.config.desktopControlEnabled)) &&
        !confirm(t('settings.highPrivilegeConfirm'))) return;

    await api('/config', {
      name: $('name').value.trim(),
      publicUrl: $('publicUrl').value.trim(),
      roots,
      requireWriteApproval: $('writeApproval').checked,
      terminalEnabled: $('terminalEnabled').checked,
      systemProcessControlEnabled: $('systemProcessEnabled').checked,
      desktopControlEnabled: $('desktopEnabled').checked,
      networkFetchEnabled: $('networkFetchEnabled').checked,
      oauthRedirectHosts: $('oauthHosts').value.split(',').map(value => value.trim()).filter(Boolean)
    });

    $('saveStatus').textContent = t('common.saved');
    loadedSettings = false;
    await refresh();
    toast(t('settings.saved'));
  } catch (error) {
    toast(error.message, true);
  }
});

$('shutdownService').addEventListener('click', async () => {
  if (!confirm(t('settings.shutdownConfirm'))) return;
  try {
    await api('/shutdown', {});
    toast(t('settings.stopped'));
    setTimeout(() => {
      $('dashboardShell').hidden = true;
      $('tunnelGate').hidden = false;
      setGateStatus('error', t('settings.stoppedGate'));
    }, 500);
  } catch (error) {
    toast(error.message, true);
  }
});

applyI18n();
void bootstrap();

setInterval(() => {
  if (!document.hidden && !$('dashboardShell').hidden) void refresh();
}, 2500);
