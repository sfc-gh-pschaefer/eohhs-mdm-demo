# EOHHS Commonwealth Resident Index: demo script

Monday 10/19, 9:30 ET. About 20 minutes. Numbers below are from the live build on 10/16.

**Apps** (sign in with your Snowflake user)
- Hub: https://err5f6-sfsenorthamerica-demo-pschaefer-east1.snowflakecomputing.app
- MassHealth: https://irr5f6-sfsenorthamerica-demo-pschaefer-east1.snowflakecomputing.app
- Diagram: https://lucid.app/lucidchart/1e196fcb-7412-4f1d-9cdc-47db8ec003f2/edit

**Before you start:** run `CALL EOHHS_HUB.MASTER_GOLD.RESET_STEWARD_DEMO();` and `CALL MASSHEALTH.MASTER_GOLD.RESET_STEWARD_DEMO();`. Open both apps once so they are warm.

## 1. The architecture (diagram, 2 min)

- Each agency (MassHealth, DTA, BSAS, EHS) runs the same pipeline in its own database: RAW_BRONZE, INTEGRATION_SILVER, MASTER_GOLD, GOV, APP.
- Only MASTER_GOLD is passed up. The hub runs the same pipeline again across agencies.
- BSAS sends salted tokens only (42 CFR Part 2).
- The EOHHS ID flows back into every agency's `MASTER_GOLD.EOHHS_ID_MAP`.
- Every lane has zero false merges, scored against a ground-truth answer key.

## 2. Hub overview (3 min)

- 13,421 agency master records resolve to **8,162 residents**. Precision is **100%** and recall is 75.5%, with **0 false merges**.
- **Sankey:** shows how agency records resolve. Most residents are known to two or more agencies.
- **Identifier independence:** most links are made without a shared SSN. 757 links were made purely on BSAS tokens.
- **Tiers:** rules first, then ML, then Cortex AI. Point at the donut: AI auto-acts only when it is HIGH confidence *and* SQL confirms a shared identifier.
- **Alerts:** 676 residents have SNAP open and no MassHealth, and 597 are in treatment with no coverage. "No single agency can see these."

## 3. Maria Santos: Resident 360 (4 min)

Resident 360 > "Try Maria Santos" > **EOH-002575**.

- She is linked across MassHealth (MMIS 100000000001), DTA (BEACON SNAP case) and EHS (HST rides).
- **Alert:** "MassHealth mails 48 ESSEX ST; newer address on file: 215 MIDDLESEX ST, 01851 (DTA), 404 days newer."
- **Survivorship table:** the address comes from DTA; name and DOB come from MassHealth. A chip shows which agency supplied each value.
- **Why linked:** shows the rule behind each link.
- **Timeline:** shows every program, stitched by the cross-reference.
- Talking point: renewal notices currently go to the wrong address, and coverage is lost to procedural churn.

## 4. Steward: Kovalenko (4 min)

Steward Workbench > search **KOWALENKO**.

- **The pair:** MassHealth's Oleksandr Kovalenko (DOB 1975-08-23) and EHS refugee services' Aleksandr Kowalenko (DOB 1975-01-01, the defaulted refugee birth date). Both live at 484 Main St, Worcester.
- **Tiers:** ML sent the pair to review. Cortex AI says MATCH with MEDIUM confidence, and its reasoning is shown.
- **Action:** drag it to **Same resident**, add the note "Confirmed with ORI case worker", and confirm. The refresh takes seconds.
- **Show:** open the resulting EOHHS ID. There are two agencies, and the decision history shows your user.
- **Writeback:** in the MassHealth app, Member 360 for **MH-004183** now shows the EOHHS ID with "EHS, MASSHEALTH".
- Also point at the twins: the Nguyen twins (Daniel and Danielle, same DOB and address) are kept apart.

## 5. Agency Overlap and Sharing (3 min)

- **Agency Overlap:** an UpSet chart of exact agency combinations; 256 residents are served by all four agencies.
- **Sharing:** shows the exact columns each agency sends.
  - BSAS's export is only MASTER_ID, three TOKEN_ columns, IS_ACTIVE and LAST_UPDATED.
  - Write-back counts are shown per agency.
  - MassHealth, DTA and EHS never see BSAS in a resident's footprint. BSAS sees everything.

## 6. MassHealth app (3 min)

- Same codebase, one agency: 9,023 records resolve to **5,309 members**, with precision 100%, recall 98.2% and 0 false merges.
- **Alerts:** 142 members are enrolled more than once, **$1.1M a year** in duplicate capitation.
- **Steward example:** PAUL HAIDARI. The AI says MATCH (HIGH), but the guardrail held it because no identifier agrees exactly, so a person decides. This is the "AI assists, doesn't decide" moment.
- **Quality:** shows the gate results and the remediation log (placeholder SSNs and blank names nulled before matching). **Readiness:** shows per-column completeness and validity.

## Reset

- `CALL EOHHS_HUB.MASTER_GOLD.RESET_STEWARD_DEMO();`
- `CALL MASSHEALTH.MASTER_GOLD.RESET_STEWARD_DEMO();`

## Likely questions

- **Why not just SSN?** Many records have no SSN, or a placeholder one. Even an exact SSN match must be corroborated before a merge.
- **How do we know there are no false merges?** The synthetic data carries an answer key in `GOV.GROUND_TRUTH`, and the `GOV.MATCH_QUALITY_SCORECARD` view scores every run.
- **Part 2?** BSAS hashes identifiers in its own account with a shared salt (`GOV.TOKENIZE`). The hub matches on equality and never holds the values.
- **Rebuild?** `./run_pipeline.sh` rebuilds everything in about 5 minutes. `./deploy.sh hub|masshealth` redeploys an app.
