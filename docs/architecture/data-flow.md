# Aureon data flow

1. The browser submits a brief to a validated route. The session is owned by a
   signed cookie or authenticated workspace membership.
2. A durable QStash job runs extraction, optional GitHub enrichment,
   deterministic scoring and clarification generation.
3. GitHub search metadata is BM25-ranked. Only deeply scored repositories over
   the evidence threshold can corroborate modules or appear as references.
4. Redis provides locks, budgets, rate limits, cache and progress signalling;
   PostgreSQL stores durable projects, versions, approvals and audit history.
5. Client and engineer views are generated in parallel. A deterministic
   consistency pass restores validated modules, aligns milestones and applies
   a confidence cap when a hard constraint still conflicts.
6. The completed output is stored as an immutable version. Exports and share
   links are derived from that stored output.

External processors receive only what their task needs:

| Processor         | Data sent                                               |
| ----------------- | ------------------------------------------------------- |
| Main LLM provider | Brief, extracted scope context and answers              |
| Fast LLM provider | Target description and bounded public README text       |
| GitHub            | Search queries and public repository API requests       |
| QStash            | Job type, session UUID and lock token; no brief         |
| Error webhook     | Error shape, route/stage, request/session ids; no brief |
| Email provider    | Magic-link or approval notification recipient/content   |

Raw briefs are removed according to workspace retention. Generated versions,
approval history and audit entries follow their separate product retention
policy and must not be assumed deleted with the raw input.
