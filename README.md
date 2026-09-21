# RDC-X / Personal computer MCP gateway

A single-user, single-computer implementation of the core Remote Desktop Commander workflow. This is an independent project, not an official Desktop Commander product. No accounts, subscriptions, license checks, payment modules, telemetry, or OpenAI API calls are implemented in the application.

## Start on Windows

Double-click `Start.cmd`. This checks dependencies, protects local state, compiles TypeScript, starts the local process and opens the dashboard. `Dashboard.cmd` reopens it; `Stop.cmd` shuts it down and terminates managed process trees. No auto-start, firewall rules or system services are installed. Node.js 22+ is required.

Default listeners: MCP `127.0.0.1:47831`, admin `127.0.0.1:47832`. Initial authorized root: `workspace`. Terminal is disabled. All file mutations require local approval. Add your own existing project directories in the dashboard, with read-only or read-write access. Never authorize the entire machine unnecessarily.

## Connect ChatGPT

The web app needs a reachable remote MCP route; localhost alone is insufficient. The project's standard route is **HTTPS + OAuth + Streamable HTTP (JSON responses)**. Your ChatGPT plan/workspace must allow custom MCP apps and write actions. The app contains no billing, but does not change OpenAI or hosting-provider plan requirements.

1. Start RDC-X locally. Install Cloudflare's `cloudflared` yourself using `winget install --id Cloudflare.cloudflared --exact`, or place an official binary under `tools/cloudflared.exe`.
2. Run `Start-Tunnel.cmd`. This intentionally opens a public temporary HTTPS endpoint to **47831 only**. It updates the public origin through the authenticated local API. Do not forward 47832.
3. In ChatGPT's custom-app/developer-mode UI, use the printed `https://.../mcp` URL and OAuth authentication. DCR is available; fixed client secrets are not needed when the client selects public-client auth.
4. When the OAuth page displays a six-digit code, open the LOCAL dashboard, compare the code, client name, redirect and scopes, and approve the matching request. The page redirects back to ChatGPT. Decline requests you did not initiate.
5. Scan tools and test `ping`, then `list_directory` for the authorized workspace. Write operations return `approval_required`. Approve locally; ChatGPT retrieves the completed result with `get_request_result`.

Quick Tunnel URLs change when restarted; reconnect using the new URL. Changing the public origin revokes existing authorizations. For stable use, configure a named tunnel or an HTTPS reverse proxy. This project never automatically installs or opens a tunnel. Cloudflare Quick Tunnels are development tools and do not support SSE; this server deliberately uses stateless JSON Streamable HTTP. An official OpenAI Secure MCP Tunnel is another possible deployment path, but it requires separate account permissions, tunnel configuration and attention to OAuth issuer reachability; it is not configured by these scripts.

## Included tools (25)

Health/device/policy: `ping`, `list_devices`, `get_config`.

Files: `list_directory`, `read_file`, `read_multiple_files`, `get_file_info`, `read_image`, `write_file`, `edit_block`, `create_directory`, `move_file`, `delete_file`.

Search: `start_search`, `get_more_search_results`, `stop_search`, `list_searches`.

Terminal: `start_process`, `read_process_output`, `interact_with_process`, `list_sessions`, `force_terminate`.

Control/observability: `get_request_result`, `get_usage_stats`, `get_recent_tool_calls`.

Search is **literal substring** matching, not regex or glob. It skips binary/large files and common caches, limits recursion and work, and reports truncation. Text reads support line pagination. Terminal reads support character offsets and report discarded output. Regular-file moves refuse overwrites. Deletion is soft deletion of regular files only; no recursive delete tool is exposed. Images are read from disk, not screen-captured.

## Security model

- Public MCP requests require opaque OAuth bearer tokens. PKCE S256, exact registered redirect matching, resource binding, expiring one-use codes, rotating refresh tokens, replay-family revocation and local consent are implemented.
- Default callback hosts: `chatgpt.com`, `chat.openai.com`. Add exact additional hosts locally only after verifying the client. Loopback callbacks are disabled in normal setup and enabled only inside test fixtures.
- Admin and MCP run on separate loopback listeners. Admin API requires a separate key, exact Host and Origin checks, and is never mounted on the MCP listener. Keys are not sent to ChatGPT or printed by launch scripts. Dashboard access uses a fragment that is removed from browser history and held in session storage.
- File paths are checked against explicit roots and canonical paths. Traversal, symlinks/junctions, hard-linked files, common credential paths and application self-modification are refused. Windows UNC/device paths and ADS are refused. Empty roots deny access.
- Mutations are recorded in a local approval queue; approval executes the captured operation once. Expired/rejected approvals cannot execute. Terminal stdin is separately approved. Configuration and approvals are not MCP tools.
- **Terminal execution is not an operating-system sandbox.** Commands run as the service's OS user and can access files/networks outside the file-tool roots, spawn descendants, or read data they are permitted to access. Directory checks constrain file tools and the initial working directory, not arbitrary programs. Do not approve unfamiliar commands or use elevation. Use a dedicated low-privilege account, VM or container for isolation. Process output may contain secrets if a command prints them.
- Path checks are not a defense against a malicious local administrator or concurrent adversarial filesystem manipulation. This is a personal-use implementation, not an externally audited enterprise security product.
- Pause rejects new MCP calls, cancels pending requests/searches and stops managed process trees. It cannot undo operations already completed or retract information already sent to ChatGPT. A process can potentially escape ordinary process-tree management; use OS isolation for stronger guarantees.
- Audit events avoid token, file-body and stdin-body logging, but may include paths and error messages. Approval previews and results are held in memory. `.rdc` contains the local admin key, hashed OAuth token records, backups, trash and audit logs. Do not upload or share this directory.

Backups and soft-deleted files are under `.rdc/backups` and `.rdc/trash`. Restore manually on the computer after reviewing the audit trail. Backups/trash are not automatically purged and need owner-managed disk-space retention. Audit logs rotate at approximately 5 MiB plus one previous file.

## Development and checks

`npm run setup`, `npm run build`, `npm test`, `npm run doctor`.

`src/`: policy, path guarding, consent queue, files, searches, processes, OAuth, MCP tools, HTTP listeners.
`public/`: no-framework bilingual local dashboard.
`scripts/`: Windows launch/stop, setup, diagnostics, optional tunnel.
`test/`: file security, approval semantics, terminal behavior, OAuth, HTTP and SDK integration tests.

Tests use temporary directories and temporary ports; they do not change the running instance's roots or enable its terminal. The unit/integration suite is not a substitute for penetration testing or a real ChatGPT account-linking test.

## Known scope limits

Single machine per instance; no cloud relay fleet, mobile agent, tray executable, RDP/video stream, mouse/keyboard UI automation, OCR, PDF/Office conversion, arbitrary system-process control, or full-text binary-document search. The terminal can run owner-approved tools already installed on the computer. The web dashboard is the local control UI; this is not a signed native Windows installer.

## Primary references (checked 2026-09-21)

- OpenAI custom MCP apps: https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt
- OpenAI authentication: https://developers.openai.com/plugins/build/auth
- OpenAI Secure MCP Tunnel: https://developers.openai.com/api/docs/guides/secure-mcp-tunnels
- MCP authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- MCP TypeScript SDK: https://ts.sdk.modelcontextprotocol.io/server
- Cloudflare Quick Tunnels: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/

References document protocol and product requirements; they do not certify this implementation.

## Portable tunnel installer and verification

On Windows, `Install-Tunnel.cmd` downloads the official cloudflared release into `tools`, verifies its SHA-256 digest, and does not start a tunnel or install an OS service. `Start-Tunnel.cmd` explicitly starts the public route.

`node scripts/verify.mjs` runs the TypeScript build, automated tests (including repeatable Windows ACL setup), and health checks against the running local instance. Results are saved to `TEST-REPORT.txt` and `VERIFICATION.txt`.

Chinese guide: `README.zh-CN.md`.
