'use client';

import { useQuery } from '@tanstack/react-query';

import { MiniHBars, type MiniBarRow } from '@/components/charts';
import {
  EmptyState,
  ErrorMsg,
  KpiCard,
  KpiSkeleton,
  Notice,
  PageHeader,
  ScoreBar,
  TableSkeleton,
  formatNumber,
  scoreColor,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { EntityConfig } from '@/lib/config';

/**
 * Per-column data quality readiness.
 *
 * The previous version fell back to several hundred lines of hard-coded readiness
 * figures whenever the API returned nothing, and computed a fabricated
 * "before vs after" improvement from an arithmetic formula rather than from real
 * measurements. Neither is carried over: when there is no measurement, this says
 * so.
 */
export function ReadinessView({ entity }: { entity: EntityConfig }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['readiness', entity.slug],
    queryFn: () => api.readiness(entity.slug),
  });

  const columns = data?.columns ?? [];

  const gapRows: MiniBarRow[] = columns
    .filter((c) => c.completeness < 90)
    .slice(0, 8)
    .map((c) => ({
      label: c.column,
      value: c.completeness,
      color: scoreColor(c.completeness),
      display: `${c.completeness.toFixed(0)}%`,
    }));

  const sourceLabel =
    data?.metric_source === 'DMF_SCHEDULED'
      ? 'Data Metric Functions, scheduled'
      : data?.metric_source === 'DIRECT_SQL'
        ? 'computed directly'
        : 'not measured';

  return (
    <div className="page-content">
      <PageHeader
        title={`${entity.labelPlural} Data Readiness`}
        subtitle={`Per-column quality for ${entity.tables.clean}`}
      />

      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {data?.error ? <Notice message={data.error} /> : null}

      {gapRows.length > 0 ? (
        <div className="alert-banner warning" role="status">
          <span>
            {gapRows.length} {gapRows.length === 1 ? 'column has' : 'columns have'} completeness
            below 90%. Sparse fields weaken matching, because a rule cannot compare a value that is
            not there.
          </span>
        </div>
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
              label="Overall Score"
              value={data ? `${data.overall_score.toFixed(1)}%` : '—'}
              sub="Mean of all four dimensions"
              variant={
                data && data.overall_score >= 90
                  ? 'success'
                  : data && data.overall_score >= 70
                    ? 'warning'
                    : 'critical'
              }
            />
            <KpiCard label="Total Rows" value={formatNumber(data?.total_rows)} />
            <KpiCard label="Columns Assessed" value={formatNumber(data?.columns_assessed)} />
            <KpiCard
              label="Average Completeness"
              value={data ? `${data.avg_completeness.toFixed(1)}%` : '—'}
              sub={`Measured ${sourceLabel}`}
            />
          </>
        )}
      </div>

      {gapRows.length > 0 ? (
        <div className="fwa-card dash-section">
          <div className="fwa-card-header">
            <span>Largest completeness gaps</span>
          </div>
          <div className="fwa-card-body">
            <MiniHBars rows={gapRows} max={100} labelWidth={200} ariaLabel="Completeness gaps" />
          </div>
        </div>
      ) : null}

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Column quality detail</span>
          {data?.measured_at ? (
            <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
              Measured {new Date(data.measured_at).toLocaleString('en-US')}
            </span>
          ) : null}
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : columns.length > 0 ? (
          <div className="table-scroll">
            <table className="fwa-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th style={{ width: 160 }}>Completeness</th>
                  <th style={{ width: 160 }}>Uniqueness</th>
                  <th style={{ width: 160 }}>Validity</th>
                  <th style={{ width: 160 }}>Consistency</th>
                  <th style={{ width: 160 }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col.column}>
                    <td style={{ fontWeight: 600 }}>{col.column}</td>
                    <td>
                      <ScoreBar value={col.completeness} />
                    </td>
                    <td>
                      <ScoreBar value={col.uniqueness} />
                    </td>
                    <td>
                      <ScoreBar value={col.validity} />
                    </td>
                    <td>
                      <ScoreBar value={col.consistency} />
                    </td>
                    <td>
                      <ScoreBar value={col.score} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No readiness measurements yet. Run the readiness stage of the pipeline." />
        )}
      </div>

      <div className="fwa-card">
        <div className="fwa-card-header">
          <span>How to read these dimensions</span>
        </div>
        <div className="fwa-card-body narrative">
          <ul>
            <li>
              <strong>Completeness</strong> — the share of rows where the column is populated and
              not blank. A rule cannot compare a value that is absent, so low completeness directly
              reduces how many true matches can be found.
            </li>
            <li>
              <strong>Uniqueness</strong> — distinct values as a share of populated values. On an
              identifier, low uniqueness is usually the duplication the pipeline exists to resolve,
              not a defect.
            </li>
            <li>
              <strong>Validity</strong> — the share of populated values matching the expected
              format. Where no format rule is configured for a column, this reads 100% because
              nothing has been asserted, not because everything passed.
            </li>
            <li>
              <strong>Consistency</strong> — formatting uniformity: leading and trailing whitespace,
              and inconsistent casing. Low consistency inflates apparent differences between records
              that are actually the same.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
