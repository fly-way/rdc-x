# RDC-X Startup Diagnostics Acceptance Checklist

This checklist defines the expected verification flow for the diagnostics UI.

## Local service chain

- [ ] RDC-X backend process is loaded
- [ ] Dashboard API listener is reachable
- [ ] Secure MCP Tunnel listener is reachable
- [ ] tunnel-client process is running
- [ ] tunnel-client reports live state
- [ ] Secure MCP Tunnel reports ready state

## MCP chain

- [ ] Local MCP health endpoint responds
- [ ] MCP initialize request succeeds
- [ ] MCP tools/list request succeeds

## Failure classification

The diagnostics page should separate:

1. Local RDC-X startup failures
2. Local MCP listener failures
3. tunnel-client failures
4. OpenAI Secure MCP Tunnel failures
5. ChatGPT MCP application connection failures

The page must not display Runtime API Keys, admin keys, or credential material.
