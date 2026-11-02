'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ErrorMsg, KpiCard, Notice, PageHeader, formatNumber } from '@/components/ui';
import { eohhsApi } from '@/lib/api';
import type { WorkbenchPair, WorkbenchRecord } from '@/lib/eohhs-queries';
import { SOURCE_COLORS, SOURCE_SHORT, sourceLabel } from '@/lib/sources';
import { config } from '@/lib/config';
import { terms } from '@/lib/terminology';

const PAGE_SIZE = 12;
type Decision = 'APPROVE' | 'REJECT';
type Zone = Decision | null;

interface Outcome {
  key: string;
  label: string;
  decision: Decision;
  masterId: string | null;
}

const pairKey = (p: { row_a: number; row_b: number }) => `${p.row_a}-${p.row_b}`;

function fullName(r: WorkbenchRecord) {
  return [r.first_name_as_given, r.middle_name, r.last_name_clean].filter(Boolean).join(' ') || 'No name on file';
}

function isTwinPattern(p: WorkbenchPair) {
  return p.twin_pattern;
}

function fmtDate(v: string | null) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
}

function fmtPhone(v: string | null) {
  if (!v || v.length !== 10) return v;
  return `(${v.slice(0, 3)}) ${v.slice(3, 6)}-${v.slice(6)}`;
}

/** Field-by-field comparison rows: label, both values, and agreement state. */
function compareRows(p: WorkbenchPair) {
  const street = (r: WorkbenchRecord) =>
    r.address_street_clean ? `${r.address_street_clean}${r.address_unit ? ` #${r.address_unit}` : ''}` : null;
  const rows: { label: string; a: string | null; b: string | null; norm?: (v: string) => string }[] = [
    { label: 'First name', a: p.a.first_name_as_given, b: p.b.first_name_as_given },
    { label: 'Last name', a: p.a.last_name_clean, b: p.b.last_name_clean },
    { label: 'Date of birth', a: fmtDate(p.a.dob_clean), b: fmtDate(p.b.dob_clean) },
    { label: 'SSN (last 4)', a: p.a.ssn_last4 ? `•••-••-${p.a.ssn_last4}` : null, b: p.b.ssn_last4 ? `•••-••-${p.b.ssn_last4}` : null },
    { label: 'Agency ID', a: p.a.agency_id, b: p.b.agency_id },
    { label: 'Email', a: p.a.email_clean, b: p.b.email_clean },
    { label: 'Phone', a: fmtPhone(p.a.phone_clean), b: fmtPhone(p.b.phone_clean) },
    { label: 'Street', a: street(p.a), b: street(p.b) },
    { label: 'City / ZIP', a: [p.a.address_city, p.a.address_zip].filter(Boolean).join(' ') || null, b: [p.b.address_city, p.b.address_zip].filter(Boolean).join(' ') || null },
    { label: 'Program', a: p.a.program, b: p.b.program },
  ];
  return rows.map((r) => {
    const state = !r.a || !r.b ? 'missing' : r.a.toUpperCase() === r.b.toUpperCase() ? 'agree' : 'differ';
    return { ...r, state };
  });
}

function SourceChip({ code }: { code: string }) {
  return (
    <span className="source-chip" style={{ background: SOURCE_COLORS[code] ?? '#475569' }}>
      {SOURCE_SHORT[code] ?? code}
    </span>
  );
}

function AiBadge({ decision, confidence }: { decision: string | null; confidence: string | null }) {
  if (!decision) return <span className="ai-badge neutral">No AI review</span>;
  const match = decision === 'MATCH';
  return (
    <span className={`ai-badge ${match ? 'match' : 'nomatch'}`}>
      AI: {match ? 'likely same' : 'likely different'} · {String(confidence ?? '').toLowerCase()}
    </span>
  );
}

export function StewardWorkbenchView() {
  const queryClient = useQueryClient();
  const initialSearch = useSearchParams().get('search') ?? '';
  const [page, setPage] = useState(0);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [suggestion, setSuggestion] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [hoverZone, setHoverZone] = useState<Zone>(null);
  const [pending, setPending] = useState<{ pair: WorkbenchPair; decision: Decision } | null>(null);
  const [note, setNote] = useState('');
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const { data, isLoading, error, isFetching } = useQuery({
    queryKey: ['workbench', page, search, suggestion],
    queryFn: () => eohhsApi.workbench({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, search, suggestion }),
  });

  const items = useMemo(() => (data?.items ?? []).filter((p) => !hidden.has(pairKey(p))), [data, hidden]);
  const selected = items.find((p) => pairKey(p) === selectedKey) ?? items[0] ?? null;

  useEffect(() => {
    if (selected && pairKey(selected) !== selectedKey) setSelectedKey(pairKey(selected));
  }, [selected, selectedKey]);

  const decide = useMutation({
    mutationFn: (v: { pair: WorkbenchPair; decision: Decision; notes: string }) =>
      eohhsApi.decide({ row_a: v.pair.row_a, row_b: v.pair.row_b, decision: v.decision, notes: v.notes }),
    onMutate: (v) => {
      // Optimistic: the card leaves the queue the moment it is dropped.
      setHidden((h) => new Set(h).add(pairKey(v.pair)));
    },
    onSuccess: (res, v) => {
      setOutcomes((o) => [
        {
          key: pairKey(v.pair),
          label: `${fullName(v.pair.a)} ↔ ${fullName(v.pair.b)}`,
          decision: v.decision,
          masterId: res.master_id,
        },
        ...o,
      ].slice(0, 8));
      queryClient.invalidateQueries({ queryKey: ['overview'] });
      queryClient.invalidateQueries({ queryKey: ['person360'] });
    },
    onError: (_e, v) => {
      setHidden((h) => {
        const next = new Set(h);
        next.delete(pairKey(v.pair));
        return next;
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['workbench'] });
    },
  });

  const startDecision = (pair: WorkbenchPair, decision: Decision) => {
    setPending({ pair, decision });
    setNote('');
  };

  const confirm = () => {
    if (!pending) return;
    decide.mutate({ pair: pending.pair, decision: pending.decision, notes: note.trim() });
    setPending(null);
    setSelectedKey(null);
  };

  const onDrop = (zone: Decision) => (e: React.DragEvent) => {
    e.preventDefault();
    setHoverZone(null);
    const key = e.dataTransfer.getData('text/plain') || dragKey;
    const pair = items.find((p) => pairKey(p) === key);
    setDragKey(null);
    if (pair) startDecision(pair, zone);
  };

  const zoneProps = (zone: Decision) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (hoverZone !== zone) setHoverZone(zone);
    },
    onDragLeave: () => setHoverZone(null),
    onDrop: onDrop(zone),
  });

  const total = data?.total ?? 0;
  // The server total already excludes decided pairs once the queue refetches;
  // subtract only decisions still in flight.
  const inFlight = decide.isPending ? 1 : 0;
  const remaining = Math.max(total - inFlight, 0);
  const merged = outcomes.filter((o) => o.decision === 'APPROVE').length;
  const separated = outcomes.length - merged;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="page-content">
      <PageHeader
        title="Steward Workbench"
        subtitle="Decide what the machine could not. Drag a pair onto a decision; master records rebuild instantly."
      />

      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {data?.error ? <Notice message={data.error} tone="warning" /> : null}
      {decide.isError ? <ErrorMsg message={(decide.error as Error).message} /> : null}

      <div className="kpi-grid dash-section">
        <KpiCard label="Awaiting a decision" value={formatNumber(isLoading ? null : remaining)} sub="Uncertain after rules, ML and AI" variant="warning" />
        <KpiCard label="Merged this session" value={formatNumber(merged)} sub="Linked into one master record" variant="success" />
        <KpiCard label="Kept separate" value={formatNumber(separated)} sub="Recorded as different people" variant="critical" />
        <KpiCard label="Audit trail" value="100%" sub="Every decision attributed to a steward" variant="accent" />
      </div>

      <div className="filter-row">
        <div className="period-toggle" role="group" aria-label="Filter by AI suggestion">
          {[
            ['', 'All pairs'],
            ['MATCH', 'AI: likely same'],
            ['NO_MATCH', 'AI: likely different'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="period-btn"
              aria-pressed={suggestion === value}
              onClick={() => {
                setSuggestion(value);
                setPage(0);
                setSelectedKey(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          className="fwa-input"
          style={{ minWidth: 240 }}
          placeholder="Search a name…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              setSearch(searchInput);
              setPage(0);
              setSelectedKey(null);
            }
          }}
        />
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setSearch(searchInput);
            setPage(0);
            setSelectedKey(null);
          }}
        >
          Search
        </button>
        {isFetching ? <span className="muted">Refreshing…</span> : null}
      </div>

      <div className="workbench">
        {/* Queue */}
        <div className="wb-queue fwa-card">
          <div className="fwa-card-header">
            <span>Review queue</span>
            <span className="muted">{formatNumber(total)} pairs</span>
          </div>
          <div className="wb-queue-list">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton wb-card-skel" />)
            ) : items.length === 0 ? (
              <div className="empty-state">Nothing waiting here. Every pair on this page is decided.</div>
            ) : (
              items.map((p) => {
                const key = pairKey(p);
                const twin = isTwinPattern(p);
                return (
                  <div
                    key={key}
                    className={`wb-card${key === selectedKey ? ' selected' : ''}${dragKey === key ? ' dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', key);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragKey(key);
                      setSelectedKey(key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setHoverZone(null);
                    }}
                    onClick={() => setSelectedKey(key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') setSelectedKey(key);
                    }}
                    aria-label={`Pair ${fullName(p.a)} and ${fullName(p.b)}`}
                  >
                    <div className="wb-card-grip" aria-hidden>⋮⋮</div>
                    <div className="wb-card-body">
                      <div className="wb-card-names">
                        <span>{fullName(p.a)}</span>
                        <span className="wb-vs">↔</span>
                        <span>{fullName(p.b)}</span>
                      </div>
                      <div className="wb-card-meta">
                        <SourceChip code={p.a.source_system} />
                        <SourceChip code={p.b.source_system} />
                        <span className="wb-score" title="Snowflake ML probability">ML {Math.round(p.hybrid_score * 100)}%</span>
                        {p.guard_fields !== null ? (
                          <span className={`wb-guards${p.guard_fields >= 3 ? ' ok' : ''}`} title="Corroborating fields; severe-risk policy needs 3 to auto-merge">
                            {p.guard_fields} of 3 guards
                          </span>
                        ) : null}
                        {twin ? <span className="twin-flag">Possible twin</span> : null}
                      </div>
                      <AiBadge decision={p.ai_decision} confidence={p.ai_confidence} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="pagination-row">
            <span>Page {page + 1} of {totalPages}</span>
            <div className="pagination-controls">
              <button type="button" className="pagination-btn" disabled={page === 0} onClick={() => { setPage((p) => Math.max(0, p - 1)); setSelectedKey(null); }}>Previous</button>
              <button type="button" className="pagination-btn" disabled={page + 1 >= totalPages} onClick={() => { setPage((p) => p + 1); setSelectedKey(null); }}>Next</button>
            </div>
          </div>
        </div>

        {/* Compare */}
        <div className="wb-compare fwa-card">
          {selected ? (
            <>
              <div className="fwa-card-header">
                <span>Side-by-side comparison</span>
                <span className="muted">Rows {selected.row_a} · {selected.row_b}</span>
              </div>
              <div className="cmp-head">
                <div />
                <div>
                  <SourceChip code={selected.a.source_system} />
                  <div className="cmp-src">{sourceLabel(selected.a.source_system)}</div>
                  <div className="data-id">{selected.a.source_record_id}</div>
                </div>
                <div>
                  <SourceChip code={selected.b.source_system} />
                  <div className="cmp-src">{sourceLabel(selected.b.source_system)}</div>
                  <div className="data-id">{selected.b.source_record_id}</div>
                </div>
              </div>
              <div className="cmp-rows">
                {compareRows(selected).map((r) => (
                  <div key={r.label} className={`cmp-row ${r.state}`}>
                    <div className="cmp-label">
                      <span className={`cmp-dot ${r.state}`} aria-hidden />
                      {r.label}
                    </div>
                    <div className="cmp-val">{r.a ?? <em>missing</em>}</div>
                    <div className="cmp-val">{r.b ?? <em>missing</em>}</div>
                  </div>
                ))}
              </div>
              <div className="cmp-legend">
                <span><i className="cmp-dot agree" />Agrees</span>
                <span><i className="cmp-dot differ" />Conflicts</span>
                <span><i className="cmp-dot missing" />Missing on one side</span>
              </div>
              <div className="ai-panel">
                <div className="ai-panel-title">
                  <span className="ai-spark" aria-hidden>✦</span> Cortex AI assessment
                  <AiBadge decision={selected.ai_decision} confidence={selected.ai_confidence} />
                </div>
                <p>{selected.evidence ?? 'No AI reasoning was recorded for this pair.'}</p>
                <div className="muted" style={{ fontSize: 11.5 }}>
                  Snowflake ML probability {Math.round(selected.hybrid_score * 100)}%
                  {selected.guard_fields !== null ? ` · ${selected.guard_fields} of 3 required corroborating fields` : ''}
                  {' '}· Cortex AI claude-sonnet-4-5 · advisory only, a steward decides
                </div>
              </div>
              <div className="cmp-actions">
                <button type="button" className="btn-success" onClick={() => startDecision(selected, 'APPROVE')} disabled={decide.isPending}>
                  Same {terms.entity.toLowerCase()}, merge
                </button>
                <button type="button" className="btn-danger" onClick={() => startDecision(selected, 'REJECT')} disabled={decide.isPending}>
                  Different {terms.entityPlural.toLowerCase()}
                </button>
              </div>
            </>
          ) : (
            <div className="empty-state">Select a pair to compare.</div>
          )}
        </div>

        {/* Drop zones */}
        <div className="wb-zones">
          <div
            className={`drop-zone merge${hoverZone === 'APPROVE' ? ' over' : ''}${dragKey ? ' armed' : ''}`}
            {...zoneProps('APPROVE')}
          >
            <div className="dz-icon" aria-hidden>⇄</div>
            <div className="dz-title">Same {terms.entity.toLowerCase()}</div>
            <div className="dz-sub">Drop to merge into one {terms.goldenRecord}</div>
          </div>
          <div
            className={`drop-zone split${hoverZone === 'REJECT' ? ' over' : ''}${dragKey ? ' armed' : ''}`}
            {...zoneProps('REJECT')}
          >
            <div className="dz-icon" aria-hidden>⇹</div>
            <div className="dz-title">Different {terms.entityPlural.toLowerCase()}</div>
            <div className="dz-sub">Drop to keep them separate, permanently recorded</div>
          </div>

          <div className="fwa-card wb-log">
            <div className="fwa-card-header"><span>This session</span></div>
            <div className="wb-log-list">
              {decide.isPending ? <div className="wb-log-item pending">Applying decision and rebuilding master records…</div> : null}
              {outcomes.length === 0 && !decide.isPending ? (
                <div className="empty-state" style={{ padding: 20 }}>Decisions you make appear here.</div>
              ) : null}
              {outcomes.map((o) => (
                <div key={o.key} className={`wb-log-item ${o.decision === 'APPROVE' ? 'merge' : 'split'}`}>
                  <div className="wb-log-label">{o.label}</div>
                  <div className="wb-log-meta">
                    {o.decision === 'APPROVE' ? 'Merged' : 'Kept separate'}
                    {o.masterId ? (
                      <>
                        {' · '}
                        <Link href={`/${config.entities[0].slug}/360?id=${o.masterId}`}>{o.masterId}</Link>
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {pending ? (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
          <div className="modal">
            <h3 id="confirm-title">
              {pending.decision === 'APPROVE' ? `Merge into one ${terms.entity.toLowerCase()}?` : `Keep as different ${terms.entityPlural.toLowerCase()}?`}
            </h3>
            <p className="modal-pair">
              <strong>{fullName(pending.pair.a)}</strong> ({sourceLabel(pending.pair.a.source_system)})<br />
              <strong>{fullName(pending.pair.b)}</strong> ({sourceLabel(pending.pair.b.source_system)})
            </p>
            {pending.decision === 'APPROVE' && isTwinPattern(pending.pair) ? (
              <div className="alert-banner warning">
                Same surname and birth date with different first names. Confirm this is not a twin before merging.
              </div>
            ) : null}
            <label className="fwa-label" htmlFor="steward-note">Steward note (optional, kept in the audit log)</label>
            <input
              id="steward-note"
              className="fwa-input"
              style={{ width: '100%' }}
              maxLength={400}
              autoFocus
              value={note}
              placeholder={pending.decision === 'APPROVE' ? 'e.g. Confirmed with ORI case worker: same A-number' : 'e.g. Twins, verified with household composition'}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') confirm();
                if (e.key === 'Escape') setPending(null);
              }}
            />
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setPending(null)}>Cancel</button>
              <button
                type="button"
                className={pending.decision === 'APPROVE' ? 'btn-success' : 'btn-danger-solid'}
                onClick={confirm}
              >
                {pending.decision === 'APPROVE' ? 'Confirm merge' : 'Confirm separate'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
