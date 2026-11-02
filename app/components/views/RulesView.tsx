'use client';

import { useQuery } from '@tanstack/react-query';

import { HBarChart, type HBarItem } from '@/components/charts';
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
} from '@/components/ui';
import { api } from '@/lib/api';
import type { EntityConfig } from '@/lib/config';
import { terms } from '@/lib/terminology';

const TIER_COLORS = ['#1E40AF', '#2563EB', '#3B82F6', '#60A5FA', '#93C5FD', '#7C3AED', '#A855F7'];

/**
 * How matching was configured for this entity.
 *
 * The previous version contained a long hand-written narrative with hard-coded
 * record counts, rule keys, thresholds, and warehouse names. That drifted from
 * reality the moment anything changed. Everything here is derived from the
 * deployment configuration and the live rule counts instead.
 */
export function RulesView({ entity }: { entity: EntityConfig }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['match-stats', entity.slug],
    queryFn: () => api.matchStats(entity.slug),
  });

  const narrative = entity.matchingNarrative;

  const chartItems: HBarItem[] =
    data?.rules.map((rule, index) => ({
      key: rule.rule_name,
      label: rule.rule_name,
      value: rule.count,
      color: TIER_COLORS[index % TIER_COLORS.length],
    })) ?? [];

  return (
    <div className="page-content">
      <PageHeader
        title={`${entity.labelSingular} Matching Rules`}
        subtitle="Three tiers: deterministic rules, then a classifier, then language model reasoning"
      />

      {error ? <ErrorMsg message={(error as Error).message} /> : null}

      {!isLoading && data && data.total_pairs === 0 ? (
        <Notice message="No pairs have been evaluated yet. The matching stages have not run for this entity." />
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
            <KpiCard label="Pairs Evaluated" value={formatNumber(data?.total_pairs)} />
            <KpiCard
              label="Auto-Merged"
              value={formatNumber(data?.routing.AUTO_MERGE)}
              variant="success"
            />
            <KpiCard
              label={`Manual ${terms.review}`}
              value={formatNumber(data?.routing.MANUAL_REVIEW)}
              variant="warning"
            />
            <KpiCard
              label="Auto-Rejected"
              value={formatNumber(data?.routing.AUTO_REJECT)}
            />
          </>
        )}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Pairs matched per rule</span>
        </div>
        <div className="fwa-card-body">
          {isLoading ? <TableSkeleton rows={5} /> : <HBarChart items={chartItems} />}
        </div>
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>Rule definitions</span>
        </div>
        {isLoading ? (
          <TableSkeleton rows={6} />
        ) : data && data.rules.length > 0 ? (
          <div className="table-scroll">
            <table className="fwa-table">
              <thead>
                <tr>
                  <th>Rule</th>
                  <th>What it does</th>
                  <th>Pairs</th>
                  <th style={{ width: 180 }}>Share of total</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((rule) => (
                  <tr key={rule.rule_name}>
                    <td className="data-id" style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {rule.rule_name}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>
                      {rule.description || 'No description configured for this rule.'}
                    </td>
                    <td>{formatNumber(rule.count)}</td>
                    <td>
                      <ScoreBar value={rule.pct} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState message="No rules have produced results yet." />
        )}
      </div>

      <div className="fwa-card dash-section">
        <div className="fwa-card-header">
          <span>How matching is configured</span>
        </div>
        <div className="fwa-card-body narrative">
          <h4>Tier 1 — Deterministic rules</h4>
          <p>
            Exact and guarded rules run first. Each rule excludes pairs already matched by a
            higher-confidence rule above it, and every compared field must be present on both
            records, so a shared absence never counts as agreement.
          </p>
          <ul>
            {narrative.deterministicRules.map((rule) => (
              <li key={rule.rule}>
                <code>{rule.rule}</code> — {rule.keys}
                {rule.confidence !== null ? ` (confidence ${rule.confidence.toFixed(2)})` : ''}
              </li>
            ))}
          </ul>
          <p>
            Name similarity uses a threshold of{' '}
            <code>{(narrative.thresholdIndividual * 100).toFixed(0)}%</code> for individuals and{' '}
            <code>{(narrative.thresholdOrganization * 100).toFixed(0)}%</code> for organizations,
            and requires at least <code>{narrative.minimumGuardFields}</code> guard{' '}
            {narrative.minimumGuardFields === 1 ? 'field' : 'fields'} to agree exactly alongside it.
            These come from the false-merge risk recorded during scoping.
          </p>

          <h4>Tier 2 — Classifier</h4>
          <p>
            Pairs whose names fall in the uncertain band go to a gradient-boosted classifier trained
            on the Tier 1 outcomes as ground truth. It scores on{' '}
            {narrative.mlFeatures.length} features:
          </p>
          <ul>
            {narrative.mlFeatures.map((feature) => (
              <li key={feature}>
                <code>{feature}</code>
              </li>
            ))}
          </ul>
          <p>
            High scores merge, low scores reject, and the band in between escalates to Tier 3 rather
            than being decided on a weak signal.
          </p>

          <h4>Tier 3 — Language model reasoning</h4>
          <p>
            Remaining uncertain pairs go to <code>{narrative.llmModel}</code> with both records
            presented field by field. Every decision is written to an audit log with its prompt,
            response, and parsed outcome, so a merge can always be explained after the fact.
          </p>
          <p>
            {narrative.llmRequired
              ? 'This tier is mandatory for this entity, because the domain context recorded that uncertain pairs need human-reviewable reasoning.'
              : 'This tier is optional for this entity. The earlier tiers may settle a pair without it.'}
          </p>

          <h4>{terms.goldenRecordPlural}</h4>
          <p>
            Every merge decision becomes an edge in a graph. Connected components are found by
            iterative minimum-label propagation, and one record per component survives, chosen on
            data quality, then field completeness, then recency.
          </p>
        </div>
      </div>
    </div>
  );
}
