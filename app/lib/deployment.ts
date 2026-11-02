/**
 * Which app this build is. Rewritten by deploy.sh before each build:
 *   'hub'        EOHHS Commonwealth Resident Index (all agencies)
 *   'masshealth' MassHealth member index (one agency)
 */
export const DEPLOYMENT: 'hub' | 'masshealth' = 'hub';
export const IS_HUB = (DEPLOYMENT as string) === 'hub';
