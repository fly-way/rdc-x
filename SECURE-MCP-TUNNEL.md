# RDC-X + OpenAI Secure MCP Tunnel

RDC-X manages the OpenAI Secure MCP Tunnel directly from its loopback dashboard.

## Daily workflow

On Windows, run only:

```text
Start-All.cmd
```

It starts RDC-X, opens the local dashboard on **Connections**, and automatically restores the managed tunnel when credentials have already been saved.

There is no separate `Start-Secure-Tunnel.cmd`.

## First-time setup

1. Install the official OpenAI `tunnel-client`.
2. Place it at `tools\tunnel-client.exe`, add it to `PATH`, or set `TUNNEL_CLIENT_PATH`.
3. Run `Start-All.cmd`.
4. In **Connections -> OpenAI Secure MCP Tunnel**, enter the Tunnel ID and Runtime API Key.
5. Choose **Save and start Tunnel**.
6. Wait for the dashboard to report **Ready / 可用**.

The tunnel target is:

```text
http://127.0.0.1:47833/mcp
```

The official `tunnel-client` health/admin UI is available while running at:

```text
http://127.0.0.1:47834/ui
```

## Credential persistence

Tunnel ID:

```text
.rdc\secure-tunnel.json
```

Runtime API Key on Windows:

```text
.rdc\secure-tunnel-key.dpapi
```

RDC-X encrypts the Runtime API Key with Windows DPAPI using `CurrentUser`. The dashboard never reads the saved plaintext back. The secret is decrypted only when RDC-X needs to launch `tunnel-client` for the current Windows user.

The Connections page can delete the stored Runtime API Key at any time.

## Architecture

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
```

Port 47833 is loopback-only and must not be exposed through a public reverse proxy.

## Approval behavior

Secure Tunnel calls retain RDC-X local approval controls. The owner may temporarily switch the Secure Tunnel connection to trusted mode in the local dashboard. That trust is memory-only and does not persist across an RDC-X restart.

## ChatGPT-side permissions

Secure MCP Tunnel is transport only. ChatGPT workspace permissions still apply. The target workspace must allow the relevant custom/developer MCP app and the app must use the same tunnel. An authorized workspace operator may need to create or publish that app once.

## Legacy listener

The OAuth-protected MCP listener on port 47831 remains available for advanced/manual compatibility use. It is separate from the Secure Tunnel listener.
