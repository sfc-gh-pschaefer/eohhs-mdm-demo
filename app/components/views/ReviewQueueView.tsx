'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  EmptyState,
  ErrorMsg,
  KpiCard,
  KpiSkeleton,
  MatchConfidenceBadge,
  Notice,
  PageHeader,
  TableSkeleton,
  formatNumber,
  formatValue,
} from '@/components/ui';
import { api } from '@/lib/api';
import type { EntityConfig } from '@/lib/config';
import type { StewardDecision } from '@/lib/types';
import { terms } from '@/lib/terminology';

const PAGE_SIZE = 50;

/**
 * Pairs awaiting a human decision.
 *
 * Backed by a real route handler over the match results table, restricted to
 * MANUAL_REVIEW, plus a decide route that records the steward's call in
 * GOVERNANCE.STEWARD_DECISIONS and flips the pair's ROUTING (AUTO_MERGE on
 * approve, deleted on reject). An approved pair is only reflected in the
 * golden records table the next time the P05/R05 pipeline stage reruns —
 * there is no automatic re-cluster after a decision.
 */
export function ReviewQueueView({ entity }: { entity: EntityConfig }) {
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['review-queue', entity.slug, page, search],
    queryFn: () =>
      api.reviewQueue(entity.slug, {
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        search,
      }),
  });

  const decide = useMutation({
    mutationFn: (vars: { rowA: number; rowB: number; decision: StewardDecision; notes: string }) =>
      api.decideReviewPair(entity.slug, {
        row_a: vars.rowA,
        row_b: vars.rowB,
        decision: vars.decision,
        notes: vars.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-queue', entity.slug] });
      queryClient.invalidateQueries({ queryKey: ['match-stats', entity.slug] });
    },
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  const applySearch = () => {
    setSearch(searchInput);
    setPage(0);
  };

  const noteKey = (rowA: unknown, rowB: unknown) => `${String(rowA)}-${String(rowB)}`;

  return (
    <div className="page-content">
      <PageHeader
        title={`${entity.labelSingular} ${terms.reviewQueue}`}
        subtitle="Pairs the pipeline could not settle automatically, ordered least certain first"
      />

      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {data?.error ? <Notice message={data.error} /> : null}
      {decide.isError ? <ErrorMsg message={(decide.error as Error).message} /> : null}

      <div className="kpi-grid dash-section">
        {isLoading ? (
          <>
            <KpiSkeleton />
            <KpiSkeleton />
          </>
        ) : (
          <>
            <KpiCard
              label={`Pending ${terms.review}`}
              value={formatNumber(data?.total)}
              sub="Pairs routed to manual review"
              variant={data && data.total > 0 ? 'warning' : 'success'}
            />
            <KpiCard
              label="Status"
              value={data && data.total > 0 ? 'Action needed' : 'All clear'}
              sub={
                data && data.total > 0
                  ? 'A steward decision is required'
                  : 'Nothing is waiting on a decision'
              }
              variant={data && data.total > 0 ? 'warning' : 'success'}
            />
          </>
        )}
      </div>

      <div className="filter-row">
        <input
          className="fwa-input"
          style={{ minWidth: 280 }}
          placeholder="Search either name in the pair…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applySearch();
          }}
        />
        <button type="button" className="btn-primary" onClick={applySearch}>
          Search
        </button>
      </div>

      <div className="fwa-card">
        <div className="fwa-card-header">
          <span>{terms.reviewQueue}</span>
          <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
            {formatNumber(data?.total)} pairs
          </span>
        </div>

        {isLoading ? (
          <TableSkeleton />
        ) : data && data.items.length > 0 ? (
          <>
            <div className="table-scroll">
              <table className="fwa-table">
                <thead>
                  <tr>
                    <th>Record A</th>
                    <th>Record B</th>
                    <th>Confidence</th>
                    <th>Rule</th>
                    <th>Row IDs</th>
                    <th>Notes</th>
                    <th>Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((pair, index) => {
                    const score = Number(pair.hybrid_score);
                    const rowA = pair.row_a;
                    const rowB = pair.row_b;
                    const key = noteKey(rowA, rowB);
                    const isPending =
                      decide.isPending &&
                      decide.variables?.rowA === rowA &&
                      decide.variables?.rowB === rowB;
                    const rowsValid = Number.isFinite(Number(rowA)) && Number.isFinite(Number(rowB));

                    return (
                      <tr key={`${key}-${index}`}>
                        <td>{formatValue(pair.name_a ?? pair.row_a)}</td>
                        <td>{formatValue(pair.name_b ?? pair.row_b)}</td>
                        <td>
                          <MatchConfidenceBadge
                            confidence={Number.isFinite(score) ? score : null}
                          />
                        </td>
                        <td className="data-id" style={{ color: 'var(--text-secondary)' }}>
                          {formatValue(pair.match_type)}
                        </td>
                        <td className="data-id">
                          {formatValue(pair.row_a)} · {formatValue(pair.row_b)}
                        </td>
                        <td>
                          <input
                            className="fwa-input"
                            style={{ minWidth: 160 }}
                            placeholder="Optional note"
                            value={notes[key] ?? ''}
                            onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                            disabled={isPending}
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button
                              type="button"
                              className="btn-primary"
                              disabled={isPending || !rowsValid}
                              onClick={() =>
                                decide.mutate({
                                  rowA: Number(rowA),
                                  rowB: Number(rowB),
                                  decision: 'APPROVE',
                                  notes: notes[key] ?? '',
                                })
                              }
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="btn-danger"
                              disabled={isPending || !rowsValid}
                              onClick={() =>
                                decide.mutate({
                                  rowA: Number(rowA),
                                  rowB: Number(rowB),
                                  decision: 'REJECT',
                                  notes: notes[key] ?? '',
                                })
                              }
                            >
                              Reject
                            </button>
                          </div>
                        </td>
                      </tr>
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
                ? `No pending pairs match "${search}".`
                : `Nothing is waiting for review. Every ${entity.labelSingular.toLowerCase()} pair was decided automatically.`
            }
          />
        )}
      </div>
    </div>
  );
}
