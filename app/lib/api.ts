/**
 * Client-side API access.
 *
 * Route handlers live in the same origin as the app, so a relative fetch works
 * without axios and without a configured base URL. Dropping axios also removes
 * the previous relative-baseURL problem, where the same client module could not
 * be used from server code.
 */

import type {
  MatchStats,
  PagedResult,
  GoldenRecordRow,
  MatchPairRow,
  QualityResult,
  ReadinessResult,
  StewardDecisionRequest,
  StewardDecisionResult,
  SummaryData,
} from './types';

async function get<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const url = new URL(path, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== '' && value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const response = await fetch(url.toString(), {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  });

  if (!response.ok) {
    // Route handlers return a JSON body with an error message even on failure.
    // Prefer that over the bare status, since it names the actual cause.
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body; keep the status message.
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let detail = `Request failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) detail = body.error;
    } catch {
      // Non-JSON error body; keep the status message.
    }
    throw new Error(detail);
  }

  return (await response.json()) as T;
}

export const api = {
  summary: () => get<SummaryData>('/api/summary'),

  matchStats: (entity: string) => get<MatchStats>(`/api/${entity}/match-stats`),

  goldenRecords: (
    entity: string,
    params: { limit?: number; offset?: number; min_cluster_size?: number; search?: string },
  ) => get<PagedResult<GoldenRecordRow>>(`/api/${entity}/golden-records`, params),

  matchPairs: (
    entity: string,
    params: {
      limit?: number;
      offset?: number;
      match_type?: string;
      min_score?: number;
      max_score?: number;
      search?: string;
    },
  ) => get<PagedResult<MatchPairRow>>(`/api/${entity}/match-pairs`, params),

  reviewQueue: (entity: string, params: { limit?: number; offset?: number; search?: string }) =>
    get<PagedResult<MatchPairRow>>(`/api/${entity}/review-queue`, params),

  decideReviewPair: (entity: string, body: StewardDecisionRequest) =>
    post<StewardDecisionResult>(`/api/${entity}/review-queue/decide`, body),

  readiness: (entity: string) => get<ReadinessResult>(`/api/${entity}/readiness`),

  quality: (entity: string) => get<QualityResult>(`/api/${entity}/dmf-results`),
};

// ─── EOHHS surfaces ──────────────────────────────────────────────────────────

import type { OverlapRow, OverviewData, Person360, SharingData, WorkbenchPair } from './eohhs-queries';

export type Person360Result = Person360 & { eohhs: Record<string, unknown> | null };

export const eohhsApi = {
  overview: () => get<OverviewData>('/api/overview'),
  workbench: (params: { limit?: number; offset?: number; search?: string; suggestion?: string }) =>
    get<{ items: WorkbenchPair[]; total: number; error?: string }>('/api/workbench', params),
  decide: (body: { row_a: number; row_b: number; decision: 'APPROVE' | 'REJECT'; notes: string }) =>
    post<{ decided: boolean; master_id: string | null; refresh: string }>('/api/workbench/decide', body),
  person: (id: string) => get<Person360Result>(`/api/person/${encodeURIComponent(id)}`),
  overlap: () => get<{ rows: OverlapRow[]; totals: Record<string, number> }>('/api/overlap'),
  sharing: () => get<SharingData>('/api/sharing'),
  alerts: (params: { type?: string; limit?: number }) =>
    get<{ summary: { alert_type: string; n: number; amount: number }[]; items: Record<string, unknown>[] }>('/api/alerts', params),
};
