# RDC-X Startup Diagnostics Acceptance Checklist

This checklist defines the expected verification flow for the diagnostics UI.

## Local service chain

- [x] RDC-X backend process is loaded
- [x] Dashboard API listener is reachable
- [x] Secure MCP Tunnel listener is reachable
- [x] tunnel-client process is running
- [x] tunnel-client reports live state
- [x] Secure MCP Tunnel reports ready state

## MCP chain

- [x] Local MCP health endpoint responds
- [x] MCP initialize request succeeds
- [x] MCP tools/list request succeeds

## Failure classification

The diagnostics page should separate:

1. Local RDC-X startup failures
2. Local MCP listener failures
3. tunnel-client failures
4. OpenAI Secure MCP Tunnel failures
5. ChatGPT MCP application connection failures

The page must not display Runtime API Keys, admin keys, or credential material.
