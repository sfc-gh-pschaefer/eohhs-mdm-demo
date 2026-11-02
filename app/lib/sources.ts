/** Display names and colors for source systems, per deployment. */
import { IS_HUB } from './deployment';

const HUB = {
  labels: { MASSHEALTH: 'MassHealth', DTA: 'DTA (SNAP & cash)', BSAS: 'BSAS (tokens only)', EHS: 'EHS (ORI & HST)' },
  short: { MASSHEALTH: 'MassHealth', DTA: 'DTA', BSAS: 'BSAS', EHS: 'EHS' },
  colors: { MASSHEALTH: '#14558F', DTA: '#388557', BSAS: '#8A2BE2', EHS: '#D97706' },
};

const MASSHEALTH = {
  labels: { MMIS: 'MMIS: Enrolled members', HIX: 'HIX: Health Connector applications', MA21: 'MA-21: Non-MAGI & long-term care' },
  short: { MMIS: 'MMIS', HIX: 'HIX', MA21: 'MA-21' },
  colors: { MMIS: '#14558F', HIX: '#0E7490', MA21: '#7C3AED' },
};

const S = IS_HUB ? HUB : MASSHEALTH;
export const SOURCE_LABELS: Record<string, string> = S.labels;
export const SOURCE_SHORT: Record<string, string> = S.short;
export const SOURCE_COLORS: Record<string, string> = S.colors;

export function sourceLabel(code: unknown): string {
  const c = String(code ?? '');
  return SOURCE_LABELS[c] ?? c;
}
