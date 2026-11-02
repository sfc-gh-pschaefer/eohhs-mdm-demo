/**
 * Deployment configuration.
 *
 * The deploy skill REWRITES this file from entity-resolution-plan.json. Every
 * value below is a placeholder from the reference deployment. Nothing else in
 * the app hard-codes a database, schema, table, column, or entity name, so this
 * is the single file that binds the generic UI to a specific deployment.
 *
 * Identifiers from this file are interpolated into SQL. They come from the
 * deployment plan, not from user input, but they are still validated at query
 * time (see lib/snowflake.ts assertIdentifier) so a malformed plan fails loudly
 * rather than producing broken or unsafe SQL.
 */
import { IS_HUB } from './deployment';

export interface ColumnSpec {
  /** Physical column name in the clean or golden table. */
  column: string;
  /** Header shown in the UI. */
  label: string;
  /** How to render the value. */
  format?: 'text' | 'number' | 'identifier' | 'percent' | 'date';
  /** Include in the free-text search predicate. */
  searchable?: boolean;
}

export interface EntityConfig {
  /** URL segment. Must be unique and URL-safe. */
  slug: string;
  /** Single-letter table prefix from the plan. */
  prefix: string;
  /** Display names in the user's own language. */
  labelSingular: string;
  labelPlural: string;

  /** Fully qualified tables produced by the pipeline. */
  tables: {
    clean: string;
    match: string;
    golden: string;
  };

  /** Intake tables, for the data quality surface. */
  intakeTables: string[];

  /** Columns shown in the golden record table, in display order. */
  goldenColumns: ColumnSpec[];

  /** Columns revealed when a golden record row is expanded. */
  goldenDetailColumns: ColumnSpec[];

  /** Deterministic and model rule names in tier order, for chart ordering. */
  tierOrder: string[];

  /** Human-readable description per rule name, shown in the rules table. */
  ruleDescriptions: Record<string, string>;

  /** Narrative describing how matching was configured for this entity. */
  matchingNarrative: {
    thresholdIndividual: number;
    thresholdOrganization: number;
    minimumGuardFields: number;
    llmModel: string;
    llmRequired: boolean;
    mlFeatures: string[];
    deterministicRules: { rule: string; keys: string; confidence: number | null }[];
  };

  /** Value-to-colour map for a categorical column, keyed by column name. */
  categoryColors?: Record<string, Record<string, string>>;
}

export interface AppConfig {
  /** Application title, from the domain context. */
  title: string;
  /** Short line under the title in the sidebar. */
  subtitle: string;
  /** Domain label, shown in the footer. */
  domain: string;
  /** Pipeline database. */
  database: string;
  /** Schema holding cleaned data, match results, and golden records. */
  integrationSchema: string;
  /** Schema holding source data as it arrived. */
  intakeSchema: string;
  /** Schema holding custom data metric functions and gate results. */
  governanceSchema: string;
  /** Readiness stats table. */
  readinessTable: string;
  /** Quality gate results table. */
  gateResultsTable: string;
  /** Remediation audit table. */
  remediationLogTable: string;
  /** Steward decisions audit table, written by the review-queue decide route. */
  stewardDecisionsTable: string;
  /** False when the account cannot run Data Metric Functions. */
  dmfAvailable: boolean;
  /** Entities in nav order. */
  entities: EntityConfig[];
}

const RULES: Record<string, string> = {
  T1_S0_SSN_CORROBORATED: 'Full SSN plus a second signal (DOB, last name, or name/DOB token). SSN alone never merges.',
  T1_S1_SSN4_DOB_NAME: 'SSN last 4 + date of birth + first and last name. Catches SSN keying errors.',
  T1_S2_EMAIL_DOB: 'Email + date of birth, with no full-SSN conflict.',
  T1_S3_NAME_DOB_ZIP: 'Exact standardized name + date of birth + ZIP, for records with no identifiers.',
  T1_S4_PHONE_DOB_FIRST: 'Phone + date of birth + first name. First name guards against twins sharing a family phone.',
  T1_S5_JW_NAME_DOB_ZIP_ADDR: 'Name 94%+ similar, first name 95%+, DOB + ZIP + street or SSN last 4, no SSN conflict.',
  T1_S6_TOKEN_NAME_DOB_ZIP: 'Salted name + DOB + ZIP token. Links BSAS records the hub never sees in the clear.',
  T2_ML: 'ML classifier (scikit-learn in Snowflake). Auto-merges only at p >= 0.80 with 3+ agreeing fields and one personal identifier.',
  T3_LLM: 'Cortex AI (claude-sonnet-4-5) reasoning; auto-merges only when SQL confirms an identifier agrees exactly.',
  STEWARD_APPROVED: 'Merged by a data steward in the workbench; decision and note kept in GOV.STEWARD_DECISIONS.',
  TRANSITIVE: 'Uncertain pair resolved because both records were already linked through other high-confidence matches.',
};
const TIER_ORDER = Object.keys(RULES);

const NARRATIVE = {
  thresholdIndividual: 0.8,
  thresholdOrganization: 0.8,
  minimumGuardFields: 3,
  llmModel: 'claude-sonnet-4-5',
  llmRequired: true,
  mlFeatures: ['first_name_jw', 'last_name_jw', 'given_first_exact', 'dob_exact', 'dob_month_day_swapped', 'dob_missing',
    'zip_exact', 'street_exact', 'ssn_last4_exact', 'ssn_last4_conflict', 'email_exact', 'phone_exact'],
  deterministicRules: [
    { rule: 'S0', keys: 'Full SSN + DOB or last name', confidence: 1.0 },
    { rule: 'S1', keys: 'SSN last 4 + DOB + first + last name', confidence: 0.97 },
    { rule: 'S2', keys: 'Email + DOB', confidence: 0.96 },
    { rule: 'S3', keys: 'First + last name + DOB + ZIP', confidence: 0.95 },
    { rule: 'S4', keys: 'Phone + DOB + first name (twin guard)', confidence: 0.94 },
    { rule: 'S5', keys: 'Name similarity + DOB + ZIP + street/SSN4', confidence: 0.9 },
    ...(IS_HUB ? [{ rule: 'S6', keys: 'Salted name + DOB + ZIP token (BSAS)', confidence: 0.95 }] : []),
  ],
};

const DB = IS_HUB ? 'EOHHS_HUB' : 'MASSHEALTH';

export const config: AppConfig = {
  title: IS_HUB ? 'Commonwealth Resident Index' : 'MassHealth Member Index',
  subtitle: IS_HUB ? 'Executive Office of Health & Human Services' : 'MassHealth · EOHHS',
  domain: 'Massachusetts health and human services',
  database: DB,
  integrationSchema: 'INTEGRATION_SILVER',
  intakeSchema: 'RAW_BRONZE',
  governanceSchema: 'GOV',
  readinessTable: `${DB}.GOV.DATA_READINESS_STATS`,
  gateResultsTable: `${DB}.GOV.DQ_GATE_RESULTS`,
  remediationLogTable: `${DB}.GOV.DQ_REMEDIATION_LOG`,
  stewardDecisionsTable: `${DB}.GOV.STEWARD_DECISIONS`,
  dmfAvailable: true,

  entities: [
    {
      slug: IS_HUB ? 'residents' : 'members',
      prefix: DB,
      labelSingular: IS_HUB ? 'Resident' : 'Member',
      labelPlural: IS_HUB ? 'Residents' : 'Members',
      tables: {
        clean: `${DB}.INTEGRATION_SILVER.PERSON_CLEAN`,
        match: `${DB}.INTEGRATION_SILVER.MATCH_RESULTS`,
        golden: `${DB}.MASTER_GOLD.GOLDEN_RECORDS`,
      },
      intakeTables: IS_HUB
        ? ['EOHHS_HUB.RAW_BRONZE.MASSHEALTH_PERSON', 'EOHHS_HUB.RAW_BRONZE.DTA_PERSON', 'EOHHS_HUB.RAW_BRONZE.BSAS_PERSON', 'EOHHS_HUB.RAW_BRONZE.EHS_PERSON']
        : ['MASSHEALTH.RAW_BRONZE.MMIS_MEMBER', 'MASSHEALTH.RAW_BRONZE.HIX_APPLICATION', 'MASSHEALTH.RAW_BRONZE.MA21_CASE'],
      goldenColumns: [
        { column: 'MASTER_ID', label: IS_HUB ? 'EOHHS ID' : 'Master ID', format: 'identifier', searchable: true },
        { column: 'DISPLAY_NAME', label: IS_HUB ? 'Resident' : 'Member', searchable: true },
        { column: 'DOB_CLEAN', label: 'Date of Birth', format: 'date' },
        { column: 'SSN_LAST4', label: 'SSN (last 4)', format: 'identifier' },
        ...(IS_HUB ? [] : [{ column: 'AGENCY_ID', label: 'MMIS Member ID', format: 'identifier' as const, searchable: true }]),
        { column: 'ADDRESS_CITY', label: 'City', searchable: true },
        { column: 'CLUSTER_SIZE', label: 'Records', format: 'number' },
        { column: 'QUALITY_SCORE', label: 'Completeness', format: 'number' },
        { column: 'SOURCE_SYSTEMS', label: IS_HUB ? 'Agencies' : 'Source systems' },
      ],
      goldenDetailColumns: [
        { column: 'ADDRESS_CLEAN', label: 'Address' },
        { column: 'ADDRESS_SOURCE', label: 'Address from' },
        { column: 'EMAIL_CLEAN', label: 'Email' },
        { column: 'PHONE_CLEAN', label: 'Phone' },
        { column: 'PROGRAMS', label: 'Programs' },
        { column: 'SOURCE_RECORD_IDS', label: 'Source record IDs' },
        { column: 'STEWARD_FLAG', label: 'Steward flag' },
        { column: 'LAST_UPDATED', label: 'Last updated', format: 'date' },
      ],
      tierOrder: TIER_ORDER,
      ruleDescriptions: RULES,
      matchingNarrative: NARRATIVE,
    },
  ],
};

/** Look up an entity by its URL slug. Returns undefined for an unknown slug. */
export function getEntity(slug: string): EntityConfig | undefined {
  return config.entities.find((e) => e.slug === slug);
}

/** All valid slugs, for static route generation. */
export function entitySlugs(): string[] {
  return config.entities.map((e) => e.slug);
}
