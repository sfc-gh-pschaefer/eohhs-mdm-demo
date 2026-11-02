'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

/** ECharts passes a wide union for label values; narrow it safely. */
function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatCount(value: unknown): string {
  return asNumber(value).toLocaleString('en-US');
}

/**
 * ECharts wrapper.
 *
 * echarts.init and ResizeObserver are browser-only, so this whole module is a
 * client component. Consumers import it directly; Next.js keeps it out of the
 * server bundle because of the "use client" boundary.
 */
function useEChart(option: EChartsOption, deps: unknown[]) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    chart.setOption(option);

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
}

const AXIS_LABEL = {
  color: '#64748B',
  fontSize: 11,
  fontFamily: 'var(--font-inter), ui-sans-serif, system-ui, sans-serif',
};

const TOOLTIP = {
  backgroundColor: '#0F172A',
  borderWidth: 0,
  textStyle: { color: '#fff', fontSize: 12 },
};

// ─── Horizontal bar chart ────────────────────────────────────────────────────

export interface HBarItem {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function HBarChart({ items, height }: { items: HBarItem[]; height?: number }) {
  const resolvedHeight = height ?? Math.max(items.length * 42 + 24, 80);

  // ECharts renders the first category at the bottom of a horizontal bar chart,
  // so reverse to make the configured order read top-down.
  const ordered = [...items].reverse();

  const option: EChartsOption = {
    grid: { left: 8, right: 64, top: 8, bottom: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP },
    xAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#F1F5F9' } },
      axisLabel: AXIS_LABEL,
    },
    yAxis: {
      type: 'category',
      data: ordered.map((i) => i.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { ...AXIS_LABEL, width: 140, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        barWidth: 28,
        showBackground: true,
        backgroundStyle: { color: '#F1F5F9', borderRadius: 4 },
        itemStyle: {
          borderRadius: [0, 4, 4, 0],
          color: (params) => ordered[params.dataIndex]?.color ?? '#2563EB',
        },
        label: {
          show: true,
          position: 'right',
          formatter: (params) => formatCount(params.value),
          color: '#0F172A',
          fontSize: 11,
          fontWeight: 600,
        },
        data: ordered.map((i) => i.value),
      },
    ],
  };

  const ref = useEChart(option, [JSON.stringify(items), resolvedHeight]);

  if (items.length === 0) {
    return <div className="empty-state">No data to chart yet.</div>;
  }

  return <div ref={ref} style={{ width: '100%', height: resolvedHeight }} />;
}

// ─── Compact horizontal bars ─────────────────────────────────────────────────

export interface MiniBarRow {
  label: string;
  value: number;
  color?: string;
  display?: string;
}

export function MiniHBars({
  rows,
  height,
  max,
  baseColor = '#2563EB',
  labelWidth = 120,
  ariaLabel = 'Bar chart',
}: {
  rows: MiniBarRow[];
  height?: number;
  max?: number;
  baseColor?: string;
  labelWidth?: number;
  ariaLabel?: string;
}) {
  const ordered = [...rows].reverse();
  const resolvedHeight = height ?? Math.max(rows.length * 26 + 16, 60);

  const option: EChartsOption = {
    grid: { left: 4, right: 48, top: 4, bottom: 4, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, ...TOOLTIP },
    xAxis: {
      type: 'value',
      max,
      show: false,
    },
    yAxis: {
      type: 'category',
      data: ordered.map((r) => r.label),
      axisTick: { show: false },
      axisLine: { show: false },
      axisLabel: { ...AXIS_LABEL, width: labelWidth, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        barWidth: 12,
        showBackground: true,
        backgroundStyle: { color: '#F1F5F9', borderRadius: 6 },
        itemStyle: {
          borderRadius: 6,
          color: (params) => ordered[params.dataIndex]?.color ?? baseColor,
        },
        label: {
          show: true,
          position: 'right',
          formatter: (params) =>
            ordered[params.dataIndex]?.display ?? formatCount(params.value),
          color: '#64748B',
          fontSize: 11,
          fontWeight: 600,
        },
        data: ordered.map((r) => r.value),
      },
    ],
  };

  const ref = useEChart(option, [JSON.stringify(rows), resolvedHeight, max]);

  if (rows.length === 0) return null;

  return (
    <div ref={ref} style={{ width: '100%', height: resolvedHeight }} aria-label={ariaLabel} />
  );
}

// ─── Sankey (source systems -> master records) ───────────────────────────────

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export function SankeyChart({
  nodes,
  links,
  height = 320,
}: {
  nodes: { name: string; color: string }[];
  links: SankeyLink[];
  height?: number;
}) {
  const option: EChartsOption = {
    tooltip: {
      trigger: 'item',
      ...TOOLTIP,
      formatter: (p) => {
        const d = (p as { data?: { source?: string; target?: string; value?: number; name?: string } }).data;
        if (d?.source) return `${d.source} → ${d.target}<br/><b>${formatCount(d.value)}</b> records`;
        return `${d?.name ?? ''}`;
      },
    },
    series: [
      {
        type: 'sankey',
        left: 8,
        right: 150,
        top: 12,
        bottom: 12,
        nodeWidth: 14,
        nodeGap: 14,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        lineStyle: { color: 'gradient', curveness: 0.5, opacity: 0.35 },
        label: { color: '#0F172A', fontSize: 12, fontWeight: 600 },
        data: nodes.map((n) => ({ name: n.name, itemStyle: { color: n.color, borderWidth: 0 } })),
        links,
      },
    ],
  };

  const ref = useEChart(option, [JSON.stringify(nodes), JSON.stringify(links), height]);
  if (links.length === 0) return <div className="empty-state">No data to chart yet.</div>;
  return <div ref={ref} style={{ width: '100%', height }} />;
}

// ─── Donut ───────────────────────────────────────────────────────────────────

export function DonutChart({
  items,
  height = 220,
  centerLabel,
}: {
  items: { label: string; value: number; color: string }[];
  height?: number;
  centerLabel?: string;
}) {
  const option: EChartsOption = {
    tooltip: { trigger: 'item', ...TOOLTIP },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      icon: 'circle',
      itemWidth: 8,
      textStyle: { color: '#475569', fontSize: 11.5 },
    },
    title: centerLabel
      ? {
          text: centerLabel,
          left: '29%',
          top: 'center',
          textAlign: 'center',
          textStyle: { fontSize: 18, fontWeight: 700, color: '#0F172A' },
        }
      : undefined,
    series: [
      {
        type: 'pie',
        radius: ['58%', '82%'],
        center: ['30%', '50%'],
        avoidLabelOverlap: true,
        label: { show: false },
        itemStyle: { borderColor: '#fff', borderWidth: 2 },
        data: items.map((i) => ({ name: i.label, value: i.value, itemStyle: { color: i.color } })),
      },
    ],
  };
  const ref = useEChart(option, [JSON.stringify(items), height, centerLabel]);
  if (items.length === 0) return <div className="empty-state">No data yet.</div>;
  return <div ref={ref} style={{ width: '100%', height }} />;
}
