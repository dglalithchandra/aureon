# Aureon threat model

## Protected assets

- Client briefs, answers and generated scopes.
- User identities, workspace membership and approval decisions.
- LLM, GitHub, email, Redis, QStash and database credentials.
- Document versions and audit history.
- Model budget and provider quota.

## Trust boundaries

1. Browser to Next.js routes.
2. Next.js to PostgreSQL and Redis.
3. Application to LLM providers.
4. Application to GitHub, email and remote workspace-logo hosts.
5. QStash to the signed internal job endpoint.
6. Generated documents and share links leaving the workspace.

## Principal threats and controls

| Threat                                | Existing control                                                               | Verification                    |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------- |
| Broken object authorization           | Central access subject and workspace role checks                               | Integration authorization suite |
| Forged background job                 | Current/next QStash signature verification                                     | Job endpoint tests              |
| Duplicate queue delivery              | Job claim and session lock ownership                                           | Duplicate delivery test         |
| LLM quota or cost abuse               | Route limits, global daily counter, production fail-closed policy              | Budget tests                    |
| Prompt injection in briefs or READMEs | Delimited untrusted text, strict tool schema, no model tools with side effects | Injection eval cases            |
| Malicious remote logo / SSRF          | HTTPS-only pinned public address, blocked private ranges, streamed byte cap    | Public-download tests           |
| Secret disclosure                     | Ignored env files, structured logs without content, GitHub secret scanning     | Gitleaks workflow               |
| Dependency compromise                 | Lockfile, production audit, Dependabot, CodeQL                                 | Security workflow               |
| Fabricated repository evidence        | Server-built GitHub references and minimum similarity threshold                | GitHub reference tests/evals    |
| Contradictory generated documents     | Deterministic reconciliation and hard-constraint confidence cap                | Output consistency tests        |

## Residual risks

- LLM providers receive the brief required to perform generation. Provider
  retention and regional processing are contractual/configuration controls,
  not guaranteed by this repository.
- Draft evaluation labels are not validated accuracy evidence.
- `ERROR_WEBHOOK_URL` is useful only when somebody owns and monitors it.
- Backups and provider spending caps must be configured outside the codebase.
- A share token is a bearer credential; recipients can forward it until expiry.

Review this document when a provider, authentication method, storage system or
new external fetch is introduced.
