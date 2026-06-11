# Security model

Threat model: this is a single-credential demo that surfaces an LLM-driven
search over a content library. The main risks are (1) prompt injection through
the free-text query, (2) cost-exhaustion abuse of the LLM/embedding endpoints,
(3) credential and data leakage. The mitigations below map to the OWASP Top 10
for LLM Applications.

| OWASP LLM risk | Mitigation in this repo |
|---|---|
| **LLM01 Prompt injection** | Every user query is wrapped in a delimited `<query>` / `<editor_query>` tag inside the model input. System prompts (`lib/extract.ts`, `lib/judge.ts`) explicitly tell the model to treat the contents as data, refuse to follow instructions inside, and never break out of the JSON schema. Output is constrained by `response_format: { type: "json_schema", strict: true }` with closed-set enums for every structured field, so the model cannot emit a payload that bypasses the filter pipeline. |
| **LLM02 Insecure output handling** | The LLM never produces SQL, HTML, or code that we execute. Filter values returned by the model are checked against the enum on both sides (TypeScript narrowing + Postgres column type). Conversation summaries are rendered as React text, never `dangerouslySetInnerHTML`. |
| **LLM03 Training data poisoning** | We do not fine-tune or feed user data back into the model. |
| **LLM04 Model denial of service** | (1) Per-IP sliding-window rate limit (`SEARCH_RATE_LIMIT_PER_MIN`, default 30/min) and global daily cap (`SEARCH_DAILY_GLOBAL_CAP`, default 10000/day) via Upstash in `proxy.ts`. (2) Query length capped at 500 chars (`MAX_QUERY_LEN`). (3) Single LLM extract + one batched judge call per search — no recursive agent loops. |
| **LLM05 Supply chain** | Provider SDKs (`openai`, `@qdrant/js-client-rest`, `@neondatabase/serverless`, `@upstash/*`) are pinned in `web/package.json`. No third-party prompt libraries. |
| **LLM06 Sensitive information disclosure** | Query log stores the query text, latency, token counts, and cost — no IPs, no cookies, no LLM outputs. The `demo_auth` cookie is `HttpOnly`, `SameSite=lax`, `Secure` over HTTPS, and the password compare is constant-time. Telemetry log writes are fire-and-forget so a query never blocks on logging. |
| **LLM07 Insecure plugin design** | Only one tool surface (`/api/search/sessions`). MCP server (`/api/mcp`) is read-only and optionally gated by `MCP_TOKEN`. |
| **LLM08 Excessive agency** | The model returns *structured* judgments (filters, score, reason). The application — not the model — issues the database query, applies the filter, and surfaces results. The model cannot delete data, escalate filters, or invoke arbitrary code. |
| **LLM09 Overreliance** | Every result card shows the LLM's per-result `judgeScore` + `reason`. The `/eval` page maintains a labeled gold set so regressions surface against precision@5 / recall@10 / MRR over time. |
| **LLM10 Model theft** | Public API key for OpenAI is server-side only (no `NEXT_PUBLIC_` exposure). |

## Cost ceilings

- **Per-query cost** logged into `query_log` (token counts × current gpt-4o-mini pricing).
- **Daily ceiling** (`DAILY_COST_CEILING_USD`, default $5) summed across the rolling 24h. When exceeded, `/api/search/sessions` returns HTTP 429.
- **Per-IP rate limit** (`SEARCH_RATE_LIMIT_PER_MIN`) + **global daily cap** (`SEARCH_DAILY_GLOBAL_CAP`) enforced in `proxy.ts` before the route handler runs.

## Auth

- Single shared password set via `DEMO_PASSWORD`. The cookie value is the literal password; the proxy compares it in constant time. Suitable for a single-user demo. Replace with proper auth (SSO, NextAuth, Clerk, etc.) for any multi-user deployment.
- `proxy.ts` matcher covers everything except static assets and the `/login` / `/api/login` flow.

## Database

- All queries use the Neon serverless tagged-template SQL syntax, which parameterizes every value (no string concatenation).
- Schema (`ingest/schema.sql`) constrains taxonomies via `text` columns plus app-level enum checks. A future hardening step would add Postgres `CHECK` constraints mirroring the closed sets in `ingest/topics.py`.
- Database connection strings are server-side only.

## What is NOT covered

- No CSRF token on `/api/login` — acceptable for a single-credential demo behind a single domain, NOT acceptable for production multi-user auth.
- No automated key rotation. If a key leaks, rotate manually via Vercel env settings.
- No WAF/CDN-level DDoS protection beyond what Vercel ships by default. The rate limit catches single-IP abuse, not distributed.
- No audit log of who labeled what in `/eval`. Demo-grade.

## Reporting

This is a portfolio project. If you find an issue, open a GitHub issue or DM the maintainer.
