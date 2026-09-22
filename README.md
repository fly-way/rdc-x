# RDC-X

RDC-X is a self-hosted MCP gateway that lets ChatGPT work with an authorized Windows computer through controlled local interfaces.

Current version: **0.2.0**

The primary connection path is **OpenAI Secure MCP Tunnel**. RDC-X keeps its MCP endpoint on the local loopback interface while the official `tunnel-client` creates the outbound connection to OpenAI.

## What RDC-X can do

RDC-X currently exposes 60+ MCP tools covering:

- files and directories: list, read, write, edit, move, search, backup, restore and soft delete;
- terminal and managed process sessions;
- Windows desktop screenshots, window focus, mouse, keyboard and clipboard operations;
- system information and guarded process termination;
- PDF, DOCX and XLSX reading/editing workflows;
- bounded public HTTP/HTTPS text retrieval with private-network protections;
- Unity Editor workflows such as project discovery, Console, hierarchy, scenes, selection, Game View, Play Mode, GameObjects, transforms and components;
- local approval requests, audit events and access-policy controls.

RDC-X is intended for a single authorized computer and personal/private use. It has no account system, subscription layer, payment logic or telemetry.

## Requirements

For the recommended Windows setup you need:

- Windows 10 or Windows 11;
- Node.js **22 or newer**;
- Git;
- the official OpenAI `tunnel-client`;
- an OpenAI Secure MCP Tunnel ID;
- a Runtime API Key with permission to use that tunnel;
- a ChatGPT workspace where the RDC-X custom/developer MCP app has been provisioned.

RDC-X resolves `tunnel-client` in this order:

```text
TUNNEL_CLIENT_PATH
<rdc-x>\tools\tunnel-client.exe
PATH
```

On Windows, `Start-All.cmd` automatically installs the latest official OpenAI `tunnel-client` into `<rdc-x>\tools\tunnel-client.exe` when that file is missing. The download comes from the official `openai/tunnel-client` GitHub release, and RDC-X verifies the release SHA-256 digest before installation.

## Install

Clone the repository and enter the project directory:

```powershell
git clone https://github.com/fly-way/rdc-x.git
cd rdc-x
```

The normal Windows workflow uses a single launcher:

```text
Start-All.cmd
```

It checks Node.js, installs/synchronizes npm dependencies, installs the official OpenAI `tunnel-client` locally when missing, prepares the local configuration, builds RDC-X, restarts the local service when necessary, and opens the browser.

To install or repair only `tunnel-client`, run:

```powershell
node scripts\install-tunnel.mjs
```

No system-wide installation or PATH change is required. The executable and release metadata are stored under `tools\`, which is gitignored.

## First run

Run:

```powershell
.\Start-All.cmd
```

The browser opens the Secure Tunnel sign-in page.

Enter:

- **Tunnel ID** — format: `tunnel_` followed by 32 lowercase hexadecimal characters;
- **Runtime API Key** — a key authorized to use that tunnel.

Choose **Connect and enter Dashboard**.

RDC-X starts `tunnel-client` and waits for the Secure MCP Tunnel to report **Ready**. The Dashboard is available only after the tunnel is ready.

### Credential handling

The Tunnel ID is stored locally at:

```text
.rdc\secure-tunnel.json
```

On Windows, the Runtime API Key is protected with Windows DPAPI for the current Windows user and stored as protected data at:

```text
.rdc\secure-tunnel-key.dpapi
```

The plaintext Runtime API Key is not returned by the Dashboard API and is not written to RDC-X logs.

The sign-in form also uses standard browser password-manager semantics, so the browser may offer to autofill the Runtime API Key.

## Daily use

After Windows starts:

```powershell
cd <path-to-rdc-x>
.\Start-All.cmd
```

The browser opens the local Secure Tunnel sign-in page. A previously saved Tunnel ID is prefilled. Enter or autofill the Runtime API Key, then connect.

Normal connection flow:

```text
Start-All.cmd
      |
RDC-X local service
      |
Secure Tunnel sign-in
      |
official tunnel-client
      |
OpenAI Secure MCP Tunnel
      |
ChatGPT RDC-X app
      |
RDC-X tools on this computer
```

## Local ports

Default local listeners:

| Port | Purpose |
| --- | --- |
| `127.0.0.1:47831` | OAuth MCP compatibility endpoint |
| `127.0.0.1:47832` | Local sign-in and Dashboard |
| `127.0.0.1:47833` | Secure MCP Tunnel target |
| `127.0.0.1:47834` | tunnel-client local health/UI |

The Secure Tunnel MCP endpoint on **47833 is loopback-only**. Do not expose it directly to the public internet.

## Dashboard

The local Dashboard provides:

- Secure Tunnel readiness and connection information;
- pending approval requests;
- authorized directory count;
- managed terminal sessions;
- recent audit events;
- file, terminal and desktop policy status;
- Tunnel approval mode;
- access-policy configuration;
- Chinese / English UI switching.

The selected UI language is stored in the browser.

If the Secure MCP Tunnel loses readiness, the browser returns to the Tunnel sign-in gate instead of continuing to present the computer as remotely available.

## Access policy

RDC-X uses explicit local policy controls.

The Dashboard can configure:

- authorized read-only or read/write roots;
- whether file modifications require local approval;
- terminal execution;
- system process control;
- desktop control;
- public network text retrieval;
- OAuth redirect hosts for compatibility scenarios.

Example authorized roots:

```text
rw | F:\UnityProject
ro | F:\Reference
```

An empty root list denies file access.

### Approval modes

The Secure Tunnel connection normally uses per-action approval for protected mutations.

The local owner can temporarily switch the current Tunnel session to trusted mode. Trusted mode is kept in memory only and is reset when RDC-X restarts.

### Terminal security

Terminal execution is **not an operating-system sandbox**. An approved command runs with the privileges of the Windows user running RDC-X.

For stronger isolation, run RDC-X under a dedicated low-privilege Windows account or inside a VM.

## ChatGPT setup

RDC-X uses Secure MCP Tunnel for transport, but ChatGPT workspace policy still applies.

The target ChatGPT workspace must have an RDC-X custom/developer MCP app configured for the same tunnel. If the current workspace member cannot create or publish that app, an authorized workspace administrator/operator must provision it.

The ChatGPT-side app and the OpenAI tunnel resource do not need to be recreated after a normal Windows restart.

## Updating RDC-X

From the project directory:

```powershell
git pull
.\Start-All.cmd
```

`Start-All.cmd` rebuilds the project and restarts the running local backend so the browser UI and backend stay on the same version.

## Troubleshooting `spawn tunnel-client ENOENT`

This error means Windows could not find the `tunnel-client` executable. It is not a Tunnel ID or Runtime API Key validation error.

From the RDC-X directory, run:

```powershell
node scripts\install-tunnel.mjs
.\tools\tunnel-client.exe --version
```

Then restart `Start-All.cmd` and connect again. If you intentionally keep `tunnel-client.exe` elsewhere, set `TUNNEL_CLIENT_PATH` for that RDC-X process to the full executable path.

## Diagnostics

Useful development/diagnostic commands:

```powershell
npm.cmd run build
npm.cmd test
npm.cmd run doctor
node scripts\verify.mjs
```

Local logs and private runtime state are stored under `.rdc`.

Do not upload or share that directory. It can contain the local admin key, audit data, Tunnel metadata and DPAPI-protected credential material.

## Project layout

```text
src/                  TypeScript server and MCP services
public/               Local sign-in and Dashboard UI
scripts/              setup, launch and diagnostic scripts
test/                 automated tests
tools/                optional tunnel-client location
.rdc/                 private local runtime state (gitignored)
Start-All.cmd          Windows entry point
```

## Documentation

- [中文说明](README.zh-CN.md)
- [Secure MCP Tunnel notes](SECURE-MCP-TUNNEL.md)

External references:

- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- OpenAI tunnel-client: https://github.com/openai/tunnel-client
- ChatGPT developer mode / MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- MCP: https://modelcontextprotocol.io/
