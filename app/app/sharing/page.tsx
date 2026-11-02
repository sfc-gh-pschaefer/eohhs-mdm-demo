'use client';

import { useQuery } from '@tanstack/react-query';

import { ErrorMsg, KpiCard, PageHeader, TableSkeleton, formatNumber } from '@/components/ui';
import { eohhsApi } from '@/lib/api';
import { SOURCE_COLORS } from '@/lib/sources';

const ROLE: Record<string, { label: string; sends: string; gets: string }> = {
  MASSHEALTH: {
    label: 'MassHealth',
    sends: 'Member master records: name, DOB, sex, address, phone, email, SSN last 4, salted tokens, program summary.',
    gets: 'EOHHS ID per member, plus which other agencies (excluding BSAS) serve that member.',
  },
  DTA: {
    label: 'DTA',
    sends: 'Client master records: same attributes as MassHealth, program summary (SNAP, TAFDC, EAEDC).',
    gets: 'EOHHS ID per client, plus which other agencies (excluding BSAS) serve that client.',
  },
  BSAS: {
    label: 'BSAS',
    sends: 'Salted tokens only (SSN, name + DOB, name + DOB + ZIP) and an in-treatment flag. No name, DOB, address or program detail (42 CFR Part 2).',
    gets: 'EOHHS ID per client, plus the full list of agencies serving that client, so BSAS can coordinate care.',
  },
  EHS: {
    label: 'EHS',
    sends: 'Refugee services and HST rider master records: name, DOB, address, phone, A-number stays at EHS.',
    gets: 'EOHHS ID per client, plus which other agencies (excluding BSAS) serve that client.',
  },
};

/** Field-level view of what crosses each agency boundary. Hub only. */
export default function SharingPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['sharing'], queryFn: eohhsApi.sharing });

  return (
    <div className="page-content">
      <PageHeader
        title="Sharing"
        subtitle="Each agency resolves its own records, then shares only its MASTER_GOLD export. The EOHHS ID flows back."
      />
      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {isLoading ? <TableSkeleton rows={6} /> : null}

      {data ? (
        <>
          <div className="kpi-grid dash-section">
            {data.exports.map((e) => (
              <KpiCard key={e.agency} label={`${ROLE[e.agency]?.label ?? e.agency} records shared`} value={formatNumber(e.rows)} sub={`${e.columns.length} columns`} />
            ))}
            <KpiCard label="BSAS clients linked on tokens" value={formatNumber(data.bsasLinked)} sub="Linked to at least one other agency" variant="accent" />
          </div>

          <div className="grid-2 dash-section">
            {data.exports.map((e) => {
              const wb = data.writeback.find((w) => w.agency === e.agency);
              const role = ROLE[e.agency];
              return (
                <div key={e.agency} className="fwa-card" style={{ borderTop: `4px solid ${SOURCE_COLORS[e.agency] ?? '#475569'}` }}>
                  <div className="fwa-card-header">
                    <span>{role?.label ?? e.agency}</span>
                    <span className="muted">{e.agency}.MASTER_GOLD.HUB_EXPORT</span>
                  </div>
                  <div className="fwa-card-body">
                    <div className="share-label">Sends to the hub</div>
                    <p className="card-note" style={{ marginTop: 2 }}>{role?.sends}</p>
                    <div className="chip-row" style={{ flexWrap: 'wrap', margin: '6px 0 12px' }}>
                      {e.columns.map((c) => (
                        <span key={c} className={`col-chip ${c.startsWith('TOKEN_') ? 'token' : ''}`}>{c}</span>
                      ))}
                    </div>
                    <div className="share-label">Gets back</div>
                    <p className="card-note" style={{ marginTop: 2 }}>{role?.gets}</p>
                    <p className="card-note">
                      <b>{formatNumber(wb?.mapped ?? 0)}</b> EOHHS IDs written to {e.agency}.MASTER_GOLD.EOHHS_ID_MAP;{' '}
                      <b>{formatNumber(wb?.linked_elsewhere ?? 0)}</b> of them are served by another agency.
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="fwa-card dash-section">
            <div className="fwa-card-header"><span>Why BSAS is different</span><span className="muted">42 CFR Part 2</span></div>
            <div className="fwa-card-body">
              <p className="card-note">
                Substance use disorder treatment records cannot be redisclosed without consent. BSAS hashes identifiers with
                a shared salt inside its own database, so the hub can test equality (same SSN, same name and DOB, same ZIP)
                without ever holding the values. The match runs on tokens; the treatment record never leaves BSAS.
              </p>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
