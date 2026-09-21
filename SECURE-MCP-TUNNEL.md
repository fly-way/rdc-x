# RDC-X + OpenAI Secure MCP Tunnel

This mode keeps the RDC-X MCP server private on the local computer and lets the official OpenAI `tunnel-client` carry MCP traffic outbound to OpenAI over HTTPS.

## Architecture

```text
ChatGPT / supported OpenAI surface
        |
OpenAI Secure MCP Tunnel
        |
official tunnel-client
        |
http://127.0.0.1:47833/mcp
        |
RDC-X tools -> Windows
```

The Secure Tunnel listener is a **separate loopback-only port** from the public/OAuth MCP listener. Do not forward port 47833 with Cloudflare, a reverse proxy, router port-forwarding, or another ingress.

## Important ChatGPT permission requirement

Secure MCP Tunnel is a transport, not a way to bypass ChatGPT workspace policy.

For ChatGPT web, the target workspace must allow developer-mode/custom MCP apps and the tunnel must be associated with that workspace. A workspace Member who cannot create a developer-mode app still needs an Admin/Owner (or an authorized developer where supported) to create/publish the app once.

RDC-X can prepare the local computer and run the tunnel runtime, but it cannot grant ChatGPT workspace permissions.

## Prerequisites

1. Run `Start.cmd`.
2. Open the local RDC-X dashboard.
3. In **Access policy**, enable **OpenAI Secure MCP Tunnel local endpoint** and save.
4. Obtain a Tunnel ID from:
   - https://platform.openai.com/settings/organization/tunnels
5. Create a restricted Runtime API key with Tunnels **Read + Use**:
   - https://platform.openai.com/settings/organization/api-keys
6. Install the official OpenAI `tunnel-client`.
   - Preferred: use the download shown in Platform Tunnels management.
   - Public source/releases: https://github.com/openai/tunnel-client
   - Put `tunnel-client.exe` in `F:\rdc_x\tools\`, add it to PATH, or set `TUNNEL_CLIENT_PATH`.

## Start on Windows PowerShell

```powershell
cd F:\rdc_x
$env:CONTROL_PLANE_TUNNEL_ID = "tunnel_0123456789abcdef0123456789abcdef"
$env:CONTROL_PLANE_API_KEY = "YOUR_RUNTIME_API_KEY"
.\Start-Secure-Tunnel.cmd
```

RDC-X does not print or persist `CONTROL_PLANE_API_KEY`. Closing the tunnel window stops the runtime.

The launcher invokes the official client approximately as:

```text
tunnel-client run
  --control-plane.tunnel-id=<tunnel id>
  --control-plane.api-key=env:CONTROL_PLANE_API_KEY
  --mcp.server-url=http://127.0.0.1:47833/mcp
  --health.listen-addr=127.0.0.1:47834
```

The tunnel-client UI opens on its loopback health server. Its `/readyz` endpoint should report ready before testing ChatGPT.

## Approval behavior

Secure Tunnel calls still use RDC-X local approval controls.

By default, writes, terminal commands, desktop actions, system-process actions and Unity mutations can require local approval.

In **Connections -> OpenAI Secure MCP Tunnel**, the owner can temporarily select **session trusted / no per-action approval**. That trust is memory-only and is cleared on RDC-X restart/revoke/reset.

## Public OAuth MCP remains available

Existing `/mcp` on port 47831 is unchanged and still requires RDC-X OAuth. Cloudflare Quick Tunnel remains a fallback for environments where a public HTTPS MCP endpoint is desired.

Secure MCP Tunnel uses the separate port 47833 specifically so the no-OAuth local tunnel target cannot accidentally become the same endpoint exposed through the existing public reverse-proxy flow.
