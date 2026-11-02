'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { EmptyState, ErrorMsg, KpiCard, PageHeader, TableSkeleton, formatNumber } from '@/components/ui';
import { eohhsApi } from '@/lib/api';
import { ALERT_ACTION, ALERT_LABEL } from '@/lib/alerts';
import { config } from '@/lib/config';
import { IS_HUB } from '@/lib/deployment';
import { SOURCE_COLORS, SOURCE_SHORT } from '@/lib/sources';

/**
 * Alerts that only exist once records are joined. Read with caller's rights,
 * so a row access policy can hide Part 2 alerts from users outside BSAS.
 */
export default function AlertsPage() {
  const [type, setType] = useState('');
  const slug = config.entities[0].slug;
  const { data, isLoading, error } = useQuery({
    queryKey: ['alerts', type],
    queryFn: () => eohhsApi.alerts({ type, limit: 100 }),
  });

  return (
    <div className="page-content">
      <PageHeader
        title="Alerts"
        subtitle={IS_HUB ? 'Problems no single agency can see on its own' : 'Problems no single MassHealth system can see on its own'}
      />
      {error ? <ErrorMsg message={(error as Error).message} /> : null}

      <div className="kpi-grid dash-section">
        {(data?.summary ?? []).map((a) => (
          <button
            key={a.alert_type}
            type="button"
            onClick={() => setType(type === a.alert_type ? '' : a.alert_type)}
            style={{ all: 'unset', cursor: 'pointer', outline: type === a.alert_type ? '2px solid var(--hesc-navy)' : 'none', borderRadius: 12 }}
          >
            <KpiCard
              label={ALERT_LABEL[a.alert_type] ?? a.alert_type}
              value={formatNumber(a.n)}
              sub={a.amount ? `$${formatNumber(Math.round(a.amount))} a year at risk` : ALERT_ACTION[a.alert_type] ?? ''}
              variant="warning"
            />
          </button>
        ))}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>{type ? ALERT_LABEL[type] ?? type : 'All alerts'}</span>
          <span className="muted">{type ? ALERT_ACTION[type] : 'Click a tile to filter'}</span>
        </div>
        {isLoading ? <TableSkeleton rows={8} /> : null}
        {data && data.items.length === 0 ? <EmptyState message="No alerts of this type are visible to your role." /> : null}
        {data && data.items.length > 0 ? (
          <div className="table-scroll">
            <table className="fwa-table">
              <thead>
                <tr><th>{IS_HUB ? 'EOHHS ID' : 'Master ID'}</th><th>Name</th><th>Alert</th><th>Detail</th><th>{IS_HUB ? 'Agencies' : 'Systems'}</th><th /></tr>
              </thead>
              <tbody>
                {data.items.map((r, i) => (
                  <tr key={i}>
                    <td className="data-id">{String(r.master_id)}</td>
                    <td style={{ fontWeight: 600 }}>{String(r.display_name ?? '')}<div className="muted" style={{ fontSize: 11 }}>{String(r.address_city ?? '')}</div></td>
                    <td><span className="rule-pill">{ALERT_LABEL[String(r.alert_type)] ?? String(r.alert_type)}</span></td>
                    <td style={{ maxWidth: 420 }}>{String(r.detail ?? '')}</td>
                    <td>
                      <div className="chip-row">
                        {String(r.source_systems ?? '').split(', ').filter(Boolean).map((c) => (
                          <span key={c} className="source-chip" style={{ background: SOURCE_COLORS[c] ?? '#475569' }}>{SOURCE_SHORT[c] ?? c}</span>
                        ))}
                      </div>
                    </td>
                    <td><Link className="btn-ghost btn-sm" href={`/${slug}/360?id=${String(r.master_id)}`}>Open 360</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}
