'use strict';

const $ = id => document.getElementById(id);
const hash = new URLSearchParams(location.hash.slice(1));
let key = hash.get('key') || sessionStorage.getItem('rdcx-key') || '';
const initialView = hash.get('view') || 'overview';
history.replaceState(null, '', location.pathname);

let snapshot;
let busy = false;
let loadedSettings = false;
let loadedTunnelSettings = false;
let lastLists = '';

const viewNames = {
  overview: '总览',
  requests: '操作审批',
  connections: '连接授权',
  sessions: '终端会话',
  audit: '审计日志',
  settings: '访问策略'
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
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 404 && url.startsWith('/tunnel/')) {
      throw new Error('Secure Tunnel backend route is unavailable. The browser is using newer files than the running RDC-X process. Run Start-All.cmd again to restart the backend.');
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

function empty(target) {
  target.replaceChildren(node('div', '暂无记录', 'empty'));
}

function action(label, fn, className) {
  const button = node('button', label, className);
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

function showView(view) {
  if (!viewNames[view]) view = 'overview';
  document.querySelectorAll('.view').forEach(element => element.classList.toggle('active', element.id === 'view-' + view));
  document.querySelectorAll('.nav').forEach(element => element.classList.toggle('active', element.dataset.view === view));
  $('breadcrumb').textContent = viewNames[view];
}

document.querySelectorAll('[data-view]').forEach(button => {
  button.addEventListener('click', () => showView(button.dataset.view));
});

function renderLists(data) {
  const signature = JSON.stringify([data.approvals, data.pairings, data.authorizations, data.sessions, data.audit]);
  if (signature === lastLists) return;
  lastLists = signature;

  const approvals = $('approvalList');
  approvals.replaceChildren();
  if (!data.approvals.length) empty(approvals);
  for (const item of data.approvals) {
    const box = node('article', undefined, 'request');
    const head = node('div', undefined, 'request-head');
    head.append(node('strong', item.action), node('span', item.status, 'badge'));
    box.append(head, node('p', new Date(item.createdAt).toLocaleString(), 'muted'));

    const details = node('details');
    details.open = item.status === 'pending';
    details.append(node('summary', '查看完整参数'), node('pre', JSON.stringify(item.preview, null, 2)));
    box.append(details);

    if (item.status === 'pending') {
      const actions = node('div', undefined, 'actions');
      actions.append(
        action('批准并执行', async () => {
          if ((item.action.includes('process') || item.action === 'force_terminate') &&
              !confirm('终端命令拥有当前 Windows 用户权限。\n\n确定执行此操作？')) return;
          await api('/approvals/' + item.id, { approve: true });
        }),
        action('拒绝', () => api('/approvals/' + item.id, { approve: false }), 'reject')
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
  if (!data.pairings.length) empty(pairs);
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
      action('验证码一致，允许连接', () => api('/pairings/' + item.id, { approve: true })),
      action('拒绝', () => api('/pairings/' + item.id, { approve: false }), 'reject')
    );
    box.append(actions);
    pairs.append(box);
  }

  const auths = $('authorizationList');
  auths.replaceChildren();
  if (!data.authorizations?.length) empty(auths);
  for (const item of data.authorizations || []) {
    const box = node('article', undefined, 'request');
    const trusted = item.approvalMode === 'trusted';
    box.append(
      node('strong', item.clientName),
      node('p', item.scopes.join(' / '), 'muted'),
      node('p', trusted ? '本次授权会话：免审批' : '本次授权会话：逐次审批', trusted ? 'badge' : 'muted')
    );
    const actions = node('div', undefined, 'actions');
    if (trusted) {
      actions.append(action('恢复逐次审批', () => api('/authorizations/' + item.grantId + '/approval-mode', { mode: 'default' })));
    } else {
      actions.append(action('本次会话完全无需审批', async () => {
        if (!confirm('开启后，此 OAuth 会话的文件修改、终端、系统进程、桌面和 Unity 操作可直接执行，直到服务重启或撤销授权。\n\n确定继续？')) return;
        await api('/authorizations/' + item.grantId + '/approval-mode', { mode: 'trusted' });
      }, 'danger-outline'));
    }
    box.append(actions);
    auths.append(box);
  }

  const sessions = $('sessionList');
  sessions.replaceChildren();
  if (!data.sessions.length) empty(sessions);
  for (const item of data.sessions) {
    const box = node('article', undefined, 'request');
    box.append(node('strong', `PID ${item.pid || '-'} / ${item.state}`), node('pre', item.command), node('p', item.cwd));
    if (item.state === 'running') box.append(action('停止进程', () => api('/sessions/' + item.id + '/stop', {}), 'reject'));
    sessions.append(box);
  }

  auditRows($('recentAudit'), data.audit.slice(0, 5));
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

function renderTunnel(tunnel) {
  $('secureTunnelEndpoint').textContent = tunnel.endpoint || '--';
  const status = tunnel.ready ? 'Ready / 可用' : tunnel.live ? 'Live / 尚未 Ready' : tunnel.processRunning ? '正在启动' : '已停止';
  $('secureTunnelStatus').textContent = status;
  $('overviewTunnelStatus').textContent = status;
  $('overviewTunnelId').textContent = tunnel.tunnelId || '未配置';
  $('secureTunnelKeyStatus').textContent = tunnel.hasApiKey ? '已用 Windows DPAPI 加密保存' : '未保存';

  const trusted = tunnel.approvalMode === 'trusted';
  $('secureTunnelApproval').textContent = trusted ? '本次会话免审批' : '逐次审批';
  $('secureTunnelTrust').hidden = trusted;
  $('secureTunnelRestore').hidden = !trusted;

  $('tunnelKeyHint').textContent = tunnel.hasApiKey
    ? '已用当前 Windows 用户的 DPAPI 加密保存。留空会继续使用已保存密钥。'
    : '首次配置必须输入。保存后不再从服务端返回明文。';

  $('openTunnelUi').disabled = !tunnel.live;
  $('overviewTunnelHint').textContent = tunnel.ready
    ? 'Secure MCP Tunnel 已就绪。只要 ChatGPT 工作区中的 RDC-X App 已发布，就可以直接使用。'
    : tunnel.configured
      ? '配置已保存；如果没有自动 Ready，请查看下方错误或启动 Tunnel。'
      : '首次使用请进入“连接授权”，填写 Tunnel ID 与 Runtime API Key。';

  const error = $('secureTunnelError');
  if (tunnel.lastError) {
    error.textContent = tunnel.lastError;
    error.hidden = false;
  } else {
    error.textContent = '';
    error.hidden = true;
  }

  if (!loadedTunnelSettings) {
    $('tunnelId').value = tunnel.tunnelId || '';
    $('tunnelApiKey').value = '';
    loadedTunnelSettings = true;
  }
}

async function refresh() {
  if (!key || busy) return;
  busy = true;
  try {
    snapshot = await api('/state');
    sessionStorage.setItem('rdcx-key', key);
    $('lock').hidden = true;
    $('shell').hidden = false;

    const config = snapshot.config;
    $('device').textContent = config.name + ' / ' + config.deviceId;
    $('serviceStatus').textContent = config.paused ? '已暂停' : '运行中';
    $('uptime').textContent = 'Uptime ' + Math.floor(config.uptimeSeconds / 60) + ' min';
    $('pendingCount').textContent = snapshot.approvals.filter(item => item.status === 'pending').length + snapshot.pairings.length;
    $('rootCount').textContent = config.roots.length;
    $('linkedCount').textContent = snapshot.authorizationCount + (snapshot.secureTunnel?.configured ? 1 : 0);
    $('writePolicy').textContent = config.requireWriteApproval ? '需要本机审批' : '白名单内允许';
    $('terminalPolicy').textContent = config.terminalEnabled ? '已启用 / 受审批策略控制' : '已关闭';
    $('pause').textContent = config.paused ? '恢复远程访问' : '暂停远程访问';

    renderTunnel(snapshot.secureTunnel);
    if (!loadedSettings) populateSettings(config);
    renderLists(snapshot);
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
  }
}

$('unlock').addEventListener('submit', event => {
  event.preventDefault();
  key = $('key').value.trim();
  showView(initialView);
  void refresh();
});

$('logout').addEventListener('click', () => {
  key = '';
  sessionStorage.removeItem('rdcx-key');
  $('shell').hidden = true;
  $('lock').hidden = false;
  $('key').value = '';
});

$('pause').addEventListener('click', async () => {
  try {
    await api('/pause', { paused: !snapshot.config.paused });
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});

$('tunnelForm').addEventListener('submit', async event => {
  event.preventDefault();
  const submit = $('tunnelSaveStart');
  submit.disabled = true;
  try {
    const runtimeApiKey = $('tunnelApiKey').value.trim();
    const body = { tunnelId: $('tunnelId').value.trim() };
    if (runtimeApiKey) body.runtimeApiKey = runtimeApiKey;
    await api('/tunnel/configure', body);
    $('tunnelApiKey').value = '';
    loadedTunnelSettings = false;
    await refresh();
    toast('Secure MCP Tunnel 配置已保存并启动。');
  } catch (error) {
    toast(error.message, true);
  } finally {
    submit.disabled = false;
  }
});

$('tunnelStart').addEventListener('click', async () => {
  try {
    await api('/tunnel/start', {});
    await refresh();
    toast('已请求启动 Secure MCP Tunnel。');
  } catch (error) {
    toast(error.message, true);
  }
});

$('tunnelStop').addEventListener('click', async () => {
  try {
    await api('/tunnel/stop', {});
    await refresh();
    toast('Secure MCP Tunnel 已停止。');
  } catch (error) {
    toast(error.message, true);
  }
});

$('openTunnelUi').addEventListener('click', () => {
  if (snapshot?.secureTunnel?.uiUrl) window.open(snapshot.secureTunnel.uiUrl, '_blank', 'noopener');
});

$('forgetTunnelKey').addEventListener('click', async () => {
  if (!confirm('这会停止 Secure MCP Tunnel，并删除本机 DPAPI 加密的 Runtime API Key。Tunnel ID 会保留。\n\n确定继续？')) return;
  try {
    await api('/tunnel/forget-key', {});
    $('tunnelApiKey').value = '';
    loadedTunnelSettings = false;
    await refresh();
    toast('已删除保存的 Runtime API Key。');
  } catch (error) {
    toast(error.message, true);
  }
});

$('secureTunnelTrust').addEventListener('click', async () => {
  if (!confirm('开启后，Secure MCP Tunnel 的文件修改、终端、系统进程、桌面和 Unity 操作可直接执行，直到服务重启、暂停访问或恢复逐次审批。\n\n确定继续？')) return;
  try {
    await api('/tunnel/approval-mode', { mode: 'trusted' });
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});

$('secureTunnelRestore').addEventListener('click', async () => {
  try {
    await api('/tunnel/approval-mode', { mode: 'default' });
    await refresh();
  } catch (error) {
    toast(error.message, true);
  }
});

for (const [id, url] of [['revoke', '/revoke'], ['resetClients', '/clients/reset']]) {
  $(id).addEventListener('click', async () => {
    if (!confirm('确定执行此操作？')) return;
    try {
      await api(url, {});
      await refresh();
    } catch (error) {
      toast(error.message, true);
    }
  });
}

$('shutdownService').addEventListener('click', async () => {
  if (!confirm('停止 RDC-X 与由它管理的 Secure MCP Tunnel？\n\n之后双击 Start-All.cmd 即可重新启动。')) return;
  try {
    await api('/shutdown', {});
    toast('RDC-X 正在停止。再次使用时双击 Start-All.cmd。');
  } catch (error) {
    toast(error.message, true);
  }
});

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

showView(initialView);
if (key) void refresh();
setInterval(() => {
  if (!document.hidden) void refresh();
}, 2500);
