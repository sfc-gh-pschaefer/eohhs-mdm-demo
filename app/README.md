# Entity Resolution Application

A single Next.js application deployed with Snowflake App Runtime. It replaces the earlier two-service Snowpark Container Services deployment: there are no Dockerfiles, no compute pool, no image registry, and no separate API service.

## What the deploy skill changes

Two files, both generated from the discovery plan and the domain context:

| File | Generated from |
|------|----------------|
| `lib/config.ts` | `entity-resolution-plan.json` — database, schemas, tables, entities, columns, rules |
| `lib/terminology.ts` | `domain-context.json` — user-facing nouns |

Nothing else hard-codes a database, schema, table, column, or entity name. Adding a third entity means adding an entry to `config.entities`; every page, nav item, and route handler picks it up.

`snowflake.yml` also needs the deploy destination filled in, or run `snow app setup` and let the CLI resolve it from your account defaults.

## Structure

```
app/
  page.tsx                    Account-level summary across all entities
  [entity]/matching           Golden record explorer
  [entity]/alerts             Review queue
  [entity]/logic              Rule definitions and configured thresholds
  [entity]/readiness          Per-column quality dimensions
  [entity]/quality            Data Metric Function results
  api/summary                 Cross-entity counts
  api/[entity]/...            One route handler per data need
components/
  Sidebar.tsx                 Navigation, generated from the entity config
  ui.tsx                      Server-safe presentational primitives
  charts.tsx                  ECharts wrappers (client only)
  views/                      One view component per page
lib/
  config.ts                   Deployment binding (generated)
  terminology.ts              Display nouns (generated)
  snowflake.ts                Connection, token handling, identifier validation
  queries.ts                  All SQL
  api.ts                      Client-side fetch layer
  types.ts                    Shared response shapes
```

## Data access

Queries run through `querySnowflake()` in `lib/snowflake.ts`. Inside a deployed Application Service there are no credentials: Snowflake injects a rotating OAuth token at `/snowflake/session/token`, read fresh per connection.

Two modes, chosen per query:

- **Owner's rights** (default) — runs as the service role. Used for counts, aggregates, and metric results, so every user sees the same figures.
- **Caller's rights** — runs as the signed-in user, so masking policies, row access policies, and their own grants apply. Used for anything showing individual records: golden records, candidate pairs, the review queue.

Caller's rights runs under restricted caller's rights, so the service owner also needs caller grants:

```sql
GRANT CALLER USAGE ON DATABASE <db> TO ROLE <service_owner_role>;
GRANT CALLER USAGE ON SCHEMA <db>.<schema> TO ROLE <service_owner_role>;
GRANT CALLER SELECT ON ALL TABLES IN SCHEMA <db>.<schema> TO ROLE <service_owner_role>;
```

Without them, record-level pages return an authorization error while aggregate pages keep working.

The review queue's decide route also writes under caller's rights, so approve/reject decisions are attributed to the real steward. That needs its own, more targeted grants:

```sql
GRANT CALLER USAGE ON SCHEMA <db>.GOVERNANCE TO ROLE <service_owner_role>;
GRANT CALLER INSERT ON TABLE <db>.GOVERNANCE.STEWARD_DECISIONS TO ROLE <service_owner_role>;
GRANT CALLER UPDATE, DELETE ON TABLE <db>.INTEGRATION.<PREFIX>_MATCH_RESULTS TO ROLE <service_owner_role>;
```

Note that the readiness and quality surfaces deliberately use owner's rights: they report counts and percentages, never values. A steward can therefore assess completeness of a sensitive column without being able to read it.

## SQL safety

Every user-supplied value is a bound parameter. Identifiers cannot be bound, so table and column names are interpolated from `lib/config.ts` and validated by `assertIdentifier()` first, which rejects anything that is not a plain optionally-qualified identifier. A malformed config fails loudly instead of producing broken or unsafe SQL.

The FastAPI service this replaced interpolated search terms and filter values straight into SQL. That was an injection path and none of it is carried over.

## Local development

This template ships without a lockfile. `npm install` generates one on first run. Commit it in your project so later rebuilds are reproducible, and you can then switch `app.yml` from `npm install` to `npm ci`.

App Runtime injects a token that does not exist on a laptop, so local runs fall back to environment variables:

```bash
export SNOWFLAKE_ACCOUNT=<account>
export SNOWFLAKE_USER=<user>
export SNOWFLAKE_AUTHENTICATOR=externalbrowser   # or set SNOWFLAKE_PASSWORD
export SNOWFLAKE_ROLE=<role>
export SNOWFLAKE_WAREHOUSE=<warehouse>

npm install
npm run dev
```

Caller's rights has no meaning locally, since there is no end user distinct from the developer, so every query runs as the configured role.

```bash
npm run typecheck   # tsc --noEmit
npm run build       # production build
```

## Deploying

```bash
snow app setup     # writes snowflake.yml from your account defaults
snow app deploy    # upload, build, deploy; prints the live URL
snow app open --print-only
```

Redeploys upgrade the service in place and the URL does not change. If a deploy fails partway, retry the failed phase with `--upload-only`, `--build-only`, or `--promote-only`.

Sharing needs the app in a standard database, not a personal one:

```sql
GRANT USAGE ON DATABASE SNOWFLAKE_APPS TO ROLE <role>;
GRANT USAGE ON SCHEMA SNOWFLAKE_APPS.PUBLIC TO ROLE <role>;
GRANT USAGE ON APPLICATION SERVICE SNOWFLAKE_APPS.PUBLIC.<app_name> TO ROLE <role>;
```

## Constraints worth knowing

- App Runtime is in public preview.
- The container must listen on port 8080. `npm run start` sets this.
- The build phase reaches only `registry.npmjs.org` and Google Fonts by default. That covers everything here. Anything more needs an external access integration via `build_eai`.
- `snowflake-sdk` is a native module, kept out of the webpack bundle by `serverExternalPackages`.
- The quality page needs the `SNOWFLAKE.DATA_QUALITY_MONITORING_VIEWER` application role to read scheduled metric results. Without it the gate results still show, but the monitoring table reads empty.

## Behaviour when the pipeline is incomplete

A missing table means that pipeline stage has not run. That is a normal state, not an error: the affected surface shows a neutral notice explaining which stage is outstanding, and the rest of the app keeps working. Pages do not invent numbers to fill the gap.
