import type { ReactNode } from 'react';

/**
 * Presentational primitives. All of these are pure and render on the server.
 * Anything needing browser APIs lives in components/charts instead.
 */

// ─── KPI card ────────────────────────────────────────────────────────────────

export interface KpiCardProps {
  label: string;
  value: ReactNode;
  sub?: string;
  variant?: 'default' | 'critical' | 'warning' | 'success' | 'accent';
}

export function KpiCard({ label, value, sub, variant = 'default' }: KpiCardProps) {
  return (
    <div className={`kpi-card ${variant}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

// ─── Skeletons ───────────────────────────────────────────────────────────────

export function Skeleton({
  className = '',
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden />;
}

export function KpiSkeleton() {
  return (
    <div className="kpi-card default">
      <Skeleton style={{ height: 10, width: '55%', marginBottom: 10 }} />
      <Skeleton style={{ height: 24, width: '40%', marginBottom: 8 }} />
      <Skeleton style={{ height: 10, width: '65%' }} />
    </div>
  );
}

export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div style={{ padding: 14 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, padding: '9px 0' }}>
          <Skeleton style={{ height: 12, flex: 2 }} />
          <Skeleton style={{ height: 12, flex: 1 }} />
          <Skeleton style={{ height: 12, flex: 1 }} />
        </div>
      ))}
    </div>
  );
}

// ─── Spinner and error ───────────────────────────────────────────────────────

export function Spinner({ text = 'Loading…' }: { text?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        style={{ animation: 'spin 0.8s linear infinite' }}
        aria-hidden
      >
        <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      </svg>
      <span>{text}</span>
    </div>
  );
}

export function ErrorMsg({ message }: { message: string }) {
  return (
    <div className="alert-banner critical" role="alert">
      <strong>Error:</strong> {message}
    </div>
  );
}

/**
 * A neutral notice, for the common case where a pipeline stage has not run yet.
 * That is not an error and should not be styled as one.
 */
export function Notice({ message, tone = 'info' }: { message: string; tone?: 'info' | 'warning' }) {
  return (
    <div className={`alert-banner ${tone}`} role="status">
      {message}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}

// ─── Page header ─────────────────────────────────────────────────────────────

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="dash-section">
      <h1 className="page-title">{title}</h1>
      {subtitle ? <p className="page-subtitle">{subtitle}</p> : null}
    </div>
  );
}

// ─── Score bar ───────────────────────────────────────────────────────────────

/** Green above 90, amber above 70, red below. */
export function scoreColor(score: number): string {
  if (score >= 90) return '#15803D';
  if (score >= 70) return '#D97706';
  return '#DC2626';
}

export function ScoreBar({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="score-bar-wrap">
      <div className="score-bar">
        <div
          className="score-bar-fill"
          style={{ width: `${clamped}%`, background: scoreColor(clamped) }}
        />
      </div>
      <span className="score-value" style={{ color: scoreColor(clamped) }}>
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}

// ─── Confidence badge ────────────────────────────────────────────────────────

export function MatchConfidenceBadge({ confidence }: { confidence: number | null | undefined }) {
  if (confidence === null || confidence === undefined) {
    return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  }

  const pct = Math.round(confidence * 100);
  const { label, color } =
    pct >= 90
      ? { label: 'High', color: '#059669' }
      : pct >= 75
        ? { label: 'Medium', color: '#D97706' }
        : { label: 'Low', color: '#64748B' };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color }}>
      <span
        style={{ width: 7, height: 7, borderRadius: '50%', background: color }}
        aria-hidden
      />
      <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
        {pct}% {label}
      </span>
    </span>
  );
}

// ─── Value formatting ────────────────────────────────────────────────────────

const numberFormat = new Intl.NumberFormat('en-US');

export function formatNumber(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? numberFormat.format(n) : String(value);
}

/**
 * Format a cell according to its configured type.
 *
 * Dates arrive from the driver as either a Date or an ISO string depending on
 * the column type, so both are handled.
 */
export function formatValue(value: unknown, format?: string): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (format) {
    case 'number':
      return formatNumber(value);
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? `${n.toFixed(1)}%` : String(value);
    }
    case 'date': {
      const date = value instanceof Date ? value : new Date(String(value));
      return Number.isNaN(date.getTime())
        ? String(value)
        : date.toISOString().slice(0, 10);
    }
    case 'identifier':
    case 'text':
    default:
      return String(value);
  }
}
