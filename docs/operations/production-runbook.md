# Aureon production runbook

This is the minimum operating procedure for the deployed application. A green
deployment is not proof that providers, queues, storage and generated output
are healthy together.

## Service objectives

- Target recovery time (RTO): 4 hours.
- Target recovery point (RPO): 24 hours until the database provider is
  configured and verified for a tighter point-in-time recovery window.
- A pipeline run is successful only when both views are stored, the
  consistency report has no blocking issue, and a version is recorded.

## Required production controls

- PostgreSQL automated backups or point-in-time recovery enabled at the
  provider.
- Upstash Redis and QStash configured; in-memory fallbacks are not acceptable
  on a multi-instance deployment.
- `ERROR_WEBHOOK_URL` points to an attended channel or incident service.
- Provider-side LLM spending limit plus `LLM_DAILY_CALL_LIMIT`.
- GitHub Actions branch protection requires CI, browser tests and Security.
- Vercel and provider credentials are project-owned, not personal shared keys.

## Daily checks

1. `GET /api/health` returns 200 and the deployed version.
2. No repeating `jobs.*.failure`, `error.report_failed`, budget-unavailable or
   database errors in the last 24 hours.
3. QStash has no repeatedly retried or dead messages.
4. LLM usage and GitHub request volume are inside their expected budgets.
5. A canary scope can reach `finalized` and records a version.

## Incident triage

1. Record the request id, session id, deployment and first failure time.
2. Identify the failed boundary: browser, route, queue, LLM, GitHub, Redis or
   PostgreSQL. Never paste a client brief into an incident ticket.
3. If spend is rising unexpectedly, disable the provider key before debugging.
4. If Redis is unavailable, paid calls fail closed. Restore Redis rather than
   bypassing the budget guard.
5. If QStash delivery fails, inspect signatures, `JOBS_BASE_URL`, deployment
   protection and signing-key rotation before manually retrying.
6. A duplicate delivery is expected; only a duplicate effect is an incident.

## Backup and restore drill

Run quarterly and after changing database providers.

1. Create a provider backup or `pg_dump` from production using a short-lived,
   read-only credential where supported.
2. Restore into a new isolated database, never over production.
3. Run migrations against the restored copy.
4. Verify counts for projects, versions, approvals, workspace memberships and
   audit records.
5. Open a restored project and export both document formats.
6. Record backup time, restore duration, data timestamp and any missing rows.
7. Delete the isolated restore according to the retention policy.

The RPO/RTO above are targets until a completed drill demonstrates them.

## Deployment rollback

1. Stop new pipeline runs if the release writes incompatible data.
2. Roll back the application deployment.
3. Database changes must use expand/migrate/contract. Do not remove a column in
   the same release that stops reading it.
4. If data repair is required, preserve an audit record and test the repair on
   a restored copy first.

## Release evidence

Attach these results to the handoff:

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`
- `npm test -- --coverage`
- `npm run evals:mock`
- `npm run build`
- `npm run audit`
- `npm run test:e2e`
- One production canary report with stage timings, provider/model, calls,
  GitHub request count, consistency status and stored version number.

The automated resilience evidence includes duplicate QStash delivery,
stale-lock rejection, provider retry/recovery, production budget failure,
remote-download network blocking and eight simultaneous isolated sessions.
