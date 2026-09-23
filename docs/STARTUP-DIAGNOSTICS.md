# RDC-X Startup Diagnostics

## Purpose

RDC-X can be healthy at one layer while failing at another layer. The startup diagnostics should separate:

1. Local backend startup
2. Dashboard availability
3. MCP listener availability
4. tunnel-client process state
5. Secure MCP Tunnel readiness
6. ChatGPT MCP invocation path

## Recommended checks

| Check | Expected |
| --- | --- |
| Node backend | Running and version reported |
| Dashboard API | `127.0.0.1:47832` responds |
| OAuth MCP endpoint | `127.0.0.1:47831` responds when enabled |
| Secure MCP listener | `127.0.0.1:47833/mcp` accepts tunnel traffic |
| tunnel-client health | `127.0.0.1:47834` healthy |
| Control plane | Tunnel live |
| Tunnel state | Ready |
| Authorization | Expected client authorization count |

## Failure interpretation

- Backend OK + tunnel not ready: check tunnel-client and credentials.
- Tunnel ready + MCP unavailable: check RDC-X MCP listener.
- Local MCP OK + ChatGPT call failure: check Secure MCP Tunnel / workspace MCP app binding.
- ChatGPT receives rate limits: inspect tunnel request rate and retry behavior.

## Diagnostics API

The authenticated local Dashboard exposes `GET /api/diagnostics`. It returns:

- Seven component checks for the backend, Dashboard API, MCP listener, tunnel-client, Secure Tunnel, MCP initialize and `tools/list`
- Four independent layer results for RDC-X, Tunnel, MCP and OpenAI upstream
- The latest 25 real MCP requests with time, listener, JSON-RPC method, HTTP status, duration and a safely truncated error
- Safe counters for authorized clients and discovered MCP tools

The MCP self-test uses a private in-memory probe marker. Synthetic `/health`, `initialize` and `tools/list` calls are excluded from recent request history and from the normal POST execution rate limit.

`GET /mcp` is the optional Streamable HTTP SSE probe. A stateless RDC-X listener returns `405 Method Not Allowed`, as permitted by the protocol. These probes do not consume the POST execution request budget, preventing a healthy probe loop from turning into a misleading `429`.

## Dashboard and CLI

The **System diagnostics** page is available from the Dashboard navigation. A compact version is also available on the Secure Tunnel sign-in screen so tunnel failures can be inspected before the Dashboard unlocks.

Run `npm run doctor` while RDC-X is running for the terminal summary. A healthy result ends with:

```text
RDC-X Doctor

[OK] Backend
[OK] Dashboard
[OK] MCP
[OK] Tunnel
[OK] Tools

Healthy
```

## Security requirements

Diagnostics must never expose:

- Runtime API Key
- admin key
- OAuth tokens
- private runtime files

Only status, timestamps, versions and safe counters should be displayed.
