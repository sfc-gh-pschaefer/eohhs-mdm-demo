'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, ErrorMsg, PageHeader, TableSkeleton, formatNumber } from '@/components/ui';
import { api, eohhsApi } from '@/lib/api';
import { ALERT_ACTION, ALERT_LABEL } from '@/lib/alerts';
import { config } from '@/lib/config';
import { IS_HUB } from '@/lib/deployment';
import { SOURCE_COLORS, SOURCE_LABELS, SOURCE_SHORT } from '@/lib/sources';
import { terms } from '@/lib/terminology';

const SLUG = config.entities[0].slug;
const ID_PATTERN = /^(EOH|MH)-\d+$/;

const RULE_LABEL: Record<string, string> = {
  T1_S0_SSN_CORROBORATED: 'SSN + corroboration',
  T1_S1_SSN4_DOB_NAME: 'SSN4 + DOB + name',
  T1_S2_EMAIL_DOB: 'Email + DOB',
  T1_S3_NAME_DOB_ZIP: 'Name + DOB + ZIP',
  T1_S4_PHONE_DOB_FIRST: 'Phone + DOB + first',
  T1_S5_JW_NAME_DOB_ZIP_ADDR: 'Fuzzy name + guards',
  T1_S6_TOKEN_NAME_DOB_ZIP: 'Salted token (BSAS)',
  T2_ML: 'ML classifier',
  T3_LLM: 'Cortex AI',
  STEWARD_APPROVED: 'Steward approved',
  TRANSITIVE: 'Linked via other records',
};

/** Survivorship notes per attribute, matching REFRESH_MASTER. */
const NOTES = IS_HUB
  ? { name: 'MassHealth, then DTA, then EHS', dob: 'MassHealth first', contact: 'DTA first', address: 'Most recent across agencies' }
  : { name: 'MMIS, then MA-21, then HIX', dob: 'MMIS (system of record)', contact: 'HIX first', address: 'Most recently updated' };

function s(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

function date(v: unknown): string | null {
  const t = s(v);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toISOString().slice(0, 10);
}

function phone(v: unknown): string | null {
  const t = s(v);
  return t && t.length === 10 ? `(${t.slice(0, 3)}) ${t.slice(3, 6)}-${t.slice(6)}` : t;
}

function Chip({ code }: { code: unknown }) {
  const c = String(code ?? '');
  return (
    <span className="source-chip" style={{ background: SOURCE_COLORS[c] ?? '#475569' }}>
      {SOURCE_SHORT[c] ?? c}
    </span>
  );
}

/** Which source records hold the surviving value, so lineage is visible per field. */
function providers(records: Record<string, unknown>[], field: string, value: string | null) {
  if (!value) return [];
  const v = value.toUpperCase();
  return [
    ...new Set(
      records
        .filter((r) => {
          const rv = field === 'dob_clean' ? date(r[field]) : s(r[field]);
          return rv !== null && rv.toUpperCase() === v;
        })
        .map((r) => String(r._source_system)),
    ),
  ];
}

function PersonSearch() {
  const router = useRouter();
  const [term, setTerm] = useState('');
  const [submitted, setSubmitted] = useState('');
  const { data, isFetching } = useQuery({
    queryKey: ['person-search', submitted],
    queryFn: () => api.goldenRecords(SLUG, { limit: 12, offset: 0, min_cluster_size: 1, search: submitted }),
    enabled: submitted.length > 0,
  });

  return (
    <div className="fwa-card dash-section">
      <div className="fwa-card-header"><span>Find a {terms.entity.toLowerCase()}</span></div>
      <div className="fwa-card-body">
        <div className="filter-row" style={{ marginBottom: 0 }}>
          <input
            className="fwa-input"
            style={{ minWidth: 320 }}
            placeholder={IS_HUB ? 'Name, EOHHS ID or city' : 'Name, master ID, MMIS member ID or city'}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setSubmitted(term.trim());
            }}
          />
          <button type="button" className="btn-primary" onClick={() => setSubmitted(term.trim())}>Search</button>
          <button type="button" className="btn-ghost" onClick={() => { setTerm('Ana Oliveira'); setSubmitted('Ana Oliveira'); }}>
            Try Ana Oliveira
          </button>
          {isFetching ? <span className="muted">Searching…</span> : null}
        </div>
        {data && data.items.length > 0 ? (
          <div className="search-results">
            {data.items.map((r) => (
              <button
                key={String(r.master_id)}
                type="button"
                className="search-hit"
                onClick={() => router.push(`/${SLUG}/360?id=${String(r.master_id)}`)}
              >
                <span className="search-hit-name">{String(r.display_name ?? '')}</span>
                <span className="data-id">{String(r.master_id)}</span>
                <span className="muted">{date(r.dob_clean) ?? ''}</span>
                <span className="muted">{String(r.source_systems ?? '')}</span>
              </button>
            ))}
          </div>
        ) : submitted && data ? (
          <div className="muted" style={{ marginTop: 10 }}>No {terms.entityPlural.toLowerCase()} match &ldquo;{submitted}&rdquo;.</div>
        ) : null}
      </div>
    </div>
  );
}

export function Person360View() {
  const params = useSearchParams();
  const id = params.get('id') ?? '';

  const { data, isLoading, error } = useQuery({
    queryKey: ['person360', id],
    queryFn: () => eohhsApi.person(id),
    enabled: ID_PATTERN.test(id),
  });

  const m = data?.master;
  const recs = data?.records ?? [];
  const tokenOnly = recs.filter((r) => !s(r.last_name_clean) && !s(r.dob_clean));

  const fields: { label: string; value: string | null; field: string; note?: string; match?: string | null }[] = m
    ? [
        { label: 'Name', value: [s(m.first_name_clean), s(m.middle_name), s(m.last_name_clean)].filter(Boolean).join(' '), field: 'last_name_clean', match: s(m.last_name_clean), note: NOTES.name },
        { label: 'Date of birth', value: date(m.dob_clean), field: 'dob_clean', note: NOTES.dob },
        { label: 'SSN', value: s(m.ssn_last4) ? `•••-••-${s(m.ssn_last4)}` : null, field: 'ssn_last4', match: s(m.ssn_last4), note: 'Evidence only, masked' },
        { label: terms.masterId, value: s(m.master_id), field: '_none', note: IS_HUB ? 'Written back to every agency' : 'Passed up to the EOHHS hub' },
        ...(IS_HUB ? [] : [{ label: 'MMIS member ID', value: s(m.agency_id), field: 'agency_id', note: 'System of record' }]),
        { label: 'Address', value: s(m.address_clean), field: 'address_street_clean', match: s(m.address_street_clean), note: NOTES.address },
        { label: 'Email', value: s(m.email_clean), field: 'email_clean', note: NOTES.contact },
        { label: 'Phone', value: phone(m.phone_clean), field: 'phone_clean', match: s(m.phone_clean), note: NOTES.contact },
      ]
    : [];

  return (
    <div className="page-content">
      <PageHeader
        title={`${terms.entity} 360`}
        subtitle={IS_HUB ? "Every agency's view of a resident, reconciled into one EOHHS ID" : "Every MassHealth system's view of a member, reconciled into one master record"}
      />
      <PersonSearch />

      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {!id ? <EmptyState message={`Search for a ${terms.entity.toLowerCase()}, or try Ana Oliveira.`} /> : null}
      {isLoading ? <TableSkeleton rows={6} /> : null}

      {m ? (
        <>
          <div className="s360-hero dash-section">
            <div className="s360-avatar" aria-hidden>
              {String(m.first_name_clean ?? '?')[0]}
              {String(m.last_name_clean ?? '?')[0]}
            </div>
            <div style={{ flex: 1 }}>
              <div className="s360-name">{String(m.display_name ?? 'Token-only record')}</div>
              <div className="s360-meta">
                <span className="data-id">{String(m.master_id)}</span>
                <span>DOB {date(m.dob_clean) ?? 'unknown'}</span>
                <span>{String(m.address_city ?? '')}</span>
              </div>
              <div className="s360-chips">
                {String(m.source_systems ?? '').split(', ').filter(Boolean).map((c) => <Chip key={c} code={c} />)}
                {m.steward_flag ? <span className="twin-flag">{String(m.steward_flag)}</span> : null}
              </div>
            </div>
            <div className="s360-stats">
              <div><b>{formatNumber(m.cluster_size)}</b><span>{IS_HUB ? 'agency records' : 'source records'}</span></div>
              <div><b>{formatNumber(m.source_count)}</b><span>{IS_HUB ? 'agencies' : 'systems'}</span></div>
              <div><b>{formatNumber(m.quality_score)}%</b><span>complete</span></div>
            </div>
          </div>

          {(data?.alerts ?? []).map((a, i) => (
            <div key={i} className="lc-alert dash-section" role="alert">
              <b>{ALERT_LABEL[String(a.alert_type)] ?? String(a.alert_type)}</b>
              <span>{String(a.detail)}. {ALERT_ACTION[String(a.alert_type)] ?? ''}</span>
              {a.amount_at_risk != null ? <span className="lc-alert-amt">${formatNumber(Math.round(Number(a.amount_at_risk)))} a year</span> : null}
            </div>
          ))}

          <div className="grid-2 dash-section">
            <div className="fwa-card">
              <div className="fwa-card-header">
                <span>{terms.goldenRecord}</span>
                <span className="muted">Survivorship by attribute</span>
              </div>
              <table className="fwa-table">
                <thead><tr><th>Attribute</th><th>Surviving value</th><th>Supplied by</th></tr></thead>
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.label}>
                      <td style={{ fontWeight: 600 }}>{f.label}<div className="muted" style={{ fontSize: 11 }}>{f.note}</div></td>
                      <td>{f.value ?? <em className="muted">not on file</em>}</td>
                      <td>
                        <div className="chip-row">
                          {f.field === '_none' ? null : providers(recs, f.field, f.match !== undefined ? f.match : f.value).map((c) => <Chip key={c} code={c} />)}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="fwa-card">
              <div className="fwa-card-header">
                <span>{IS_HUB ? 'Agency footprint' : 'EOHHS link'}</span>
                <span className="muted">{IS_HUB ? 'Programs each agency reports' : 'Written back by the hub'}</span>
              </div>
              <div className="link-list">
                {IS_HUB ? (
                  recs.map((r) => (
                    <div key={String(r.row_id)} className="link-item">
                      <div className="link-top">
                        <Chip code={r._source_system} />
                        <span className="data-id">{String(r.source_record_id)}</span>
                        <span className={`rule-pill ${r.program_status === 'ACTIVE' ? 'ok' : ''}`}>{String(r.program_status ?? '')}</span>
                      </div>
                      <div className="link-evidence">
                        {r._source_system === 'BSAS'
                          ? 'Linked by salted token. Program detail stays at BSAS (42 CFR Part 2).'
                          : String(r.program ?? '').replace(/^[^:]+: /, '') || 'No program detail'}
                      </div>
                    </div>
                  ))
                ) : data?.eohhs ? (
                  <div className="link-item">
                    <div className="link-top">
                      <span className="data-id">{String(data.eohhs.eohhs_id)}</span>
                      <span className="rule-pill ok">EOHHS ID</span>
                    </div>
                    <div className="link-evidence">
                      Known to: {String(data.eohhs.linked_agencies ?? 'MASSHEALTH')}. BSAS participation is never shown outside BSAS.
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">The hub has not written an EOHHS ID back yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="grid-2 dash-section">
            <div className="fwa-card">
              <div className="fwa-card-header">
                <span>Why these records were linked</span>
                <span className="muted">{formatNumber(data?.links.length)} links</span>
              </div>
              <div className="link-list">
                {(data?.links ?? []).map((l, i) => (
                  <div key={i} className="link-item">
                    <div className="link-top">
                      <Chip code={l.source_a} /> <span className="wb-vs">↔</span> <Chip code={l.source_b} />
                      <span className="rule-pill">{RULE_LABEL[String(l.match_type)] ?? String(l.match_type)}</span>
                      <span className="wb-score">{Math.round(Number(l.hybrid_score) * 100)}%</span>
                    </div>
                    {l.evidence ? <div className="link-evidence">{String(l.evidence)}</div> : null}
                  </div>
                ))}
                {data?.links.length === 0 ? <div className="empty-state">Single record, nothing to link.</div> : null}
              </div>
            </div>

            <div className="fwa-card">
              <div className="fwa-card-header">
                <span>Timeline</span>
                <span className="muted">Every record, stitched by the cross-reference</span>
              </div>
              <div className="link-list">
                {(data?.lifecycle ?? []).map((e, i) => (
                  <div key={i} className="link-item">
                    <div className="link-top">
                      <span className="muted" style={{ minWidth: 84 }}>{date(e.event_ts) ?? 'date unknown'}</span>
                      <Chip code={e._source_system} />
                      <b>{e._source_system === 'BSAS' ? 'BSAS record' : String(e.stage ?? '').replace(/^[^:]+: /, '')}</b>
                      <span className="rule-pill">{String(e.status ?? '')}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="fwa-card dash-section">
            <div className="fwa-card-header"><span>{IS_HUB ? 'Agency records' : 'Source records'}</span><span className="muted">As each {IS_HUB ? 'agency' : 'system'} holds them</span></div>
            <div className="table-scroll">
              <table className="fwa-table">
                <thead>
                  <tr><th>{IS_HUB ? 'Agency' : 'System'}</th><th>Record ID</th><th>First</th><th>Last</th><th>DOB</th><th>SSN4</th><th>Email</th><th>Phone</th><th>Address</th><th>Updated</th></tr>
                </thead>
                <tbody>
                  {recs.map((r) => (
                    <tr key={String(r.row_id)} className={r.is_anchor ? 'anchor-row' : ''}>
                      <td><Chip code={r._source_system} /></td>
                      <td className="data-id">{String(r.source_record_id)}</td>
                      <td>{s(r.first_name_as_given) ?? '—'}</td>
                      <td>{s(r.last_name_clean) ?? '—'}</td>
                      <td>{date(r.dob_clean) ?? '—'}</td>
                      <td className="data-id">{s(r.ssn_last4) ?? '—'}</td>
                      <td>{s(r.email_clean) ?? '—'}</td>
                      <td>{phone(r.phone_clean) ?? '—'}</td>
                      <td>{[s(r.address_street_clean), s(r.address_zip)].filter(Boolean).join(' ') || '—'}</td>
                      <td className="muted">{date(r._load_ts) ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {tokenOnly.length > 0 ? (
              <div className="card-note" style={{ padding: '0 16px 12px' }}>
                Blank rows are BSAS: the hub holds only salted tokens for them, so there is nothing to display.
              </div>
            ) : null}
          </div>

          {(data?.pending.length ?? 0) > 0 || (data?.decisions.length ?? 0) > 0 ? (
            <div className="grid-2 dash-section">
              <div className="fwa-card">
                <div className="fwa-card-header"><span>Open stewardship items</span></div>
                <div className="link-list">
                  {(data?.pending ?? []).map((p, i) => (
                    <div key={i} className="link-item">
                      <div className="link-top">
                        <b>{String(p.name_a)}</b> <span className="wb-vs">↔</span> <b>{String(p.name_b)}</b>
                        <Link href={`/${SLUG}/workbench?search=${encodeURIComponent(String(p.name_a).split(' ').pop() ?? '')}`} className="btn-ghost btn-sm">Review</Link>
                      </div>
                      {p.evidence ? <div className="link-evidence">{String(p.evidence)}</div> : null}
                    </div>
                  ))}
                  {data?.pending.length === 0 ? <div className="empty-state">No open items.</div> : null}
                </div>
              </div>
              <div className="fwa-card">
                <div className="fwa-card-header"><span>Steward decision history</span></div>
                <div className="link-list">
                  {(data?.decisions ?? []).map((d, i) => (
                    <div key={i} className="link-item">
                      <div className="link-top">
                        <span className={`rule-pill ${d.decision === 'APPROVE' ? 'ok' : 'no'}`}>{d.decision === 'APPROVE' ? 'Merged' : 'Kept separate'}</span>
                        <span>{String(d.decided_by)}</span>
                        <span className="muted">{String(d.decided_at ?? '').slice(0, 16).replace('T', ' ')}</span>
                      </div>
                      {d.notes ? <div className="link-evidence">{String(d.notes)}</div> : null}
                    </div>
                  ))}
                  {data?.decisions.length === 0 ? <div className="empty-state">No steward decisions yet.</div> : null}
                </div>
              </div>
            </div>
          ) : null}
          <div className="muted" style={{ fontSize: 11.5 }}>Sources: {Object.values(SOURCE_LABELS).join(', ')}</div>
        </>
      ) : null}
    </div>
  );
}
