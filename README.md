# RDC-X / Personal computer MCP gateway

RDC-X is a self-hosted, single-computer MCP gateway for personal use. It provides controlled access to files, terminal sessions, desktop automation, documents, system information, and Unity Editor workflows without depending on Remote Desktop Commander.

For the normal RDC-X workflow, **OpenAI Secure MCP Tunnel is mandatory**. The local service can start without a remote connection so its sign-in page can be served, but the Dashboard is not unlocked until the Secure MCP Tunnel reaches **Ready**.

## Windows daily workflow

RDC-X has one user-facing Windows launcher:

```text
Start-All.cmd
```

Run it after Windows starts. It:

1. checks Node.js 22+;
2. synchronizes npm dependencies;
3. runs local setup/migrations;
4. builds the TypeScript server;
5. restarts RDC-X so the running backend matches the checked-out files;
6. opens the local **Secure Tunnel sign-in** page.

The sign-in page requires:

- **Tunnel ID**
- **Runtime API Key**

The Tunnel ID is remembered locally and prefilled on later runs. The Runtime API Key field uses standard password-manager autocomplete, so the browser may offer to remember/fill it. RDC-X also stores an encrypted DPAPI copy for local tunnel lifecycle operations, but a fresh Runtime API Key entry is still required to unlock each new RDC-X process started by `Start-All.cmd`.

After submission RDC-X starts the official `tunnel-client` and waits for the tunnel to become **Ready**. Only then does the browser enter the Dashboard.

Local control URL:

```text
http://127.0.0.1:47832
```

`Start-All.cmd` opens that URL with a local admin-key fragment. The admin key is not printed.

## Secure Tunnel credentials

Install the official OpenAI `tunnel-client` and make it available through one of:

```text
<repo>\tools\tunnel-client.exe
PATH
TUNNEL_CLIENT_PATH
```

Tunnel metadata is stored at:

```text
.rdc\secure-tunnel.json
```

On Windows, RDC-X protects the Runtime API Key with **Windows DPAPI / CurrentUser** and stores only the protected representation at:

```text
.rdc\secure-tunnel-key.dpapi
```

The plaintext Runtime API Key is not returned by the dashboard API and is not written to RDC-X logs. The DPAPI ciphertext is bound to the Windows user profile that protected it.

## Required connection model

```text
Start-All.cmd
      |
Secure Tunnel sign-in
      |
Tunnel ID + Runtime API Key
      |
official tunnel-client
      |
OpenAI Secure MCP Tunnel  (must be Ready)
      |
Dashboard unlocked
      |
ChatGPT <-> RDC-X <-> Windows
```

Default local listeners:

- `127.0.0.1:47831` — legacy OAuth-protected MCP listener.
- `127.0.0.1:47832` — local sign-in / admin Dashboard.
- `127.0.0.1:47833` — loopback-only Secure MCP Tunnel MCP target.
- `127.0.0.1:47834` — tunnel-client health/admin UI while running.

Port 47833 is loopback-only and must not be forwarded to the public internet.

## Dashboard

The Dashboard uses a light business-console layout with larger readable typography and a full-width content area on desktop. The UI supports **Simplified Chinese and English**; the language selector is available on the Secure Tunnel sign-in page and in the Dashboard header, and the preference is kept in the browser.\n\nThe Dashboard includes:

- Secure Tunnel readiness and Tunnel ID;
- pending approvals;
- authorized directory count;
- managed terminal sessions;
- current file/terminal/desktop policy;
- recent audit activity;
- Secure Tunnel approval mode;
- access-policy configuration.

If the managed tunnel stops or loses readiness, the UI returns to the Secure Tunnel sign-in gate.

The **Connection** page can open the official tunnel-client UI, switch the tunnel owner between per-action approval and temporary trusted mode, or disconnect and return to sign-in to replace credentials.

Legacy OAuth pairings remain available only under the advanced compatibility section.

## ChatGPT workspace requirement

Secure MCP Tunnel is transport, not a bypass for ChatGPT workspace policy. The target ChatGPT workspace must allow the relevant custom/developer MCP app and the app must reference the same tunnel. Where the current user cannot create or publish the app, an authorized workspace administrator/operator must provision it.

Creating the ChatGPT-side RDC-X app is normally a one-time workspace operation. Restarting the Windows computer does not require recreating the app or the OpenAI tunnel resource.

## Local approval model

Secure Tunnel calls still pass through RDC-X local controls. By default, mutations can require local approval.

The Connection page can temporarily mark the Secure Tunnel session as trusted. That trust is held only in memory and is reset by an RDC-X restart.

The Access Policy page controls:

- read/write roots;
- file-write approval policy;
- terminal enablement;
- arbitrary non-critical system-process termination;
- desktop input/screenshot access;
- bounded public HTTP/HTTPS text fetching;
- legacy OAuth callback hosts.

Terminal execution is **not an operating-system sandbox**. Approved commands run with the current Windows user's privileges. Use a dedicated low-privilege Windows account or VM when stronger isolation is required.

## Included capabilities

RDC-X exposes 60+ MCP tools, including:

- bounded file listing, reading, writing, editing, moving, soft deletion, images, backups and recovery;
- literal filename/content search;
- managed terminal/process sessions;
- system information and guarded process termination;
- PDF, XLSX and DOCX operations;
- bounded public URL retrieval with private-network/SSRF protections;
- Windows desktop screenshots, window focus, keyboard, mouse and clipboard operations;
- Unity project discovery, Console, Editor bridge, hierarchy, scenes, selection, components, Game View, Play Mode, GameObjects and transforms;
- approval-result polling and local audit visibility.

## Legacy OAuth/public route

The OAuth-protected listener on port 47831 remains in the codebase for advanced/manual compatibility scenarios. It is not part of the normal RDC-X sign-in flow and does not replace the mandatory Secure MCP Tunnel gate in the Dashboard UI.

## Private data

The `.rdc` directory contains private local state, including the admin key, OAuth records, audit data, backups/trash, Tunnel metadata, and the DPAPI-protected Runtime API Key. It is gitignored and must not be uploaded or shared.

## Development and diagnostics

Use npm/Node maintenance commands:

```powershell
cd F:\rdc-x
npm.cmd run build
npm.cmd test
npm.cmd run doctor
node scripts\verify.mjs
```

## Primary references

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI tunnel-client: https://github.com/openai/tunnel-client
- ChatGPT developer mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/server

Chinese guide: [README.zh-CN.md](README.zh-CN.md).
