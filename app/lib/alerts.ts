/** Display names and next actions for alert types produced by MASTER_GOLD.ALERTS. */
export const ALERT_LABEL: Record<string, string> = {
  ADDRESS_UPDATE_AVAILABLE: 'Newer address at another agency',
  SNAP_WITHOUT_MASSHEALTH: 'SNAP open, no MassHealth',
  TREATMENT_WITHOUT_COVERAGE: 'In treatment, no coverage',
  DUPLICATE_ENROLLMENT: 'Enrolled more than once',
  DUPLICATE_ACTIVE_CASE: 'Duplicate open SNAP case',
  FRAGMENTED_CARE: 'Care split across providers',
  DUPLICATE_RIDER: 'Duplicate HST rider',
};

export const ALERT_ACTION: Record<string, string> = {
  ADDRESS_UPDATE_AVAILABLE: 'Update the MassHealth mailing address before renewal notices go out.',
  SNAP_WITHOUT_MASSHEALTH: 'Express lane enrollment candidate: SNAP income already verified.',
  TREATMENT_WITHOUT_COVERAGE: 'Coverage outreach through BSAS only (42 CFR Part 2).',
  DUPLICATE_ENROLLMENT: 'Close the duplicate member ID and recover capitation.',
  DUPLICATE_ACTIVE_CASE: 'Close the duplicate case before the next issuance.',
  FRAGMENTED_CARE: 'Share a care plan across providers with client consent.',
  DUPLICATE_RIDER: 'Merge rider IDs so trip history is complete.',
};
