'use client';

import { useQuery } from '@tanstack/react-query';

import { ErrorMsg, KpiCard, PageHeader, TableSkeleton, formatNumber } from '@/components/ui';
import { eohhsApi } from '@/lib/api';
import { SOURCE_COLORS } from '@/lib/sources';

const AGENCIES = [
  { key: 'masshealth', code: 'MASSHEALTH', label: 'MassHealth' },
  { key: 'dta', code: 'DTA', label: 'DTA' },
  { key: 'bsas', code: 'BSAS', label: 'BSAS' },
  { key: 'ehs', code: 'EHS', label: 'EHS' },
] as const;

/**
 * UpSet-style view of agency footprints: one row per exact combination of
 * agencies, a dot matrix showing which agencies, and a bar for residents.
 * Hub only; aggregates, owner's rights.
 */
export default function OverlapPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['overlap'], queryFn: eohhsApi.overlap });
  const rows = data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.residents));
  const total = rows.reduce((a, r) => a + r.residents, 0);
  const multi = rows.filter((r) => r.n_agencies > 1).reduce((a, r) => a + r.residents, 0);
  const four = rows.filter((r) => r.n_agencies === 4).reduce((a, r) => a + r.residents, 0);

  return (
    <div className="page-content">
      <PageHeader title="Agency Overlap" subtitle="Which agencies serve the same resident, measured on resolved EOHHS IDs" />
      {error ? <ErrorMsg message={(error as Error).message} /> : null}

      <div className="kpi-grid dash-section">
        <KpiCard label="Residents" value={formatNumber(total)} sub="Distinct EOHHS IDs" variant="accent" />
        <KpiCard label="Served by 2+ agencies" value={formatNumber(multi)} sub={total ? `${((100 * multi) / total).toFixed(0)}% of residents` : ''} />
        <KpiCard label="Served by all four" value={formatNumber(four)} sub="MassHealth, DTA, BSAS, EHS" />
        {AGENCIES.map((a) => (
          <KpiCard key={a.code} label={a.label} value={formatNumber(data?.totals[a.code] ?? 0)} sub="Residents" />
        ))}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Exact agency combinations</span>
          <span className="muted">Each resident counted once, in exactly one row</span>
        </div>
        {isLoading ? <TableSkeleton rows={10} /> : null}
        <div className="fwa-card-body">
          <div className="upset">
            <div className="upset-head">
              {AGENCIES.map((a) => <div key={a.code} className="upset-col">{a.label}</div>)}
              <div className="upset-bar-head">Residents</div>
            </div>
            {rows.map((r) => (
              <div key={r.combination} className="upset-row">
                {AGENCIES.map((a) => {
                  const on = r[a.key];
                  return (
                    <div key={a.code} className="upset-col">
                      <span className="upset-dot" style={{ background: on ? SOURCE_COLORS[a.code] : '#E2E8F0' }} />
                    </div>
                  );
                })}
                <div className="upset-bar-cell">
                  <div className="upset-bar" style={{ width: `${(100 * r.residents) / max}%`, background: r.n_agencies > 1 ? '#14558F' : '#94A3B8' }} />
                  <span className="upset-n">{formatNumber(r.residents)}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="card-note">
            BSAS rows are counted from salted-token links. The hub knows a resident is also a BSAS client; it never sees
            the treatment record itself. Agency apps never see BSAS in this footprint.
          </p>
        </div>
      </div>
    </div>
  );
}
