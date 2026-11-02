/**
 * API response shapes.
 *
 * These are the contract between the route handlers and the client components.
 * They match the shapes the previous FastAPI service returned, so the ported
 * components did not need to change, with two additions: a real review queue and
 * a data quality surface.
 */

export interface RoutingCounts {
  AUTO_MERGE: number;
  MANUAL_REVIEW: number;
  AUTO_REJECT: number;
}

export interface RuleStat {
  rule_name: string;
  /** From config.ruleDescriptions, empty when the rule is not described. */
  description: string;
  count: number;
  pct: number;
}

export interface MatchStats {
  entity_type: string;
  total_pairs: number;
  routing: RoutingCounts;
  rules: RuleStat[];
}

export interface EntitySummary {
  source_records: number;
  golden_records: number;
  merged_entities: number;
  pending_review: number;
}

/**
 * Keyed by entity slug. The previous version hard-coded two fixed keys, which
 * made a third entity impossible to display.
 */
export type SummaryData = Record<string, EntitySummary>;

export interface PagedResult<T> {
  entity_type: string;
  items: T[];
  total: number;
  error?: string;
}

/** A golden record row. Columns vary by deployment, so values are open. */
export type GoldenRecordRow = Record<string, unknown>;

/** A candidate pair row. */
export type MatchPairRow = Record<string, unknown>;

export interface ColumnReadiness {
  column: string;
  completeness: number;
  uniqueness: number;
  validity: number;
  consistency: number;
  score: number;
}

export interface ReadinessResult {
  table: string;
  total_rows: number;
  overall_score: number;
  avg_completeness: number;
  columns_assessed: number;
  /** DMF_SCHEDULED or DIRECT_SQL, so the UI can say where the numbers came from. */
  metric_source: string;
  measured_at: string | null;
  columns: ColumnReadiness[];
  error?: string;
}

export interface GateCheck {
  table_name: string;
  column_name: string | null;
  metric_name: string;
  metric_value: number;
  metric_pct: number | null;
  expectation: string | null;
  severity: 'block' | 'warn' | 'info';
  passed: boolean;
}

export interface AttachedMetric {
  table_name: string;
  metric_name: string;
  column_name: string | null;
  value: number;
  measurement_time: string;
}

export interface RemediationEntry {
  table_name: string;
  column_name: string;
  metric_name: string;
  action: string;
  rows_affected: number;
  rationale: string;
}

export interface QualityResult {
  entity_type: string;
  dmf_available: boolean;
  /** BLOCKED, PASSED_WITH_WARNINGS, PASSED, or NOT_RUN. */
  verdict: string;
  measured_at: string | null;
  checks: GateCheck[];
  monitored: AttachedMetric[];
  remediation: RemediationEntry[];
  error?: string;
}

export type StewardDecision = 'APPROVE' | 'REJECT';

export interface StewardDecisionRequest {
  row_a: number;
  row_b: number;
  decision: StewardDecision;
  notes?: string;
}

export interface StewardDecisionResult {
  row_a: number;
  row_b: number;
  decision: StewardDecision;
  error?: string;
}
