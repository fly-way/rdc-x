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

const viewNames = {
  overview: 'Overview',
  requests: 'Approvals',
  connections: 'Connection',
  sessions: 'Terminal sessions',
  audit: 'Audit log',
  settings: 'Access policy'
};

function toast(message, error = false) {
  const target = $('toast');
  target.textContent = message;
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
    result = { error: 'Invalid response from local RDC-X service.' };
  }

  if (!response.ok) {
    if (response.status === 404 && (url.startsWith('/bootstrap') || url.startsWith('/tunnel/'))) {
      throw new Error('The running RDC-X backend is older than this page. Run Start-All.cmd again so the backend and dashboard use the same version.');
    }
    throw new Error(result.error || 'Request failed');
  }
  return result;
}

function node(tag, content, className) {
  const element = document.createElement(tag);
  if (content !== undefined) element.textContent = content;
  if (className) element.className = className;
  return element;
}

function empty(target, message = '暂无记录') {
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
  target.replaceChildren(node('span', undefined, 'status-dot ' + (mode === 'loading' || mode === 'connected' ? '' : 'muted-dot')), node('span', message));
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

  if (state?.lastError) {
    setGateStatus('error', state.lastError);
  } else if (state?.ready) {
    setGateStatus('', 'Tunnel 已在运行；本次 Start-All 仍需验证凭据后才能进入 Dashboard。');
  } else if (state?.live) {
    setGateStatus('loading', 'tunnel-client 已启动，等待 OpenAI Control Plane Ready。');
  } else if (state?.hasApiKey) {
    setGateStatus('', 'Tunnel ID 已记录；请输入 Runtime API Key 以解锁本次 Dashboard。');
  } else {
    setGateStatus('', '等待 Tunnel ID 与 Runtime API Key');
  }
}

function showDashboard() {
  $('adminUnlock').hidden = true;
  $('tunnelGate').hidden = true;
  $('dashboardShell').hidden = false;
  showView(currentView);
}

function showView(view) {
  if (!viewNames[view]) view = 'overview';
  currentView = view;
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === 'view-' + view));
  document.querySelectorAll('.nav-item[data-view]').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  $('breadcrumb').textContent = viewNames[view];
}

async function bootstrap() {
  if (!key) {
    showAdminUnlock();
    return;
  }
  try {
    const state = await api('/bootstrap');
    sessionStorage.setItem('rdcx-key', key);
    if (state.dashboardUnlocked && state.ready) {
      await refresh();
    } else {
      showGate(state);
    }
  } catch (error) {
    if (/admin key/i.test(error.message)) {
      sessionStorage.removeItem('rdcx-key');
      key = '';
      showAdminUnlock();
    } else {
      showGate({ lastError: error.message });
    }
  }
}

function shortTunnelId(value) {
  if (!value) return 'Not configured';
  if (value.length < 22) return value;
  return value.slice(0, 14) + '…' + value.slice(-8);
}

function auditRows(target, items) {
  target.replaceChildren();
  if (!items.length) return empty(target);
  for (const item of items) {
    const row = node('div', undefined, 'audit-row');
    row.append(
      node('time', new Date(item.time).toLocaleTimeString()),
      node('code', item.action),
      node('span', item.outcome, 'outcome ' + (item.outcome === 'failed' ? 'failed' : ''))
    );
    if (item.detail) row.title = JSON.stringify(item.detail);
    target.append(row);
  }
}

function renderLists(data) {
  const signature = JSON.stringify([data.approvals, data.pairings, data.authorizations, data.sessions, data.audit]);
  if (signature === lastLists) return;
  lastLists = signature;

  const approvals = $('approvalList');
  approvals.replaceChildren();
  if (!data.approvals.length) empty(approvals, '当前没有需要本机批准的操作。');

  for (const item of data.approvals) {
    const box = node('article', undefined, 'request');
    const head = node('div', undefined, 'request-head');
    head.append(node('strong', item.action), node('span', item.status, 'badge'));
    box.append(head, node('p', new Date(item.createdAt).toLocaleString()));

    const details = node('details');
    details.open = item.status === 'pending';
    details.append(node('summary', '查看完整参数'), node('pre', JSON.stringify(item.preview, null, 2)));
    box.append(details);

    if (item.status === 'pending') {
      const actions = node('div', undefined, 'actions');
      actions.append(
        action('批准并执行', async () => {
          if ((item.action.includes('process') || item.action === 'force_terminate') &&
              !confirm('终端/进程操作拥有当前 Windows 用户权限。\n\n确定执行？')) return;
          await api('/approvals/' + item.id, { approve: true });
        }, 'primary'),
        action('拒绝', () => api('/approvals/' + item.id, { approve: false }), 'outline danger-text')
      );
      box.append(actions);
    }

    if (item.result !== undefined || item.error) {
      const result = node('details');
      result.append(node('summary', '执行结果'), node('pre', item.error || JSON.stringify(item.result, null, 2)));
      box.append(result);
    }
    approvals.append(box);
  }

  const pairs = $('pairList');
  pairs.replaceChildren();
  if (!data.pairings.length) empty(pairs, '没有待处理的 Legacy OAuth 配对。');

  for (const item of data.pairings) {
    const box = node('article', undefined, 'request');
    box.append(
      node('strong', item.name),
      node('div', item.pin, 'pin'),
      node('p', item.redirect),
      node('p', item.scopes.join(' / '))
    );
    const actions = node('div', undefined, 'actions');
    actions.append(
      action('验证码一致，允许连接', () => api('/pairings/' + item.id, { approve: true }), 'primary'),
      action('拒绝', () => api('/pairings/' + item.id, { approve: false }), 'outline danger-text')
    );
    box.append(actions);
    pairs.append(box);
  }

  const auths = $('authorizationList');
  auths.replaceChildren();
  if (!data.authorizations?.length) empty(auths, '没有 Legacy OAuth 授权。');

  for (const item of data.authorizations || []) {
    const trusted = item.approvalMode === 'trusted';
    const box = node('article', undefined, 'request');
    box.append(
      node('strong', item.clientName),
      node('p', item.scopes.join(' / ')),
      node('span', trusted ? 'Session trusted' : 'Per-action approval', 'pill ' + (trusted ? 'success-pill' : ''))
    );
    const actions = node('div', undefined, 'actions');
    if (trusted) {
      actions.append(action('恢复逐次审批', () => api('/authorizations/' + item.grantId + '/approval-mode', { mode: 'default' })));
    } else {
      actions.append(action('本次会话免审批', async () => {
        if (!confirm('此 OAuth 会话的高权限操作将可直接执行，直到服务重启或撤销授权。\n\n确定继续？')) return;
        await api('/authorizations/' + item.grantId + '/approval-mode', { mode: 'trusted' });
      }));
    }
    box.append(actions);
    auths.append(box);
  }

  const sessions = $('sessionList');
  sessions.replaceChildren();
  if (!data.sessions.length) empty(sessions, '当前没有 RDC-X 管理的终端会话。');

  for (const item of data.sessions) {
    const box = node('article', undefined, 'request');
    box.append(
      node('strong', `PID ${item.pid || '-'} · ${item.state}`),
      node('pre', item.command),
      node('p', item.cwd)
    );
    if (item.state === 'running') {
      box.append(action('停止进程', () => api('/sessions/' + item.id + '/stop', {}), 'outline danger-text'));
    }
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
  $('topTunnelBadge').innerHTML = '<i></i> Tunnel Ready';
  $('heroStatus').textContent = 'READY';
  $('heroTunnelId').textContent = shortTunnelId(tunnel.tunnelId);
  $('heroEndpoint').textContent = tunnel.endpoint.replace(/^http:\/\//, '');
  $('rootCount').textContent = config.roots.length;
  $('pendingCount').textContent = pending;
  $('sessionCount').textContent = runningSessions;
  $('terminalSummary').textContent = config.terminalEnabled ? 'Terminal enabled' : 'Terminal disabled';
  $('navPending').textContent = pending;
  $('navPending').hidden = pending === 0;

  $('writePolicy').textContent = config.requireWriteApproval ? 'Approval required' : 'Allowed';
  $('terminalPolicy').textContent = config.terminalEnabled ? 'Enabled' : 'Disabled';
  $('desktopPolicy').textContent = config.desktopControlEnabled ? 'Enabled' : 'Disabled';
  $('overviewApprovalMode').textContent = trusted ? 'Session trusted' : 'Per action';

  $('pausedBanner').hidden = !config.paused;
  $('heroPause').querySelector('b').textContent = config.paused ? 'Resume' : 'Pause';
  $('heroPause').querySelector('span').textContent = config.paused ? '▶' : 'Ⅱ';

  $('heroApprovalText').textContent = trusted ? 'Trusted' : 'Approval';
  $('connectionTunnelId').textContent = tunnel.tunnelId || '--';
  $('secureTunnelEndpoint').textContent = tunnel.endpoint || '--';
  $('secureTunnelKeyStatus').textContent = tunnel.hasApiKey ? 'Stored with Windows DPAPI' : 'Not stored';
  $('secureTunnelApproval').textContent = trusted ? 'Session trusted / no per-action approval' : 'Per-action approval';
  $('secureTunnelTrust').hidden = trusted;
  $('secureTunnelRestore').hidden = !trusted;
  $('connectionReadyBadge').textContent = tunnel.ready ? 'READY' : tunnel.live ? 'LIVE' : 'OFFLINE';

  const error = $('secureTunnelError');
  error.hidden = !tunnel.lastError;
  error.textContent = tunnel.lastError || '';

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

/* Gate / local admin */
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
    setGateStatus('error', 'Tunnel ID 格式必须是 tunnel_ + 32 位小写十六进制字符。');
    return;
  }
  if (!runtimeApiKey) {
    setGateStatus('error', '本次启动必须输入 Runtime API Key。');
    return;
  }

  submit.disabled = true;
  setGateStatus('loading', '正在启动 tunnel-client，并等待 OpenAI Secure MCP Tunnel Ready…');

  try {
    await api('/bootstrap/connect', { tunnelId, runtimeApiKey });
    setGateStatus('connected', 'Tunnel Ready，正在进入 Dashboard…');
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
  $('toggleGateKey').textContent = show ? 'Hide' : 'Show';
});

$('lockDashboard').addEventListener('click', () => {
  key = '';
  sessionStorage.removeItem('rdcx-key');
  $('localAdminKey').value = '';
  showAdminUnlock();
});

/* Navigation */
document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

/* Tunnel controls */
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
  if (!confirm('开启后，Secure MCP Tunnel 的文件修改、终端、系统进程、桌面和 Unity 修改可直接执行，直到服务重启或恢复逐次审批。\n\n确定继续？')) return;
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
      if (!confirm('切换为本次 Tunnel 会话免审批？高权限操作将可直接执行直到服务重启或恢复逐次审批。')) return;
      await setTunnelApproval('trusted');
    }
  } catch (error) {
    toast(error.message, true);
  }
});

$('reconnectTunnel').addEventListener('click', async () => {
  if (!confirm('这会断开当前 Secure MCP Tunnel，并返回登录页以重新输入 Tunnel ID 和 Runtime API Key。\n\n确定继续？')) return;
  try {
    await api('/tunnel/stop', {});
    const state = await api('/bootstrap');
    $('gateApiKey').value = '';
    showGate(state);
  } catch (error) {
    toast(error.message, true);
  }
});

/* Remote access pause */
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

/* Legacy OAuth actions */
for (const [id, url] of [['revoke', '/revoke'], ['resetClients', '/clients/reset']]) {
  $(id).addEventListener('click', async () => {
    if (!confirm('确定执行此 Legacy OAuth 操作？')) return;
    try {
      await api(url, {});
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

/* Settings */
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const roots = $('rootsInput').value.split('\n').filter(value => value.trim()).map(line => {
      const match = /^(rw|ro)\s*\|\s*(.+)$/i.exec(line.trim());
      if (!match) throw new Error('目录格式应为：rw | F:\\Project 或 ro | F:\\Reference');
      return { path: match[2].trim(), write: match[1].toLowerCase() === 'rw' };
    });

    if ($('terminalEnabled').checked && !snapshot.config.terminalEnabled &&
        !confirm('终端不是操作系统沙箱，命令拥有当前 Windows 用户权限。\n\n确定启用？')) return;

    if ((($('systemProcessEnabled').checked && !snapshot.config.systemProcessControlEnabled) ||
         ($('desktopEnabled').checked && !snapshot.config.desktopControlEnabled)) &&
        !confirm('你正在开启高权限系统/桌面控制。若 Tunnel 同时设为免审批，ChatGPT 可以直接执行这些操作。\n\n确定继续？')) return;

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

    $('saveStatus').textContent = '已保存';
    loadedSettings = false;
    await refresh();
    toast('访问策略已保存。');
  } catch (error) {
    toast(error.message, true);
  }
});

$('shutdownService').addEventListener('click', async () => {
  if (!confirm('停止 RDC-X 与由它管理的 Secure MCP Tunnel？\n\n之后运行 Start-All.cmd 可重新启动。')) return;
  try {
    await api('/shutdown', {});
    toast('RDC-X 正在停止。');
    setTimeout(() => {
      $('dashboardShell').hidden = true;
      $('tunnelGate').hidden = false;
      setGateStatus('error', 'RDC-X 已停止。再次使用请运行 Start-All.cmd。');
    }, 500);
  } catch (error) {
    toast(error.message, true);
  }
});

void bootstrap();
setInterval(() => {
  if (!document.hidden && !$('dashboardShell').hidden) void refresh();
}, 2500);
