/**
 * Display terminology, per deployment. Use these constants for any
 * user-visible noun. Do not hard-code framework vocabulary in components.
 */
import { IS_HUB } from './deployment';

export const terms = {
  goldenRecord: IS_HUB ? 'Resident Record' : 'Member Master Record',
  goldenRecordPlural: IS_HUB ? 'Resident Records' : 'Member Master Records',
  entity: IS_HUB ? 'Resident' : 'Member',
  entityPlural: IS_HUB ? 'Residents' : 'Members',
  masterId: IS_HUB ? 'EOHHS ID' : 'MassHealth Master ID',
  match: 'Match',
  matchPlural: 'Matches',
  cluster: IS_HUB ? 'Resident Cluster' : 'Member Cluster',
  clusterPlural: IS_HUB ? 'Resident Clusters' : 'Member Clusters',
  review: 'Review',
  reviewQueue: 'Steward Workbench',
} as const;

/** Capitalize the first letter, leaving the rest as authored. */
export function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
