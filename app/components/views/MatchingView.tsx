'use client';

import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { HBarChart, type HBarItem } from '@/components/charts';
import {
  EmptyState,
  ErrorMsg,
  KpiCard,
  KpiSkeleton,
  Notice,
  PageHeader,
  TableSkeleton,
  formatNumber,
  formatValue,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { EntityConfig } from '@/lib/config';
import { terms } from '@/lib/terminology';

const PAGE_SIZE = 25;

const TIER_COLORS = ['#1E40AF', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#7C3AED', '#A855F7'];

/**
 * Golden record explorer for one entity.
 *
 * Columns, search fields, and detail fields all come from the entity
 * configuration, so this same component serves every entity type.
 */
export function MatchingView({ entity }: { entity: EntityConfig }) {
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [minClusterSize, setMinClusterSize] = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const summaryQuery = useQuery({
    queryKey: ['summary'],
    queryFn: () => api.summary(),
  });

  const statsQuery = useQuery({
    queryKey: ['match-stats', entity.slug],
    queryFn: () => api.matchStats(entity.slug),
  });

  const recordsQuery = useQuery({
    queryKey: ['golden-records', entity.slug, page, search, minClusterSize],
    queryFn: () =>
      api.goldenRecords(entity.slug, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        min_cluster_size: minClusterSize,
        search,
      }),
  });

  const summary = summaryQuery.data?.[entity.slug];
  const stats = statsQuery.data;
  const records = recordsQuery.data;

  const chartItems: HBarItem[] =
    stats?.rules.map((rule, index) => ({
      key: rule.rule_name,
      label: rule.rule_name,
      value: rule.count,
      color: TIER_COLORS[index % TIER_COLORS.length],
    })) ?? [];

  const totalPages = records ? Math.ceil(records.total / PAGE_SIZE) : 0;

  const applySearch = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const categoryColor = (column: string, value: unknown): string | undefined =>
    entity.categoryColors?.[column]?.[String(value)];

  return (
    <div className="page-content">
      <PageHeader
        title={`${entity.labelPlural} Matching`}
        subtitle={`${terms.goldenRecordPlural} resolved from ${entity.intakeTables.length} source ${
          entity.intakeTables.length === 1 ? 'table' : 'tables'
        }`}
      />

      {recordsQuery.error ? <ErrorMsg message={(recordsQuery.error as Error).message} /> : null}
      {records?.error ? <Notice message={records.error} /> : null}

      <div className="kpi-grid dash-section">
        {summaryQuery.isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              label="Source Records"
              value={formatNumber(summary?.source_records)}
              sub={entity.tables.clean.split('.').pop()}
            />
            <KpiCard
              label={terms.goldenRecordPlural}
              value={formatNumber(summary?.golden_records)}
              sub={`${formatNumber(summary?.merged_entities)} merged entities`}
              variant="accent"
            />
            <KpiCard
              label={`Pending ${terms.review}`}
              value={formatNumber(summary?.pending_review)}
              sub="Awaiting a decision"
              variant={summary && summary.pending_review > 0 ? 'warning' : 'default'}
            />
          </>
        )}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>{terms.matchPlural} by rule, in tier order</span>
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
            {formatNumber(stats?.total_pairs)} pairs evaluated
          </span>
        </div>
        <div className="fwa-card-body">
          {statsQuery.isLoading ? <TableSkeleton rows={5} /> : <HBarChart items={chartItems} />}
        </div>
      </div>

      <div className="filter-row">
        <input
          className="fwa-input"
          style={{ minWidth: 280 }}
          placeholder={`Search ${entity.goldenColumns
            .filter((c) => c.searchable)
            .map((c) => c.label.toLowerCase())
            .join(', ')}…`}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySearch();
          }}
        />
        <button type="button" className="btn-primary" onClick={applySearch}>
          Search
        </button>
        <select
          className="fwa-select"
          value={minClusterSize}
          onChange={(e) => {
            setMinClusterSize(Number(e.target.value));
            setPage(0);
          }}
        >
          <option value={1}>All records</option>
          <option value={2}>Merged only (2+)</option>
          <option value={3}>{terms.clusterPlural} of 3+</option>
          <option value={5}>{terms.clusterPlural} of 5+</option>
          <option value={10}>{terms.clusterPlural} of 10+</option>
        </select>
      </div>

      <div className="fwa-card">
        <div className="fwa-card-header">
          <span>
            {terms.goldenRecordPlural} — {entity.labelPlural}
          </span>
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
            {formatNumber(records?.total)} total
          </span>
        </div>

        {recordsQuery.isLoading ? (
          <TableSkeleton />
        ) : records && records.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="fwa-table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }} />
                    {entity.goldenColumns.map((col) => (
                      <th key={col.column}>{col.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.items.map((row, index) => {
                    const isOpen = expanded === index;
                    return (
                      <Fragment key={`${String(row.golden_id ?? row.row_id ?? index)}`}>
                        <tr>
                          <td>
                            <button
                              type="button"
                              className="link-btn"
                              aria-expanded={isOpen}
                              aria-label={isOpen ? 'Hide detail' : 'Show detail'}
                              onClick={() => setExpanded(isOpen ? null : index)}
                            >
                              {isOpen ? '▾' : '▸'}
                            </button>
                          </td>
                          {entity.goldenColumns.map((col) => {
                            const value = row[col.column.toLowerCase()];
                            const color = categoryColor(col.column, value);
                            return (
                              <td
                                key={col.column}
                                className={col.format === 'identifier' ? 'data-id' : undefined}
                                style={color ? { color, fontWeight: 600 } : undefined}
                              >
                                {formatValue(value, col.format)}
                              </td>
                            );
                          })}
                        </tr>
                        {isOpen ? (
                          <tr>
                            <td colSpan={entity.goldenColumns.length + 1} style={{ padding: 0 }}>
                              <div className="detail-grid">
                                {entity.goldenDetailColumns.map((col) => (
                                  <div key={col.column}>
                                    <div className="detail-label">{col.label}</div>
                                    <div className="detail-value">
                                      {formatValue(row[col.column.toLowerCase()], col.format)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="pagination-row">
              <span>
                Page {page + 1} of {Math.max(totalPages, 1)}
              </span>
              <div className="pagination-controls">
                <button
                  type="button"
                  className="pagination-btn"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="pagination-btn"
                  disabled={page + 1 >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        ) : (
          <EmptyState
            message={
              search
                ? `No ${entity.labelPlural.toLowerCase()} match "${search}".`
                : `No ${terms.goldenRecordPlural.toLowerCase()} yet.`
            }
          />
        )}
      </div>
    </div>
  );
}
