# RDC-X vs Remote Desktop Commander

This document tracks the replacement target for RDC-X v0.3. It compares capability families rather than preserving Desktop Commander's argument schema.

| Capability | Remote Desktop Commander baseline | RDC-X v0.3 |
| --- | --- | --- |
| Health / identity | device list, identity, ping | `ping`, `who_am_i`, `list_devices`, `get_capabilities` |
| Authorized filesystem | read/write/list/move/edit | read/write/list/edit plus file & directory copy/move, soft delete, recovery restore |
| Search | filename/content search | literal or regex filename/content search, glob filters, context lines, generated/hidden controls |
| Terminal | managed commands and interactive sessions | managed sessions, explicit cwd, timeout, interactive stdin, PowerShell/pwsh/cmd/sh/bash selection |
| Process inspection | list/kill processes | system info, list processes, guarded kill, managed-session ownership |
| Desktop | not part of the current generic RDC connector surface | displays, screenshots (display/region/window), windows, focus, cursor, mouse, scroll, keyboard, clipboard |
| Public network text | not part of the generic connector surface | bounded HTTP/HTTPS fetch with private-network/SSRF protections |
| PDF | generic file/PDF support | text extraction, create, merge, delete pages, extract pages, insert PDF |
| Excel | generic spreadsheet handling | explicit XLSX read/create/range edit |
| DOCX | generic document handling | explicit DOCX read/create/exact visible-text edit |
| Unity Editor | separate/manual workflows | project discovery, bridge install, hierarchy, scenes, Game View, objects/components, serialized properties, assets, prefabs |
| Recovery | implementation-specific backups | explicit private recovery store with list/restore tools |
| Access policy | remote config surface | local Dashboard plus `set_config_value` with mandatory local approval |
| Transport | Remote Desktop Commander relay | OpenAI Secure MCP Tunnel with loopback-only MCP target |
| Audit / approvals | connector-specific | per-authorization audit trail, local one-shot approvals, optional in-memory trusted session |

## Intentional differences

RDC-X does **not** preserve legacy Desktop Commander tool signatures. v0.3 has a versioned native schema and CI tests for the important tool contracts.

RDC-X also does not expose product-specific onboarding/feedback tools from Desktop Commander. Those are not computer-control capabilities.

Remote shutdown is intentionally not part of the v0.3 MCP surface. Stopping the local service is an owner-side Dashboard operation so a remote call cannot silently destroy its own result channel.

## Security model

Authorized roots define ordinary filesystem access, including the RDC-X source tree when the owner explicitly authorizes its parent directory. Private RDC-X runtime state (`.rdc`), common credential locations/files, symlink/junction escapes, hard-link escapes and the active tunnel-client executable remain protected.

Trusted-session mode can skip ordinary mutation approvals, but access-policy changes still require explicit local approval.
