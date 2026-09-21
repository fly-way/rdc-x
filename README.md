# RDC-X / Personal computer MCP gateway

RDC-X is a self-hosted, single-computer MCP gateway for personal use. It provides controlled access to files, terminal sessions, desktop automation, documents, system information, and Unity Editor workflows without depending on Remote Desktop Commander. The project contains no account system, subscription logic, telemetry, or payment wall.

The recommended remote transport is **OpenAI Secure MCP Tunnel**. RDC-X keeps its tunnel-facing MCP listener on loopback and the official `tunnel-client` makes the outbound connection to OpenAI.

## Windows quick start

There is one user-facing Windows launcher:

```text
Start-All.cmd
```

Double-click it after each Windows boot. It:

1. checks Node.js 22+;
2. synchronizes npm dependencies;
3. runs the local setup/migration step;
4. builds the TypeScript server;
5. starts RDC-X in the background if it is not already running;
6. opens the local dashboard directly on the **Connections** page;
7. automatically starts the managed Secure MCP Tunnel when a saved Tunnel ID and Runtime API Key are available.

The other legacy `.cmd` launchers were removed. Service shutdown, Secure Tunnel start/stop, credential setup, approvals, and access policy are handled from the local dashboard.

Local dashboard:

```text
http://127.0.0.1:47832
```

The launcher opens it with a local admin-key fragment so the key does not need to be copied manually.

## First-time Secure MCP Tunnel setup

Install the official OpenAI `tunnel-client` and make it available in one of these locations:

```text
<repo>\tools\tunnel-client.exe
PATH
TUNNEL_CLIENT_PATH
```

Then run `Start-All.cmd`. On **Connections -> OpenAI Secure MCP Tunnel**, enter:

- **Tunnel ID**: `tunnel_` followed by 32 lowercase hexadecimal characters.
- **Runtime API Key**: a runtime key authorized to use the target tunnel.

Choose **Save and start Tunnel**.

RDC-X stores the Tunnel ID locally in `.rdc/secure-tunnel.json`. On Windows, the Runtime API Key is encrypted with **Windows DPAPI / CurrentUser** and stored in `.rdc/secure-tunnel-key.dpapi`. The plaintext key is not returned by the dashboard API and is not written to logs. The encrypted value is tied to the Windows user profile that saved it.

After the first successful setup, later boots normally require only:

```text
Start-All.cmd
```

RDC-X will attempt to restart the saved Secure MCP Tunnel automatically. The dashboard shows live/readiness state and provides a link to the tunnel-client UI at `http://127.0.0.1:47834/ui`.

The dashboard also provides **Delete saved Runtime API Key** if the key should no longer persist on the computer.

## Network layout

```text
ChatGPT / supported OpenAI surface
        |
OpenAI Secure MCP Tunnel
        |
official tunnel-client
        |
127.0.0.1:47833/mcp
        |
RDC-X
        |
Windows / files / desktop / Unity
```

Default local listeners:

- `127.0.0.1:47831` — legacy OAuth-protected MCP listener.
- `127.0.0.1:47832` — local admin dashboard.
- `127.0.0.1:47833` — loopback-only Secure MCP Tunnel target.
- `127.0.0.1:47834` — tunnel-client health/admin UI when the managed tunnel is running.

Port 47833 is intentionally separate from the legacy public/OAuth MCP listener and must not be forwarded to the public internet.

## ChatGPT workspace requirement

Secure MCP Tunnel is a transport; it does not bypass ChatGPT workspace policy. The target ChatGPT workspace must allow the relevant custom/developer MCP app and the tunnel must be available to that workspace. Where the current user cannot create/publish the app, a workspace administrator or other authorized operator must provision it.

Once the ChatGPT-side RDC-X app is published and points to the same tunnel, rebooting the Windows computer does not require recreating the app or tunnel. Run `Start-All.cmd` to restore the local side.

## Local approval model

Secure Tunnel calls still pass through RDC-X controls. By default, mutations may require local approval. The Connections page can temporarily switch the Secure Tunnel owner to **trusted for this process lifetime**, allowing mutation calls without per-action approval until trust is reset or RDC-X restarts.

The Access Policy page controls:

- read/write roots;
- file-write approval policy;
- terminal enablement;
- arbitrary system-process termination;
- desktop input/screenshot access;
- bounded public HTTP/HTTPS fetching;
- legacy OAuth callback hosts.

Terminal execution is **not an operating-system sandbox**. Approved commands run with the current Windows user's privileges and can access resources that user can access. Use a dedicated low-privilege Windows account or VM when stronger isolation is required.

## Included capabilities

RDC-X exposes 60+ MCP tools, including:

- bounded file listing, reading, writing, editing, moving, soft deletion, images, backups and recovery;
- literal filename/content search;
- managed terminal/process sessions with command policy controls;
- system information and guarded process termination;
- PDF, XLSX and DOCX read/write/edit operations;
- bounded public URL retrieval with private-network/SSRF protections;
- Windows desktop screenshots, window focus, keyboard, mouse and clipboard operations;
- Unity project discovery, console, Editor bridge, hierarchy, scene, selection, components, Game View screenshots, Play Mode, GameObjects, transforms and components;
- approval-result polling and local audit visibility.

## Legacy OAuth/public route

The OAuth-protected listener on port 47831 remains available for advanced/manual deployments. RDC-X no longer provides separate Windows `.cmd` launchers for the old Cloudflare Quick Tunnel flow. If the legacy path is deliberately required, the underlying Node maintenance scripts remain available for developers, but Secure MCP Tunnel is the default documented workflow.

## Private data

The `.rdc` directory contains private local state, including the admin key, OAuth records, audit data, backups/trash, Secure Tunnel metadata, and the DPAPI-protected Runtime API Key. It is gitignored and must not be uploaded or shared.

The Runtime API Key ciphertext is only useful to the same Windows user context that protected it, but it should still be treated as sensitive local state.

## Development and diagnostics

Use npm/Node commands instead of additional `.cmd` files:

```powershell
cd F:\rdc-x
npm.cmd run build
npm.cmd test
npm.cmd run doctor
node scripts\verify.mjs
```

`npm run doctor` checks the running local listeners. `node scripts/verify.mjs` runs TypeScript checks, automated tests, and running-instance diagnostics and writes `TEST-REPORT.txt` / `VERIFICATION.txt`.

## Primary references

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI public tunnel-client: https://github.com/openai/tunnel-client
- ChatGPT developer mode and MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/server

Chinese guide: [README.zh-CN.md](README.zh-CN.md).
