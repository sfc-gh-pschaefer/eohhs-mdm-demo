'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { DonutChart, MiniHBars, SankeyChart, type SankeyLink } from '@/components/charts';
import { ErrorMsg, KpiCard, KpiSkeleton, Notice, formatNumber } from '@/components/ui';
import { eohhsApi } from '@/lib/api';
import { config } from '@/lib/config';
import { IS_HUB } from '@/lib/deployment';
import { SOURCE_COLORS, SOURCE_LABELS } from '@/lib/sources';
import { terms } from '@/lib/terminology';
import { ALERT_LABEL } from '@/lib/alerts';

/**
 * Executive overview. Source systems (or agencies, on the hub) flow into
 * master records; the scorecard is measured against the synthetic answer key
 * so precision and recall are real numbers.
 */
export default function OverviewPage() {
  const { data, isLoading, error } = useQuery({ queryKey: ['overview'], queryFn: eohhsApi.overview });
  const slug = config.entities[0].slug;

  const sc = data?.scorecard;
  const reduction = sc && sc.source_records > 0 ? (1 - sc.master_records / sc.source_records) * 100 : 0;
  const multi = data?.overlap.filter((o) => o.systems > 1).reduce((a, o) => a + o.masters, 0) ?? 0;
  const unit = IS_HUB ? 'agency' : 'system';
  const nSources = Object.keys(SOURCE_LABELS).length;

  const masterNode = (n: number) => (n === 1 ? `Known to 1 ${unit}` : `Known to ${n} ${unit === 'agency' ? 'agencies' : 'systems'}`);
  const masterColors = ['#94A3B8', '#60A5FA', '#2563EB', '#1E3A8A'];
  const levels = Array.from({ length: nSources }, (_, i) => nSources - i);
  const nodes = [
    ...Object.keys(SOURCE_LABELS).map((s) => ({ name: SOURCE_LABELS[s], color: SOURCE_COLORS[s] })),
    ...levels.map((n) => ({ name: masterNode(n), color: masterColors[n - 1] })),
  ];
  const links: SankeyLink[] = (data?.flows ?? []).map((f) => ({
    source: SOURCE_LABELS[f.source] ?? f.source,
    target: masterNode(f.systems),
    value: f.records,
  }));

  const tierColor = (tier: string) =>
    tier === 'T2_ML' ? '#7C3AED'
    : tier === 'T3_LLM' ? '#0891B2'
    : tier === 'STEWARD_APPROVED' ? '#15803D'
    : tier === 'TRANSITIVE' ? '#94A3B8'
    : tier === 'T1_S6_TOKEN_NAME_DOB_ZIP' ? '#8A2BE2'
    : '#2563EB';

  const aiItems = (data?.ai ?? []).reduce<Record<string, number>>((acc, a) => {
    const key =
      a.outcome === 'AUTO_MERGE' ? 'AI merged (high confidence)'
      : a.outcome === 'AUTO_REJECT' ? 'AI separated (high confidence)'
      : 'Sent to a steward';
    acc[key] = (acc[key] ?? 0) + a.n;
    return acc;
  }, {});
  const aiColors: Record<string, string> = {
    'AI merged (high confidence)': '#0891B2',
    'AI separated (high confidence)': '#DC2626',
    'Sent to a steward': '#D97706',
  };
  const aiTotal = Object.values(aiItems).reduce((a, b) => a + b, 0);
  const tokenLinks = data?.tiers.find((t) => t.tier === 'T1_S6_TOKEN_NAME_DOB_ZIP')?.pairs ?? 0;

  return (
    <div className="page-content">
      <div className="hero">
        <div>
          <div className="hero-eyebrow">{IS_HUB ? 'Commonwealth Resident Index' : 'MassHealth Member Index'}</div>
          <h1 className="hero-title">
            {IS_HUB ? 'One resident, every EOHHS agency' : 'One member record across MMIS, HIX and MA-21'}
          </h1>
          <p className="hero-sub">
            {IS_HUB
              ? 'MassHealth, DTA, BSAS and EHS each resolve their own records first, then pass their master records to the hub. Snowflake links them into one EOHHS ID using rules, machine learning, Cortex AI and human stewards. BSAS shares salted tokens only.'
              : 'MMIS, the Health Connector and MA-21 each key a member differently. Snowflake resolves them into one governed master record using rules, machine learning, Cortex AI and human stewards, then passes it to the EOHHS hub.'}
          </p>
        </div>
        <div className="hero-actions">
          <Link href={`/${slug}/workbench`} className="btn-gold">Open Steward Workbench</Link>
          <Link href={`/${slug}/360`} className="btn-hero-ghost">Find a {terms.entity.toLowerCase()}</Link>
        </div>
      </div>

      {error ? <ErrorMsg message={(error as Error).message} /> : null}
      {!isLoading && !sc && !error ? (
        <Notice message="The pipeline has not produced a scorecard yet. Run run_pipeline.sh, then refresh." />
      ) : null}

      <div className="kpi-grid dash-section">
        {isLoading ? (
          <>
            <KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton /><KpiSkeleton />
          </>
        ) : sc ? (
          <>
            <KpiCard
              label={IS_HUB ? 'Agency master records' : 'Source records'}
              value={formatNumber(sc.source_records)}
              sub={IS_HUB ? 'MassHealth, DTA, BSAS, EHS' : 'MMIS, HIX, MA-21'}
            />
            <KpiCard
              label={terms.goldenRecordPlural}
              value={formatNumber(sc.master_records)}
              sub={`${reduction.toFixed(1)}% fewer than ${IS_HUB ? 'agency records' : 'source rows'}`}
              variant="accent"
            />
            <KpiCard
              label="Match precision"
              value={`${sc.precision_pct.toFixed(1)}%`}
              sub={`${formatNumber(sc.false_merge_pairs)} false merges vs answer key`}
              variant="success"
            />
            <KpiCard label="Match recall" value={`${sc.recall_pct.toFixed(1)}%`} sub="True duplicates found" variant="success" />
            <KpiCard
              label="Awaiting a steward"
              value={formatNumber(sc.pending_review)}
              sub="Ambiguous pairs, never auto-merged"
              variant={sc.pending_review > 0 ? 'warning' : 'default'}
            />
          </>
        ) : null}
      </div>

      {sc ? (
        <div className="grid-2 dash-section">
          <div className="fwa-card">
            <div className="fwa-card-header">
              <span>Identifier independence</span>
              <span className="muted">SSN is evidence, never the key</span>
            </div>
            <div className="fwa-card-body">
              <div className="kpi-grid" style={{ gridTemplateColumns: IS_HUB ? '1fr 1fr 1fr' : '1fr 1fr' }}>
                <KpiCard
                  label="Links made without a shared SSN"
                  value={`${sc.links_without_ssn_pct.toFixed(0)}%`}
                  sub="Name, DOB, email, phone, address"
                  variant="accent"
                />
                <KpiCard
                  label={`${terms.entityPlural} resolved with no SSN at all`}
                  value={formatNumber(sc.masters_resolved_without_ssn)}
                  sub="Multi-record, zero SSNs"
                />
                {IS_HUB ? (
                  <KpiCard label="BSAS links made on tokens" value={formatNumber(tokenLinks)} sub="Hub never sees BSAS values" />
                ) : null}
              </div>
              <p className="card-note">
                {IS_HUB
                  ? 'The EOHHS ID becomes the cross-agency key, written back into every agency. Even when SSN tokens match, a second signal must agree before records merge.'
                  : 'The master ID becomes the cross-system key. Even when SSN matches, a second signal (DOB or last name) must agree before records merge.'}
              </p>
            </div>
          </div>
          <div className="fwa-card">
            <div className="fwa-card-header">
              <span>{IS_HUB ? 'Cross-agency alerts' : 'Enrollment alerts'}</span>
              <Link href={`/${slug}/alerts`} className="btn-ghost btn-sm">All alerts</Link>
            </div>
            <div className="fwa-card-body">
              {(data?.alerts ?? []).length === 0 ? (
                <p className="muted">No alerts.</p>
              ) : (
                <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {(data?.alerts ?? []).map((a) => (
                    <KpiCard
                      key={a.alert_type}
                      label={ALERT_LABEL[a.alert_type] ?? a.alert_type}
                      value={formatNumber(a.n)}
                      sub={a.amount ? `$${formatNumber(Math.round(a.amount))} a year at risk` : 'Visible only once records are joined'}
                      variant="warning"
                    />
                  ))}
                </div>
              )}
              <p className="card-note">
                {IS_HUB
                  ? 'DTA re-certified an address MassHealth still mails to; SNAP is open but MassHealth coverage is not. Each agency looks fine alone.'
                  : 'Two MMIS member IDs for one person means capitation is paid twice. Each record looks fine alone.'}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid-2-1 dash-section">
        <div className="fwa-card">
          <div className="fwa-card-header">
            <span>How {IS_HUB ? 'agency' : 'source'} records resolve into {terms.goldenRecordPlural}</span>
            <span className="muted">{formatNumber(multi)} {terms.entityPlural.toLowerCase()} reconciled across {IS_HUB ? 'agencies' : 'systems'}</span>
          </div>
          <div className="fwa-card-body">
            <SankeyChart nodes={nodes} links={links} height={330} />
          </div>
        </div>

        <div className="fwa-card">
          <div className="fwa-card-header"><span>{IS_HUB ? 'Agency contribution' : 'Source contribution'}</span></div>
          <div className="fwa-card-body source-list">
            {(data?.sources ?? []).map((s) => (
              <div key={s.source} className="source-row">
                <span className="source-dot" style={{ background: SOURCE_COLORS[s.source] }} />
                <div style={{ flex: 1 }}>
                  <div className="source-name">{SOURCE_LABELS[s.source] ?? s.source}</div>
                  <div className="source-meta">
                    {formatNumber(s.records)} records · avg completeness {s.avg_quality.toFixed(0)}%
                  </div>
                </div>
                <div className="source-count">{formatNumber(s.masters)}</div>
              </div>
            ))}
            <div className="source-foot">
              Right column: distinct {terms.entityPlural.toLowerCase()} each {unit} knows about.
            </div>
          </div>
        </div>
      </div>

      <div className="grid-2 dash-section">
        <div className="fwa-card">
          <div className="fwa-card-header">
            <span>Merges by matching tier</span>
            <Link href={`/${slug}/logic`} className="btn-ghost btn-sm">Rules</Link>
          </div>
          <div className="fwa-card-body">
            <MiniHBars
              rows={(data?.tiers ?? []).map((t) => ({ label: t.label, value: t.pairs, color: tierColor(t.tier) }))}
              labelWidth={150}
              ariaLabel="Merged pairs by matching tier"
            />
            <div className="tier-legend">
              <span><i style={{ background: '#2563EB' }} />Deterministic</span>
              {IS_HUB ? <span><i style={{ background: '#8A2BE2' }} />Token</span> : null}
              <span><i style={{ background: '#7C3AED' }} />ML classifier</span>
              <span><i style={{ background: '#0891B2' }} />Cortex AI</span>
              <span><i style={{ background: '#15803D' }} />Steward</span>
              <span><i style={{ background: '#94A3B8' }} />Already linked</span>
            </div>
          </div>
        </div>

        <div className="fwa-card">
          <div className="fwa-card-header">
            <span>Cortex AI review of uncertain pairs</span>
            <span className="muted">Every decision audited</span>
          </div>
          <div className="fwa-card-body">
            <DonutChart
              items={Object.entries(aiItems).map(([label, value]) => ({ label, value, color: aiColors[label] }))}
              centerLabel={aiTotal ? formatNumber(aiTotal) : undefined}
            />
            <p className="card-note">
              Only HIGH-confidence AI calls where SQL confirms a shared identifier act on their own. Everything else lands in
              the Steward Workbench with the AI&apos;s reasoning attached.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
