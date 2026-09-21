# RDC-X + OpenAI Secure MCP Tunnel

OpenAI Secure MCP Tunnel is the required remote transport for the normal RDC-X user workflow.

## Startup gate

Run:

```text
Start-All.cmd
```

RDC-X starts its local service, then opens a dedicated Secure Tunnel sign-in page. The Dashboard remains locked for that RDC-X process until the user provides both:

- Tunnel ID
- Runtime API Key

RDC-X then starts the official `tunnel-client` and waits for its readiness endpoint. The Dashboard is entered only after the tunnel reports **Ready**.

A saved Tunnel ID is prefilled on later runs. The Runtime API Key input uses standard password-manager autocomplete so the browser may fill it, but the user-facing startup gate still requires a Runtime API Key for each fresh RDC-X process.

## Credential storage

Tunnel ID:

```text
.rdc\secure-tunnel.json
```

DPAPI-protected Runtime API Key:

```text
.rdc\secure-tunnel-key.dpapi
```

On Windows, RDC-X uses the current user's DPAPI context. The plaintext Runtime API Key is not exposed by the Dashboard API and is not written to RDC-X logs.

## Architecture

```text
Start-All.cmd
    |
Local Secure Tunnel sign-in
    |
official tunnel-client
    |
OpenAI Secure MCP Tunnel
    |
127.0.0.1:47833/mcp
    |
RDC-X tools
```

The Secure Tunnel target stays loopback-only. Port 47833 must not be exposed through Cloudflare, a public reverse proxy, router port forwarding, or another ingress.

The official tunnel-client health/admin UI is available while running at:

```text
http://127.0.0.1:47834/ui
```

## Dashboard behavior

Once the tunnel is Ready, RDC-X unlocks the Dashboard. If readiness is later lost, the web UI returns to the Secure Tunnel gate.

The Connection page can:

- open tunnel-client UI;
- switch between per-action approval and temporary session-trusted mode;
- disconnect the tunnel and return to the credential gate.

Temporary trusted approval state is memory-only and is cleared on RDC-X restart.

## ChatGPT-side permissions

Secure MCP Tunnel is transport only. ChatGPT workspace permissions still apply. The target workspace must allow the relevant custom/developer MCP app and that app must use the same tunnel.

## Legacy listener

The OAuth-protected MCP listener on port 47831 remains available for advanced compatibility use, but it is not part of the normal RDC-X Dashboard login flow and does not bypass the mandatory Secure Tunnel gate.
