import 'server-only';

import { lowerKeys, querySnowflake, type QueryOptions } from './snowflake';
import { recordStewardDecision } from './queries';

import { config } from './config';
import { IS_HUB } from './deployment';

/**
 * Queries for the overview, steward workbench, Person 360, and the hub-only
 * overlap and sharing pages. Same rules as lib/queries.ts: user values are
 * always bound, aggregates run with owner's rights, record-level reads with
 * caller's rights. Tables follow the medallion layout every database shares.
 */

const D = config.database;
const SILVER = `${D}.INTEGRATION_SILVER`;
const GOLD = `${D}.MASTER_GOLD`;
const GOV = `${D}.GOV`;
const SLUG = config.entities[0].slug;
type Auth = Pick<QueryOptions, 'callersRights' | 'callerToken'>;

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ─── Overview (owner's rights: aggregates only) ──────────────────────────────

export interface OverviewData {
  scorecard: {
    source_records: number;
    master_records: number;
    true_persons: number;
    precision_pct: number;
    recall_pct: number;
    false_merge_pairs: number;
    pending_review: number;
    links_without_ssn_pct: number;
    masters_resolved_without_ssn: number;
    scored_at: string | null;
  } | null;
  alerts: { alert_type: string; n: number; amount: number }[];
  sources: { source: string; records: number; masters: number; avg_quality: number }[];
  overlap: { systems: number; masters: number }[];
  tiers: { tier: string; label: string; pairs: number }[];
  ai: { decision: string; confidence: string; outcome: string; n: number }[];
  decisions: { decision: string; n: number }[];
  flagged: { flag: string; n: number }[];
  flows: { source: string; systems: number; records: number }[];
}

const TIER_LABEL: Record<string, string> = {
  T1_S0_SSN_CORROBORATED: 'SSN + corroboration',
  T1_S1_SSN4_DOB_NAME: 'SSN4 + DOB + name',
  T1_S2_EMAIL_DOB: 'Email + DOB',
  T1_S3_NAME_DOB_ZIP: 'Name + DOB + ZIP',
  T1_S4_PHONE_DOB_FIRST: 'Phone + DOB + first',
  T1_S5_JW_NAME_DOB_ZIP_ADDR: 'Fuzzy name + guards',
  T1_S6_TOKEN_NAME_DOB_ZIP: 'Salted token (BSAS)',
  T2_ML: 'ML classifier',
  T3_LLM: 'Cortex AI reasoning',
  STEWARD_APPROVED: 'Steward approved',
  TRANSITIVE: 'Linked via other records',
};

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('does not exist') || msg.includes('not authorized')) return fallback;
    throw error;
  }
}

export async function getOverview(): Promise<OverviewData> {
  const [score, sources, overlap, tiers, ai, decisions, flagged, flows, alerts] = await Promise.all([
    safe(() => querySnowflake(`SELECT * FROM ${GOV}.MATCH_QUALITY_SCORECARD`), []),
    safe(
      () =>
        querySnowflake(
          `SELECT _SOURCE_SYSTEM AS SOURCE, COUNT(*) AS RECORDS, COUNT(DISTINCT GOLDEN_ID) AS MASTERS,
                  ROUND(AVG(QUALITY_SCORE), 1) AS AVG_QUALITY
           FROM ${GOLD}.XREF GROUP BY 1 ORDER BY RECORDS DESC`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT SOURCE_COUNT AS SYSTEMS, COUNT(*) AS MASTERS
           FROM ${GOLD}.GOLDEN_RECORDS GROUP BY 1 ORDER BY 1`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT MATCH_TYPE AS TIER, COUNT(*) AS PAIRS FROM ${SILVER}.MATCH_RESULTS
           WHERE ROUTING = 'AUTO_MERGE' GROUP BY 1`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT DECISION, CONFIDENCE, OUTCOME, COUNT(*) AS N FROM ${SILVER}.LLM_AUDIT GROUP BY ALL ORDER BY N DESC`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT DECISION, COUNT(*) AS N FROM ${GOV}.STEWARD_DECISIONS GROUP BY 1`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT STEWARD_FLAG AS FLAG, COUNT(*) AS N FROM ${GOLD}.GOLDEN_RECORDS
           WHERE STEWARD_FLAG IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT x._SOURCE_SYSTEM AS SOURCE, g.SOURCE_COUNT AS SYSTEMS, COUNT(*) AS RECORDS
           FROM ${GOLD}.XREF x JOIN ${GOLD}.GOLDEN_RECORDS g ON g.GOLDEN_ID = x.GOLDEN_ID
           GROUP BY 1, 2`,
        ),
      [],
    ),
    safe(
      () =>
        querySnowflake(
          `SELECT ALERT_TYPE, COUNT(*) AS N, SUM(AMOUNT_AT_RISK) AS AMOUNT
           FROM ${GOLD}.ALERTS GROUP BY 1 ORDER BY 1`,
        ),
      [],
    ),
  ]);

  const s = score[0] as Record<string, unknown> | undefined;
  const order = Object.keys(TIER_LABEL);

  return {
    scorecard: s
      ? {
          source_records: num(s.SOURCE_RECORDS),
          master_records: num(s.MASTER_RECORDS),
          true_persons: num(s.TRUE_PERSONS),
          precision_pct: num(s.PRECISION_PCT),
          recall_pct: num(s.RECALL_PCT),
          false_merge_pairs: num(s.FALSE_MERGE_PAIRS),
          pending_review: num(s.PENDING_REVIEW),
          links_without_ssn_pct: num(s.LINKS_WITHOUT_SSN_PCT),
          masters_resolved_without_ssn: num(s.MASTERS_RESOLVED_WITHOUT_SSN),
          scored_at: s.SCORED_AT ? String(s.SCORED_AT) : null,
        }
      : null,
    alerts: alerts.map((r) => ({ alert_type: String(r.ALERT_TYPE), n: num(r.N), amount: num(r.AMOUNT) })),
    sources: sources.map((r) => ({
      source: String(r.SOURCE),
      records: num(r.RECORDS),
      masters: num(r.MASTERS),
      avg_quality: num(r.AVG_QUALITY),
    })),
    overlap: overlap.map((r) => ({ systems: num(r.SYSTEMS), masters: num(r.MASTERS) })),
    tiers: tiers
      .map((r) => ({
        tier: String(r.TIER),
        label: TIER_LABEL[String(r.TIER)] ?? String(r.TIER),
        pairs: num(r.PAIRS),
      }))
      .sort((a, b) => order.indexOf(a.tier) - order.indexOf(b.tier)),
    ai: ai.map((r) => ({
      decision: String(r.DECISION),
      confidence: String(r.CONFIDENCE),
      outcome: String(r.OUTCOME),
      n: num(r.N),
    })),
    decisions: decisions.map((r) => ({ decision: String(r.DECISION), n: num(r.N) })),
    flagged: flagged.map((r) => ({ flag: String(r.FLAG), n: num(r.N) })),
    flows: flows.map((r) => ({
      source: String(r.SOURCE),
      systems: num(r.SYSTEMS),
      records: num(r.RECORDS),
    })),
  };
}

// ─── Steward workbench (caller's rights: individual records) ────────────────

const RECORD_COLS = [
  'ROW_ID',
  '_SOURCE_SYSTEM',
  'SOURCE_RECORD_ID',
  'FIRST_NAME_AS_GIVEN',
  'MIDDLE_NAME',
  'LAST_NAME_CLEAN',
  'DOB_CLEAN',
  'SSN_LAST4',
  'AGENCY_ID',
  'EMAIL_CLEAN',
  'PHONE_CLEAN',
  'ADDRESS_STREET_CLEAN',
  'ADDRESS_UNIT',
  'ADDRESS_CITY',
  'ADDRESS_ZIP',
  'PROGRAM',
  '_LOAD_TS',
];

function sideColumns(alias: string, prefix: string): string {
  return RECORD_COLS.map((c) => `${alias}.${c} AS ${prefix}${c.replace(/^_/, '')}`).join(', ');
}

export interface WorkbenchRecord {
  row_id: number;
  source_system: string;
  source_record_id: string;
  first_name_as_given: string | null;
  middle_name: string | null;
  last_name_clean: string | null;
  dob_clean: string | null;
  ssn_last4: string | null;
  agency_id: string | null;
  email_clean: string | null;
  phone_clean: string | null;
  address_street_clean: string | null;
  address_unit: string | null;
  address_city: string | null;
  address_zip: string | null;
  program: string | null;
  load_ts: string | null;
}

export interface WorkbenchPair {
  row_a: number;
  row_b: number;
  match_type: string;
  hybrid_score: number;
  evidence: string | null;
  ai_decision: string | null;
  ai_confidence: string | null;
  /** Same surname and DOB, clearly different (nickname-resolved) first names. */
  twin_pattern: boolean;
  /** Corroborating fields counted by the Tier 2 severe-risk policy (needs 3). */
  guard_fields: number | null;
  a: WorkbenchRecord;
  b: WorkbenchRecord;
}

function splitSide(row: Record<string, unknown>, prefix: string): WorkbenchRecord {
  const out: Record<string, unknown> = {};
  for (const c of RECORD_COLS) {
    const key = c.replace(/^_/, '');
    out[key.toLowerCase()] = row[`${prefix}${key}`] ?? null;
  }
  return out as unknown as WorkbenchRecord;
}

export async function getWorkbench(
  params: { limit: number; offset: number; search: string; suggestion: string },
  auth: Auth,
): Promise<{ items: WorkbenchPair[]; total: number }> {
  const conditions = [`m.ROUTING = 'MANUAL_REVIEW'`];
  const binds: unknown[] = [];

  const term = params.search.trim().toUpperCase();
  if (term) {
    conditions.push('(UPPER(m.NAME_A) LIKE ? OR UPPER(m.NAME_B) LIKE ?)');
    binds.push(`%${term}%`, `%${term}%`);
  }
  if (params.suggestion === 'MATCH' || params.suggestion === 'NO_MATCH') {
    conditions.push('l.DECISION = ?');
    binds.push(params.suggestion);
  }
  const where = conditions.join(' AND ');
  const from = `${SILVER}.MATCH_RESULTS m
    JOIN ${SILVER}.PERSON_CLEAN a ON a.ROW_ID = m.ROW_A
    JOIN ${SILVER}.PERSON_CLEAN b ON b.ROW_ID = m.ROW_B
    LEFT JOIN ${SILVER}.LLM_AUDIT l ON l.ROW_A = m.ROW_A AND l.ROW_B = m.ROW_B
    LEFT JOIN ${SILVER}.ML_ROUTED g ON g.ROW_ID_A = m.ROW_A AND g.ROW_ID_B = m.ROW_B`;
  // Twins share surname and DOB but have genuinely different first names.
  // FIRST_NAME_CLEAN resolves nicknames, and the JW cut keeps typos out.
  const twin = `(a.LAST_NAME_CLEAN = b.LAST_NAME_CLEAN AND a.DOB_CLEAN = b.DOB_CLEAN
      AND JAROWINKLER_SIMILARITY(a.FIRST_NAME_CLEAN, b.FIRST_NAME_CLEAN) < 85)`;

  const [rows, totals] = await Promise.all([
    querySnowflake<Record<string, unknown>>(
      `SELECT m.ROW_A, m.ROW_B, m.MATCH_TYPE, m.HYBRID_SCORE, m.EVIDENCE,
              l.DECISION AS AI_DECISION, l.CONFIDENCE AS AI_CONFIDENCE,
              ${twin} AS TWIN_PATTERN, g.GUARD_FIELDS,
              ${sideColumns('a', 'A_')}, ${sideColumns('b', 'B_')}
       FROM ${from}
       WHERE ${where}
       ORDER BY IFF(${twin}, 0, 1), m.HYBRID_SCORE DESC, m.ROW_A, m.ROW_B
       LIMIT ? OFFSET ?`,
      { ...auth, binds: [...binds, params.limit, params.offset] },
    ),
    querySnowflake<{ N: unknown }>(`SELECT COUNT(*) AS N FROM ${from} WHERE ${where}`, {
      ...auth,
      binds,
    }),
  ]);

  return {
    total: totals.length ? num(totals[0].N) : 0,
    items: rows.map((r) => ({
      row_a: num(r.ROW_A),
      row_b: num(r.ROW_B),
      match_type: String(r.MATCH_TYPE ?? ''),
      hybrid_score: num(r.HYBRID_SCORE),
      evidence: r.EVIDENCE ? String(r.EVIDENCE) : null,
      ai_decision: r.AI_DECISION ? String(r.AI_DECISION) : null,
      ai_confidence: r.AI_CONFIDENCE ? String(r.AI_CONFIDENCE) : null,
      twin_pattern: r.TWIN_PATTERN === true,
      guard_fields: r.GUARD_FIELDS === null || r.GUARD_FIELDS === undefined ? null : num(r.GUARD_FIELDS),
      a: splitSide(r, 'A_'),
      b: splitSide(r, 'B_'),
    })),
  };
}

/**
 * Record the decision (caller's rights, attributed to the real steward), then
 * rebuild clusters and master records (owner's rights) so the effect is
 * visible immediately. Returns the master record the pair now belongs to.
 */
export async function decideAndRefresh(
  params: { rowA: number; rowB: number; decision: 'APPROVE' | 'REJECT'; notes: string },
  auth: Auth,
): Promise<{ decided: boolean; master_id: string | null; refresh: string }> {
  const result = await recordStewardDecision(SLUG, params, auth);
  if (!result) return { decided: false, master_id: null, refresh: '' };

  if (params.decision === 'APPROVE') {
    // Mark the provenance of the merge so the overview and Student 360 can
    // show which links a person made.
    await querySnowflake(
      `UPDATE ${SILVER}.MATCH_RESULTS
       SET MATCH_TYPE = 'STEWARD_APPROVED',
           EVIDENCE = 'Approved by ' || CURRENT_USER() || ' on ' || TO_VARCHAR(CURRENT_TIMESTAMP(), 'YYYY-MM-DD HH24:MI') ||
                      IFF(? = '', '', ': ' || ?) || ' | ' || COALESCE(EVIDENCE, '')
       WHERE ROW_A = ? AND ROW_B = ? AND ROUTING = 'AUTO_MERGE'`,
      { ...auth, binds: [params.notes, params.notes, params.rowA, params.rowB] },
    );
  }

  const [refresh] = await querySnowflake<Record<string, unknown>>(
    `CALL ${GOLD}.REFRESH_MASTER()`,
  );
  const [master] = await querySnowflake<{ MASTER_ID: string }>(
    `SELECT MASTER_ID FROM ${GOLD}.XREF WHERE ROW_ID = ?`,
    { binds: [params.rowA] },
  );

  return {
    decided: true,
    master_id: master?.MASTER_ID ?? null,
    refresh: String(Object.values(refresh ?? {})[0] ?? ''),
  };
}

// ─── Student 360 (caller's rights: individual records) ──────────────────────

export interface Person360 {
  master: Record<string, unknown> | null;
  records: Record<string, unknown>[];
  links: Record<string, unknown>[];
  pending: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  lifecycle: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
}

export async function getPerson360(masterId: string, auth: Auth): Promise<Person360> {
  const [master] = await querySnowflake<Record<string, unknown>>(
    `SELECT * FROM ${GOLD}.GOLDEN_RECORDS WHERE MASTER_ID = ?`,
    { ...auth, binds: [masterId] },
  );
  if (!master) return { master: null, records: [], links: [], pending: [], decisions: [], lifecycle: [], alerts: [] };

  const golden = num(master.GOLDEN_ID);
  const [records, links, pending, decisions, lifecycle, alerts] = await Promise.all([
    querySnowflake<Record<string, unknown>>(
      `SELECT * FROM ${GOLD}.XREF WHERE GOLDEN_ID = ? ORDER BY IS_ANCHOR DESC, _SOURCE_SYSTEM, _LOAD_TS DESC`,
      { ...auth, binds: [golden] },
    ),
    querySnowflake<Record<string, unknown>>(
      `SELECT m.ROW_A, m.ROW_B, m.MATCH_TYPE, m.HYBRID_SCORE, m.EVIDENCE, m.SOURCE_A, m.SOURCE_B
       FROM ${SILVER}.MATCH_RESULTS m
       JOIN ${GOLD}.XREF xa ON xa.ROW_ID = m.ROW_A
       WHERE m.ROUTING = 'AUTO_MERGE' AND xa.GOLDEN_ID = ?
       ORDER BY m.HYBRID_SCORE DESC`,
      { ...auth, binds: [golden] },
    ),
    // Pairs still under review that would connect this student to another.
    querySnowflake<Record<string, unknown>>(
      `SELECT m.ROW_A, m.ROW_B, m.NAME_A, m.NAME_B, m.HYBRID_SCORE, m.EVIDENCE,
              IFF(xa.GOLDEN_ID = ?, xb.MASTER_ID, xa.MASTER_ID) AS OTHER_MASTER_ID
       FROM ${SILVER}.MATCH_RESULTS m
       JOIN ${GOLD}.XREF xa ON xa.ROW_ID = m.ROW_A
       JOIN ${GOLD}.XREF xb ON xb.ROW_ID = m.ROW_B
       WHERE m.ROUTING = 'MANUAL_REVIEW' AND (xa.GOLDEN_ID = ? OR xb.GOLDEN_ID = ?)`,
      { ...auth, binds: [golden, golden, golden] },
    ),
    querySnowflake<Record<string, unknown>>(
      `SELECT d.ROW_A, d.ROW_B, d.DECISION, d.DECIDED_BY, d.DECIDED_AT, d.NOTES
       FROM ${GOV}.STEWARD_DECISIONS d
       JOIN ${GOLD}.XREF x ON x.ROW_ID IN (d.ROW_A, d.ROW_B)
       WHERE x.GOLDEN_ID = ?
       QUALIFY ROW_NUMBER() OVER (PARTITION BY d.ROW_A, d.ROW_B, d.DECIDED_AT ORDER BY 1) = 1
       ORDER BY d.DECIDED_AT DESC`,
      { ...auth, binds: [golden] },
    ),
    // The applicant's journey across all four systems, stitched by the xref.
    querySnowflake<Record<string, unknown>>(
      `SELECT e.STAGE, e.EVENT_TS, e.STATUS, e.DETAIL, e._SOURCE_SYSTEM, e.SOURCE_RECORD_ID
       FROM ${SILVER}.PROGRAM_EVENTS e
       JOIN ${GOLD}.XREF x ON x.ROW_ID = e.ROW_ID
       WHERE x.GOLDEN_ID = ?
       ORDER BY e.EVENT_TS DESC`,
      { ...auth, binds: [golden] },
    ),
    querySnowflake<Record<string, unknown>>(
      `SELECT ALERT_TYPE, AMOUNT_AT_RISK, DETAIL FROM ${GOLD}.ALERTS WHERE MASTER_ID = ?`,
      { ...auth, binds: [String(master.MASTER_ID)] },
    ),
  ]);

  return {
    master: lowerKeys(master),
    records: records.map(lowerKeys),
    links: links.map(lowerKeys),
    pending: pending.map(lowerKeys),
    decisions: decisions.map(lowerKeys),
    lifecycle: lifecycle.map(lowerKeys),
    alerts: alerts.map(lowerKeys),
  };
}

// ─── Hub only: agency overlap, sharing, alerts, EOHHS ID writeback ──────────

export interface OverlapRow {
  combination: string;
  masshealth: boolean;
  dta: boolean;
  bsas: boolean;
  ehs: boolean;
  n_agencies: number;
  residents: number;
}

export async function getOverlap(): Promise<{ rows: OverlapRow[]; totals: Record<string, number> }> {
  const rows = await safe(
    () => querySnowflake<Record<string, unknown>>(`SELECT * FROM ${GOLD}.AGENCY_OVERLAP ORDER BY RESIDENTS DESC`),
    [],
  );
  const out = rows.map((r) => ({
    combination: String(r.COMBINATION),
    masshealth: r.MASSHEALTH === true,
    dta: r.DTA === true,
    bsas: r.BSAS === true,
    ehs: r.EHS === true,
    n_agencies: num(r.N_AGENCIES),
    residents: num(r.RESIDENTS),
  }));
  const totals: Record<string, number> = { MASSHEALTH: 0, DTA: 0, BSAS: 0, EHS: 0 };
  for (const r of out) {
    if (r.masshealth) totals.MASSHEALTH += r.residents;
    if (r.dta) totals.DTA += r.residents;
    if (r.bsas) totals.BSAS += r.residents;
    if (r.ehs) totals.EHS += r.residents;
  }
  return { rows: out, totals };
}

export interface SharingData {
  exports: { agency: string; columns: string[]; rows: number }[];
  writeback: { agency: string; mapped: number; linked_elsewhere: number }[];
  bsasLinked: number;
}

export async function getSharing(): Promise<SharingData> {
  const agencies = ['MASSHEALTH', 'DTA', 'BSAS', 'EHS'];
  const exports = await Promise.all(
    agencies.map(async (a) => {
      const [cols, cnt] = await Promise.all([
        safe(
          () =>
            querySnowflake<Record<string, unknown>>(
              `SELECT COLUMN_NAME FROM ${D}.INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA = 'RAW_BRONZE' AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
              { binds: [`${a}_PERSON`] },
            ),
          [],
        ),
        safe(() => querySnowflake<Record<string, unknown>>(`SELECT COUNT(*) AS N FROM ${D}.RAW_BRONZE.${a}_PERSON`), []),
      ]);
      return { agency: a, columns: cols.map((c) => String(c.COLUMN_NAME)), rows: num(cnt[0]?.N) };
    }),
  );
  const writeback = await Promise.all(
    agencies.map(async (a) => {
      const [r] = await safe(
        () =>
          querySnowflake<Record<string, unknown>>(
            `SELECT COUNT(*) AS MAPPED, COUNT_IF(LINKED_AGENCIES LIKE '%,%') AS LINKED FROM ${a}.MASTER_GOLD.EOHHS_ID_MAP`,
          ),
        [],
      );
      return { agency: a, mapped: num(r?.MAPPED), linked_elsewhere: num(r?.LINKED) };
    }),
  );
  const [b] = await safe(
    () =>
      querySnowflake<Record<string, unknown>>(
        `SELECT COUNT(DISTINCT x.MASTER_ID) AS N FROM ${GOLD}.XREF x
         JOIN ${GOLD}.GOLDEN_RECORDS g ON g.MASTER_ID = x.MASTER_ID
         WHERE x._SOURCE_SYSTEM = 'BSAS' AND g.SOURCE_COUNT > 1`,
      ),
    [],
  );
  return { exports, writeback, bsasLinked: num(b?.N) };
}

export async function getAlerts(
  params: { type: string; limit: number },
  auth: Auth,
): Promise<{ summary: { alert_type: string; n: number; amount: number }[]; items: Record<string, unknown>[] }> {
  const [summary, items] = await Promise.all([
    querySnowflake<Record<string, unknown>>(
      `SELECT ALERT_TYPE, COUNT(*) AS N, SUM(AMOUNT_AT_RISK) AS AMOUNT FROM ${GOLD}.ALERTS GROUP BY 1 ORDER BY 2 DESC`,
      auth,
    ),
    querySnowflake<Record<string, unknown>>(
      `SELECT a.MASTER_ID, a.ALERT_TYPE, a.AMOUNT_AT_RISK, a.DETAIL, a.SYSTEMS, g.DISPLAY_NAME, g.SOURCE_SYSTEMS, g.ADDRESS_CITY
       FROM ${GOLD}.ALERTS a JOIN ${GOLD}.GOLDEN_RECORDS g ON g.MASTER_ID = a.MASTER_ID
       WHERE (? = '' OR a.ALERT_TYPE = ?)
       ORDER BY IFF(g.DISPLAY_NAME IN ('Maria Santos'), 0, 1), a.AMOUNT_AT_RISK DESC NULLS LAST, a.MASTER_ID
       LIMIT ?`,
      { ...auth, binds: [params.type, params.type, params.limit] },
    ),
  ]);
  return {
    summary: summary.map((r) => ({ alert_type: String(r.ALERT_TYPE), n: num(r.N), amount: num(r.AMOUNT) })),
    items: items.map(lowerKeys),
  };
}

/** Agency IDs written back to an agency's own gold layer (agency apps only). */
export async function getEohhsId(masterId: string, auth: Auth): Promise<Record<string, unknown> | null> {
  if (IS_HUB) return null;
  const [r] = await safe(
    () =>
      querySnowflake<Record<string, unknown>>(`SELECT * FROM ${GOLD}.EOHHS_ID_MAP WHERE MASTER_ID = ?`, {
        ...auth,
        binds: [masterId],
      }),
    [],
  );
  return r ? lowerKeys(r) : null;
}
