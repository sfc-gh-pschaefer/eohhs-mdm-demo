'use client';

import { useQuery } from '@tanstack/react-query';

import {
  EmptyState,
  ErrorMsg,
  KpiCard,
  KpiSkeleton,
  Notice,
  PageHeader,
  TableSkeleton,
  formatNumber,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { EntityConfig } from '@/lib/config';
import { config } from '@/lib/config';

/**
 * Data Metric Function results.
 *
 * Three things, in the order a steward needs them:
 *   1. The gate verdict on the intake data, with any failing expectation named.
 *   2. What remediation changed, so a data modification is never invisible.
 *   3. The latest scheduled measurements, for ongoing monitoring.
 */

const VERDICT_STYLE: Record<string, { label: string; variant: 'success' | 'warning' | 'critical' | 'default'; note: string }> = {
  PASSED: {
    label: 'Passed',
    variant: 'success',
    note: 'Every configured expectation was met',
  },
  PASSED_WITH_WARNINGS: {
    label: 'Warnings',
    variant: 'warning',
    note: 'Non-blocking expectations failed',
  },
  BLOCKED: {
    label: 'Blocked',
    variant: 'critical',
    note: 'A blocking expectation failed',
  },
  NOT_RUN: {
    label: 'Not run',
    variant: 'default',
    note: 'The quality gate has not run yet',
  },
};

function severityBadge(severity: string) {
  const className =
    severity === 'block' ? 'badge-critical' : severity === 'warn' ? 'badge-high' : 'badge-low';
  return <span className={className}>{severity}</span>;
}

export function QualityView({ entity }: { entity: EntityConfig }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['quality', entity.slug],
    queryFn: () => api.quality(entity.slug),
  });

  const verdict = VERDICT_STYLE[data?.verdict ?? 'NOT_RUN'] ?? VERDICT_STYLE.NOT_RUN;
  const checks = data?.checks ?? [];
  const failing = checks.filter((c) => !c.passed);
  const monitored = data?.monitored ?? [];
  const remediation = data?.remediation ?? [];

  const totalRemediated = remediation.reduce((sum, r) => sum + r.rows_affected, 0);

  return (
    <div className="page-content">
      <PageHeader
        title={`${entity.labelSingular} Data Quality`}
        subtitle={`Quality checks on ${entity.intakeTables.length} intake ${
          entity.intakeTables.length === 1 ? 'table' : 'tables'
        } and the resolved data`}
      />

      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {data?.error ? <Notice message={data.error} /> : null}

      {data && !data.dmf_available ? (
        <Notice
          tone="warning"
          message="This account cannot run Data Metric Functions, so quality checks were computed in plain SQL. The measurements below are accurate, but there is no scheduled monitoring and no expectation tracking. Data Metric Functions need Enterprise Edition."
        />
      ) : null}

      <div className="kpi-grid dash-section">
        {isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              label="Gate Verdict"
              value={verdict.label}
              sub={verdict.note}
              variant={verdict.variant}
            />
            <KpiCard
              label="Checks Run"
              value={formatNumber(checks.length)}
              sub={`${failing.length} failing`}
              variant={failing.length > 0 ? 'warning' : 'default'}
            />
            <KpiCard
              label="Rows Remediated"
              value={formatNumber(totalRemediated)}
              sub="Changed during cleansing"
            />
            <KpiCard
              label="Monitored Metrics"
              value={formatNumber(monitored.length)}
              sub={
                data?.dmf_available
                  ? 'Attached to the resolved table'
                  : 'Scheduling unavailable'
              }
            />
          </>
        )}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Intake quality gate</span>
          {data?.measured_at ? (
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
              Measured {new Date(data.measured_at).toLocaleString('en-US')}
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : checks.length > 0 ? (
          <div className="table-scroll">
            <table className="fwa-table">
              <thead>
                <tr>
                  <th>Check</th>
                  <th>Column</th>
                  <th>Value</th>
                  <th>Share of rows</th>
                  <th>Expectation</th>
                  <th>Severity</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check, index) => (
                  <tr key={`${check.metric_name}-${check.column_name ?? 'table'}-${index}`}>
                    <td className="data-id" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {check.metric_name}
                    </td>
                    <td>{check.column_name ?? <span style={{ color: 'var(--text-tertiary)' }}>whole table</span>}</td>
                    <td>{formatNumber(check.metric_value)}</td>
                    <td>
                      {check.metric_pct === null ? (
                        <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      ) : (
                        `${check.metric_pct.toFixed(2)}%`
                      )}
                    </td>
                    <td className="data-id" style={{ color: 'var(--text-secondary)' }}>
                      {check.expectation ?? 'monitored only'}
                    </td>
                    <td>{severityBadge(check.severity)}</td>
                    <td>
                      {check.expectation === null ? (
                        <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                      ) : check.passed ? (
                        <span style={{ color: 'var(--success)', fontWeight: 600 }}>Pass</span>
                      ) : (
                        <span style={{ color: 'var(--critical)', fontWeight: 600 }}>Fail</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="The quality gate has not run for this entity yet. Run the deploy skill to execute it." />
        )}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Remediation applied during cleansing</span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={4} />
        ) : remediation.length > 0 ? (
          <div className="table-scroll">
            <table className="fwa-table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th>Column</th>
                  <th>Triggered by</th>
                  <th>Action</th>
                  <th>Rows changed</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {remediation.map((entry, index) => (
                  <tr key={`${entry.table_name}-${entry.column_name}-${index}`}>
                    <td className="data-id" style={{ color: 'var(--text-primary)' }}>
                      {entry.table_name}
                    </td>
                    <td style={{ fontWeight: 600 }}>{entry.column_name}</td>
                    <td className="data-id" style={{ color: 'var(--text-secondary)' }}>
                      {entry.metric_name}
                    </td>
                    <td>{entry.action}</td>
                    <td>{formatNumber(entry.rows_affected)}</td>
                    <td style={{ color: 'var(--text-secondary)' }}>{entry.rationale}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No rows were remediated. Either the intake data had none of the targeted defects, or remediation was not configured." />
        )}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Scheduled monitoring on the resolved data</span>
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
            {entity.tables.clean}
          </span>
        </div>

        {isLoading ? (
          <TableSkeleton rows={6} />
        ) : monitored.length > 0 ? (
          <div className="table-scroll">
            <table className="fwa-table">
              <thead>
                <tr>
                  <th>Metric</th>
                  <th>Column</th>
                  <th>Latest value</th>
                  <th>Measured</th>
                </tr>
              </thead>
              <tbody>
                {monitored.map((metric, index) => (
                  <tr key={`${metric.metric_name}-${metric.column_name ?? 'table'}-${index}`}>
                    <td className="data-id" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {metric.metric_name}
                    </td>
                    <td>
                      {metric.column_name ?? (
                        <span style={{ color: 'var(--text-tertiary)' }}>whole table</span>
                      )}
                    </td>
                    <td>{formatNumber(metric.value)}</td>
                    <td className="data-id">
                      {new Date(metric.measurement_time).toLocaleString('en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            message={
              data?.dmf_available
                ? 'No scheduled measurements yet. The shortest schedule is five minutes, so results appear shortly after the first run. This view also needs the SNOWFLAKE.DATA_QUALITY_MONITORING_VIEWER application role.'
                : 'Scheduled monitoring is unavailable on this account.'
            }
          />
        )}
      </div>

      <div className="fwa-card">
        <div className="fwa-card-header">
          <span>Where these checks run</span>
        </div>
        <div className="fwa-card-body narrative">
          <h4>Intake</h4>
          <ul>
            {entity.intakeTables.map((table) => (
              <li key={table}>
                <code>{table}</code>
              </li>
            ))}
          </ul>
          <p>
            The gate measures the source data before matching starts, because a rule can only be as
            good as the values it compares. A missing identifier silently removes a record from
            exact matching, and a malformed one can collide with another malformed value and produce
            a false exact match.
          </p>

          <h4>Resolved data</h4>
          <p>
            Monitoring on <code>{entity.tables.clean}</code> answers a different question: whether
            the resolved output is fit to use downstream. Custom format rules live in{' '}
            <code>
              {config.database}.{config.governanceSchema}
            </code>
            .
          </p>

          <h4>Cost</h4>
          <p>
            Scheduled checks use serverless compute. Usage is visible in{' '}
            <code>SNOWFLAKE.ACCOUNT_USAGE.DATA_QUALITY_MONITORING_USAGE_HISTORY</code>, which lags
            one to two hours.
          </p>
        </div>
      </div>
    </div>
  );
}
