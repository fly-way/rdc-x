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

## Security requirements

Diagnostics must never expose:

- Runtime API Key
- admin key
- OAuth tokens
- private runtime files

Only status, timestamps, versions and safe counters should be displayed.
