# Security Policy

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |

## Reporting a vulnerability

Please report security issues privately: open a GitHub Security Advisory
("Report a vulnerability" on the Security tab) rather than a public issue.
You should get a response within 7 days.

## Scope and honest threat model

context-ledger is a local developer tool. Please understand what it does and
does not protect before trusting it with sensitive conversations:

**Data at rest is plaintext.** Conversation mirrors, block summaries, and
originals are stored as unencrypted JSON files under the data directory
(`~/.context-ledger` by default). Anyone with read access to your user
account can read them. If that is unacceptable for your threat model, do not
use context-ledger on confidential material, or place the data directory on
encrypted storage (e.g. an encrypted volume or home directory).

**No authentication by design.** The HTTP transport binds to `127.0.0.1` and
implements the MCP handshake (session ids) but no auth. When exposing it
beyond localhost (ChatGPT Desktop via tunnel/reverse proxy), you are
responsible for the exposure surface:

- Prefer short-lived tunnels (e.g. `cloudflared --url`) over permanent
  public endpoints, and tear them down when done.
- Put auth (reverse-proxy basic auth, mTLS, or an authenticating proxy) in
  front of the server if the endpoint is shared or long-lived.
- Anyone who can reach the HTTP endpoint can read and write every ledger.

**Hook/plugin surfaces inherit host trust.** The Claude Code / Cursor hooks
and the OpenClaw / Hermes plugins run with the permissions of their host and
write to the shared data directory. Install them from this repository only,
and review the code — they are intentionally small.

**Out of scope:** vulnerabilities in the host applications themselves
(Claude Code, Hermes, ChatGPT, etc.) — report those upstream.

Thank you for reporting responsibly.
