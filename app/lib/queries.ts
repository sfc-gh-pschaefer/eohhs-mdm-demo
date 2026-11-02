import 'server-only';

import { assertIdentifier, lowerKeys, querySnowflake, type QueryOptions } from './snowflake';
import { config, getEntity, type EntityConfig } from './config';
import type {
  AttachedMetric,
  ColumnReadiness,
  EntitySummary,
  GateCheck,
  GoldenRecordRow,
  MatchPairRow,
  MatchStats,
  PagedResult,
  QualityResult,
  ReadinessResult,
  RemediationEntry,
  RoutingCounts,
  RuleStat,
  SummaryData,
} from './types';

/**
 * Query layer.
 *
 * Rules observed throughout:
 *
 *   1. Every user-supplied value is a bound parameter. The previous FastAPI
 *      implementation interpolated search terms and filters straight into SQL,
 *      which was an injection path; none of that is carried over.
 *   2. Every identifier comes from lib/config.ts and passes assertIdentifier.
 *   3. Aggregates use owner's rights so all users see the same totals.
 *      Record-level reads use caller's rights so masking and row access policies
 *      apply to the person looking at the data.
 *   4. A missing table means the pipeline stage has not run. That is a normal
 *      state, reported as empty with an explanation, not an error page.
 */

/** Snowflake reports a missing object rather than an empty result. */
function isMissingObject(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('does not exist') ||
    message.includes('not authorized') ||
    message.includes('Object found is of another type')
  );
}

function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

const KNOWN_ROUTES = ['AUTO_MERGE', 'MANUAL_REVIEW', 'AUTO_REJECT'] as const;

function isKnownRoute(value: string): value is keyof RoutingCounts {
  return (KNOWN_ROUTES as readonly string[]).includes(value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Match statistics (owner's rights: aggregate only)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMatchStats(slug: string): Promise<MatchStats> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const table = assertIdentifier(entity.tables.match, 'match table');
  const empty: MatchStats = {
    entity_type: slug,
    total_pairs: 0,
    routing: { AUTO_MERGE: 0, MANUAL_REVIEW: 0, AUTO_REJECT: 0 },
    rules: [],
  };

  let rows: Record<string, unknown>[];
  try {
    rows = await querySnowflake(
      `SELECT MATCH_TYPE, ROUTING, COUNT(*) AS N
       FROM ${table}
       GROUP BY MATCH_TYPE, ROUTING
       ORDER BY N DESC`,
    );
  } catch (error) {
    if (isMissingObject(error)) return empty;
    throw error;
  }

  const routing: RoutingCounts = { AUTO_MERGE: 0, MANUAL_REVIEW: 0, AUTO_REJECT: 0 };
  const ruleCounts = new Map<string, number>();
  let total = 0;

  for (const row of rows) {
    const n = toNumber(row.N);
    const route = String(row.ROUTING ?? 'UNKNOWN');
    const rule = String(row.MATCH_TYPE ?? 'UNKNOWN');

    // ROUTING is a free-text column; a value outside the three routes this
    // pipeline writes (a stale row from a schema change, a manual data fix,
    // etc.) should not be blindly indexed into `routing` — `route as keyof
    // RoutingCounts` would let TypeScript treat any string as a valid key,
    // silently creating an untyped property instead of catching the case.
    if (isKnownRoute(route)) {
      routing[route] += n;
    }
    ruleCounts.set(rule, (ruleCounts.get(rule) ?? 0) + n);
    total += n;
  }

  // Order by the configured tier sequence so the chart reads deterministic to
  // ML to LLM. Rules absent from the config fall to the end.
  const order = entity.tierOrder;
  const rules: RuleStat[] = [...ruleCounts.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return b[1] - a[1];
    })
    .map(([rule_name, count]) => ({
      rule_name,
      description: entity.ruleDescriptions[rule_name] ?? '',
      count,
      pct: total > 0 ? Math.round((1000 * count) / total) / 10 : 0,
    }));

  return { entity_type: slug, total_pairs: total, routing, rules };
}

// ─────────────────────────────────────────────────────────────────────────────
// Summary (owner's rights: counts only)
// ─────────────────────────────────────────────────────────────────────────────

async function summarizeEntity(entity: EntityConfig): Promise<EntitySummary> {
  const clean = assertIdentifier(entity.tables.clean, 'clean table');
  const golden = assertIdentifier(entity.tables.golden, 'golden table');
  const match = assertIdentifier(entity.tables.match, 'match table');

  const zero: EntitySummary = {
    source_records: 0,
    golden_records: 0,
    merged_entities: 0,
    pending_review: 0,
  };

  // One statement per table rather than a single joined query, so a stage that
  // has not run yet degrades that one number instead of blanking the whole card.
  const counts = await Promise.all(
    [
      `SELECT COUNT(*) AS N FROM ${clean}`,
      `SELECT COUNT(*) AS N FROM ${golden}`,
      `SELECT COUNT(*) AS N FROM ${golden} WHERE CLUSTER_SIZE > 1`,
      `SELECT COUNT(*) AS N FROM ${match} WHERE ROUTING = 'MANUAL_REVIEW'`,
    ].map(async (sql) => {
      try {
        const rows = await querySnowflake<{ N: unknown }>(sql);
        return rows.length > 0 ? toNumber(rows[0].N) : 0;
      } catch (error) {
        if (isMissingObject(error)) return 0;
        throw error;
      }
    }),
  );

  return {
    ...zero,
    source_records: counts[0],
    golden_records: counts[1],
    merged_entities: counts[2],
    pending_review: counts[3],
  };
}

export async function getSummary(): Promise<SummaryData> {
  const entries = await Promise.all(
    config.entities.map(async (entity) => [entity.slug, await summarizeEntity(entity)] as const),
  );
  return Object.fromEntries(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// Golden records (caller's rights: individual records)
// ─────────────────────────────────────────────────────────────────────────────

export interface GoldenRecordParams {
  limit: number;
  offset: number;
  minClusterSize: number;
  search: string;
}

export async function getGoldenRecords(
  slug: string,
  params: GoldenRecordParams,
  auth: Pick<QueryOptions, 'callersRights' | 'callerToken'>,
): Promise<PagedResult<GoldenRecordRow>> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const table = assertIdentifier(entity.tables.golden, 'golden table');

  // Search predicate is built from configured searchable columns. The term
  // itself is bound once per column, never interpolated.
  const searchable = entity.goldenColumns
    .filter((c) => c.searchable)
    .map((c) => assertIdentifier(c.column, 'searchable column'));

  const conditions: string[] = ['CLUSTER_SIZE >= ?'];
  const binds: unknown[] = [params.minClusterSize];

  const term = params.search.trim();
  if (term.length > 0 && searchable.length > 0) {
    const clauses = searchable.map((col) => `UPPER(${col}::VARCHAR) LIKE ?`);
    conditions.push(`(${clauses.join(' OR ')})`);
    for (const _ of searchable) {
      binds.push(`%${term.toUpperCase()}%`);
    }
  }

  const where = conditions.join(' AND ');

  try {
    const [items, totals] = await Promise.all([
      querySnowflake<Record<string, unknown>>(
        `SELECT * FROM ${table}
         WHERE ${where}
         ORDER BY CLUSTER_SIZE DESC, QUALITY_SCORE DESC NULLS LAST
         LIMIT ? OFFSET ?`,
        { ...auth, binds: [...binds, params.limit, params.offset] },
      ),
      querySnowflake<{ N: unknown }>(
        `SELECT COUNT(*) AS N FROM ${table} WHERE ${where}`,
        { ...auth, binds },
      ),
    ]);

    return {
      entity_type: slug,
      items: items.map(lowerKeys),
      total: totals.length > 0 ? toNumber(totals[0].N) : 0,
    };
  } catch (error) {
    if (isMissingObject(error)) {
      return {
        entity_type: slug,
        items: [],
        total: 0,
        error: 'Golden records have not been built yet. Run the deploy skill to complete the pipeline.',
      };
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Match pairs (caller's rights: individual records)
// ─────────────────────────────────────────────────────────────────────────────

export interface MatchPairParams {
  limit: number;
  offset: number;
  matchType: string;
  minScore: number;
  maxScore: number;
  search: string;
  /** Restrict to one routing outcome, for the review queue. */
  routing: string;
}

export async function getMatchPairs(
  slug: string,
  params: MatchPairParams,
  auth: Pick<QueryOptions, 'callersRights' | 'callerToken'>,
): Promise<PagedResult<MatchPairRow>> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const table = assertIdentifier(entity.tables.match, 'match table');

  const conditions: string[] = ['1 = 1'];
  const binds: unknown[] = [];

  if (params.matchType) {
    conditions.push('MATCH_TYPE = ?');
    binds.push(params.matchType);
  }
  if (params.routing) {
    conditions.push('ROUTING = ?');
    binds.push(params.routing);
  }
  if (params.minScore > 0) {
    conditions.push('HYBRID_SCORE >= ?');
    binds.push(params.minScore);
  }
  if (params.maxScore < 1) {
    conditions.push('HYBRID_SCORE <= ?');
    binds.push(params.maxScore);
  }
  const term = params.search.trim();
  if (term.length > 0) {
    conditions.push('(UPPER(NAME_A) LIKE ? OR UPPER(NAME_B) LIKE ?)');
    binds.push(`%${term.toUpperCase()}%`, `%${term.toUpperCase()}%`);
  }

  const where = conditions.join(' AND ');

  try {
    const [items, totals] = await Promise.all([
      querySnowflake<Record<string, unknown>>(
        `SELECT * FROM ${table}
         WHERE ${where}
         ORDER BY HYBRID_SCORE ASC, ROW_A
         LIMIT ? OFFSET ?`,
        { ...auth, binds: [...binds, params.limit, params.offset] },
      ),
      querySnowflake<{ N: unknown }>(
        `SELECT COUNT(*) AS N FROM ${table} WHERE ${where}`,
        { ...auth, binds },
      ),
    ]);

    return {
      entity_type: slug,
      items: items.map(lowerKeys),
      total: totals.length > 0 ? toNumber(totals[0].N) : 0,
    };
  } catch (error) {
    if (isMissingObject(error)) {
      return {
        entity_type: slug,
        items: [],
        total: 0,
        error: 'Match results have not been built yet. Run the deploy skill to complete the pipeline.',
      };
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Steward decisions (caller's rights: writes, attributed to the real user)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record a human decision on a MANUAL_REVIEW pair and apply it.
 *
 * Every value here is bound, including row_a/row_b, which the route handler
 * has already coerced to finite numbers before this is called. The audit
 * insert runs before the mutation on the match table so the decision is on
 * record even if the follow-up UPDATE/DELETE fails for an unrelated reason
 * (e.g. the caller's own grants don't cover the write).
 *
 * Returns null when the pair is not currently sitting in MANUAL_REVIEW —
 * either it was never routed there, or someone already decided it.
 */
export async function recordStewardDecision(
  slug: string,
  params: { rowA: number; rowB: number; decision: 'APPROVE' | 'REJECT'; notes: string },
  auth: Pick<QueryOptions, 'callersRights' | 'callerToken'>,
): Promise<{ rowA: number; rowB: number; decision: 'APPROVE' | 'REJECT' } | null> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const matchTable = assertIdentifier(entity.tables.match, 'match table');
  const stewardTable = assertIdentifier(config.stewardDecisionsTable, 'steward decisions table');
  const { rowA, rowB, decision, notes } = params;

  const [pair] = await querySnowflake<{ MATCH_TYPE: string; HYBRID_SCORE: number }>(
    `SELECT MATCH_TYPE, HYBRID_SCORE FROM ${matchTable}
     WHERE ROW_A = ? AND ROW_B = ? AND ROUTING = 'MANUAL_REVIEW'`,
    { ...auth, binds: [rowA, rowB] },
  );
  if (!pair) return null;

  await querySnowflake(
    `INSERT INTO ${stewardTable}
       (ROW_A, ROW_B, ENTITY_TYPE, MATCH_TYPE, HYBRID_SCORE, DECISION, DECIDED_BY, NOTES)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_USER(), ?)`,
    { ...auth, binds: [rowA, rowB, slug, pair.MATCH_TYPE, pair.HYBRID_SCORE, decision, notes] },
  );

  if (decision === 'APPROVE') {
    await querySnowflake(
      `UPDATE ${matchTable} SET ROUTING = 'AUTO_MERGE'
       WHERE ROW_A = ? AND ROW_B = ? AND ROUTING = 'MANUAL_REVIEW'`,
      { ...auth, binds: [rowA, rowB] },
    );
  } else {
    await querySnowflake(
      `DELETE FROM ${matchTable} WHERE ROW_A = ? AND ROW_B = ? AND ROUTING = 'MANUAL_REVIEW'`,
      { ...auth, binds: [rowA, rowB] },
    );
  }

  return { rowA, rowB, decision };
}

// ─────────────────────────────────────────────────────────────────────────────
// Readiness (owner's rights: pre-aggregated stats)
// ─────────────────────────────────────────────────────────────────────────────

export async function getReadiness(slug: string): Promise<ReadinessResult> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const table = assertIdentifier(config.readinessTable, 'readiness table');

  const empty: ReadinessResult = {
    table: entity.tables.clean,
    total_rows: 0,
    overall_score: 0,
    avg_completeness: 0,
    columns_assessed: 0,
    metric_source: 'NONE',
    measured_at: null,
    columns: [],
  };

  try {
    const rows = await querySnowflake<Record<string, unknown>>(
      `SELECT COLUMN_NAME, COMPLETENESS, UNIQUENESS, VALIDITY, CONSISTENCY,
              SOURCE_TABLE, TOTAL_ROWS, METRIC_SOURCE, MEASURED_AT
       FROM ${table}
       WHERE ENTITY_TYPE = ?
       ORDER BY COMPLETENESS ASC`,
      { binds: [slug] },
    );

    if (rows.length === 0) {
      return {
        ...empty,
        error:
          'Readiness has not been computed yet. Run the readiness stage of the pipeline.',
      };
    }

    const columns: ColumnReadiness[] = rows.map((r) => {
      const completeness = toNumber(r.COMPLETENESS);
      const uniqueness = toNumber(r.UNIQUENESS);
      const validity = toNumber(r.VALIDITY);
      const consistency = toNumber(r.CONSISTENCY);
      return {
        column: String(r.COLUMN_NAME ?? ''),
        completeness,
        uniqueness,
        validity,
        consistency,
        score:
          Math.round(((completeness + uniqueness + validity + consistency) / 4) * 10) / 10,
      };
    });

    const first = rows[0];
    const avg = (pick: (c: ColumnReadiness) => number) =>
      Math.round((columns.reduce((sum, c) => sum + pick(c), 0) / columns.length) * 10) / 10;

    const measuredAt = first.MEASURED_AT;

    return {
      table: `${config.database}.${config.integrationSchema}.${String(first.SOURCE_TABLE ?? '')}`,
      total_rows: toNumber(first.TOTAL_ROWS),
      overall_score: avg((c) => c.score),
      avg_completeness: avg((c) => c.completeness),
      columns_assessed: columns.length,
      metric_source: String(first.METRIC_SOURCE ?? 'UNKNOWN'),
      measured_at: measuredAt ? String(measuredAt) : null,
      columns,
    };
  } catch (error) {
    if (isMissingObject(error)) {
      return {
        ...empty,
        error:
          'The readiness table does not exist yet. Run the readiness stage of the pipeline.',
      };
    }
    throw error;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data quality (owner's rights: aggregate metric results)
// ─────────────────────────────────────────────────────────────────────────────

export async function getQuality(slug: string): Promise<QualityResult> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const gateTable = assertIdentifier(config.gateResultsTable, 'gate results table');
  const remediationTable = assertIdentifier(
    config.remediationLogTable,
    'remediation log table',
  );

  const result: QualityResult = {
    entity_type: slug,
    dmf_available: config.dmfAvailable,
    verdict: 'NOT_RUN',
    measured_at: null,
    checks: [],
    monitored: [],
    remediation: [],
  };

  // Gate results from the most recent run for this entity.
  try {
    const checks = await querySnowflake<Record<string, unknown>>(
      `SELECT TABLE_NAME, COLUMN_NAME, METRIC_NAME, METRIC_VALUE, METRIC_PCT,
              EXPECTATION, SEVERITY, PASSED, MEASURED_AT
       FROM ${gateTable}
       WHERE ENTITY_PREFIX = ?
         AND GATE_RUN_ID = (
           SELECT MAX(GATE_RUN_ID) FROM ${gateTable} WHERE ENTITY_PREFIX = ?
         )
       ORDER BY CASE SEVERITY WHEN 'block' THEN 1 WHEN 'warn' THEN 2 ELSE 3 END,
                METRIC_VALUE DESC`,
      { binds: [entity.prefix, entity.prefix] },
    );

    result.checks = checks.map((r) => ({
      table_name: String(r.TABLE_NAME ?? ''),
      column_name: r.COLUMN_NAME ? String(r.COLUMN_NAME) : null,
      metric_name: String(r.METRIC_NAME ?? ''),
      metric_value: toNumber(r.METRIC_VALUE),
      metric_pct: r.METRIC_PCT === null || r.METRIC_PCT === undefined ? null : toNumber(r.METRIC_PCT),
      expectation: r.EXPECTATION ? String(r.EXPECTATION) : null,
      severity: (String(r.SEVERITY ?? 'info') as GateCheck['severity']),
      passed: Boolean(r.PASSED),
    }));

    if (checks.length > 0) {
      const measured = checks[0].MEASURED_AT;
      result.measured_at = measured ? String(measured) : null;

      const blocking = result.checks.filter((c) => !c.passed && c.severity === 'block').length;
      const failed = result.checks.filter((c) => !c.passed).length;
      result.verdict =
        blocking > 0 ? 'BLOCKED' : failed > 0 ? 'PASSED_WITH_WARNINGS' : 'PASSED';
    }
  } catch (error) {
    if (!isMissingObject(error)) throw error;
  }

  // Latest scheduled measurement per column, for the clean table.
  if (config.dmfAvailable) {
    const cleanParts = entity.tables.clean.split('.');
    if (cleanParts.length === 3) {
      try {
        const monitored = await querySnowflake<Record<string, unknown>>(
          `WITH latest AS (
             SELECT TABLE_NAME, METRIC_NAME,
                    ARGUMENT_NAMES[0]::VARCHAR AS COLUMN_NAME,
                    VALUE, MEASUREMENT_TIME,
                    ROW_NUMBER() OVER (
                      PARTITION BY METRIC_NAME, ARGUMENT_NAMES[0]::VARCHAR
                      ORDER BY MEASUREMENT_TIME DESC
                    ) AS RN
             FROM SNOWFLAKE.LOCAL.DATA_QUALITY_MONITORING_RESULTS
             WHERE TABLE_DATABASE = ? AND TABLE_SCHEMA = ? AND TABLE_NAME = ?
               AND MEASUREMENT_TIME >= DATEADD('day', -30, CURRENT_TIMESTAMP())
           )
           SELECT TABLE_NAME, METRIC_NAME, COLUMN_NAME, VALUE, MEASUREMENT_TIME
           FROM latest WHERE RN = 1
           ORDER BY METRIC_NAME, COLUMN_NAME`,
          { binds: [cleanParts[0], cleanParts[1], cleanParts[2]] },
        );

        result.monitored = monitored.map((r) => ({
          table_name: String(r.TABLE_NAME ?? ''),
          metric_name: String(r.METRIC_NAME ?? ''),
          column_name: r.COLUMN_NAME ? String(r.COLUMN_NAME) : null,
          value: toNumber(r.VALUE),
          measurement_time: String(r.MEASUREMENT_TIME ?? ''),
        }));
      } catch (error) {
        // The monitoring view needs the DATA_QUALITY_MONITORING_VIEWER
        // application role. Missing it is a grant gap, not a fatal error.
        if (!isMissingObject(error)) throw error;
      }
    }
  }

  // Remediation audit trail.
  try {
    const remediation = await querySnowflake<Record<string, unknown>>(
      `SELECT TABLE_NAME, COLUMN_NAME, METRIC_NAME, ACTION, ROWS_AFFECTED, RATIONALE
       FROM ${remediationTable}
       WHERE REMEDIATION_RUN_ID = (SELECT MAX(REMEDIATION_RUN_ID) FROM ${remediationTable})
       ORDER BY ROWS_AFFECTED DESC`,
    );

    result.remediation = remediation.map((r) => ({
      table_name: String(r.TABLE_NAME ?? ''),
      column_name: String(r.COLUMN_NAME ?? ''),
      metric_name: String(r.METRIC_NAME ?? ''),
      action: String(r.ACTION ?? ''),
      rows_affected: toNumber(r.ROWS_AFFECTED),
      rationale: String(r.RATIONALE ?? ''),
    }));
  } catch (error) {
    if (!isMissingObject(error)) throw error;
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cluster size distribution (owner's rights: aggregate)
// ─────────────────────────────────────────────────────────────────────────────

export interface ClusterBucket {
  bucket: string;
  clusters: number;
  records: number;
  min_size: number;
}

export async function getClusterDistribution(slug: string): Promise<ClusterBucket[]> {
  const entity = getEntity(slug);
  if (!entity) throw new Error(`Unknown entity: ${slug}`);

  const golden = assertIdentifier(entity.tables.golden, 'golden table');

  try {
    const rows = await querySnowflake<Record<string, unknown>>(
      `SELECT
         CASE
           WHEN CLUSTER_SIZE = 1 THEN 'Singletons'
           WHEN CLUSTER_SIZE = 2 THEN 'Pairs'
           WHEN CLUSTER_SIZE BETWEEN 3 AND 5 THEN 'Small (3-5)'
           WHEN CLUSTER_SIZE BETWEEN 6 AND 20 THEN 'Medium (6-20)'
           ELSE 'Large (20+)'
         END AS BUCKET,
         COUNT(*) AS CLUSTERS,
         SUM(CLUSTER_SIZE) AS RECORDS,
         MIN(CLUSTER_SIZE) AS MIN_SIZE
       FROM ${golden}
       GROUP BY BUCKET
       ORDER BY MIN_SIZE`,
    );

    return rows.map((r) => ({
      bucket: String(r.BUCKET ?? ''),
      clusters: toNumber(r.CLUSTERS),
      records: toNumber(r.RECORDS),
      min_size: toNumber(r.MIN_SIZE),
    }));
  } catch (error) {
    if (isMissingObject(error)) return [];
    throw error;
  }
}
