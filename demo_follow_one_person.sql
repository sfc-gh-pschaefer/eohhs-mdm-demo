/* =====================================================================
   EOHHS Resident Index: follow one resident, bronze to hub
   Resident: Ana Oliveira (formerly Ana Sullivan), DOB 1967-09-02, Haverhill
   Run top to bottom. Each step says what to point at.
   ===================================================================== */
USE ROLE SYSADMIN;
USE WAREHOUSE EOHHS_WH;

SET MH_ID  = 'MH-003477';    -- her MassHealth master
SET EOH_ID = 'EOH-001942';   -- her Commonwealth (EOHHS) ID


/* ---------------------------------------------------------------------
   ACT 1: MASSHEALTH
   --------------------------------------------------------------------- */

-- 1. BRONZE: three source systems, three formats, two last names.
--    Point at: MMIS splits name into fields, MA-21 is one "LAST, FIRST" string.
--    DOB is ISO in MMIS and MM/DD/YYYY in MA-21. SSN dashed vs not, and missing on one row.
--    Two MMIS member IDs: she was enrolled twice, once as Sullivan.
SELECT 'MMIS' AS source_system, MEMBER_ID AS record_id,
       FIRST_NAME || ' / ' || LAST_NAME AS name_as_received,
       DOB::STRING AS dob_as_received, SSN AS ssn_as_received,
       ADDR_LINE1 || ', ' || CITY || ' ' || ZIP AS address_as_received, PHONE
FROM MASSHEALTH.RAW_BRONZE.MMIS_MEMBER
WHERE MEMBER_ID IN ('558349830159', '024567040892')
UNION ALL
SELECT 'MA-21', CASE_NO, CLIENT_NAME, BIRTH_DT::STRING, SSN, RES_ADDRESS, NULL
FROM MASSHEALTH.RAW_BRONZE.MA21_CASE
WHERE CASE_NO = 'M788592271';


-- 2. SILVER: same three rows, now standardized. Still three rows.
--    Point at: one name format, one DOB format, SSN last 4, address normalized
--    (830 ESSEX STREET and 830 Essex St become 830 ESSEX ST). Clean is not the same as matched.
SELECT ROW_ID, _SOURCE_SYSTEM, SOURCE_RECORD_ID,
       FIRST_NAME_CLEAN, LAST_NAME_CLEAN, DOB_CLEAN, SSN_LAST4,
       ADDRESS_CLEAN, PHONE_CLEAN, QUALITY_SCORE
FROM MASSHEALTH.INTEGRATION_SILVER.PERSON_CLEAN
WHERE ROW_ID IN (SELECT ROW_ID FROM MASSHEALTH.MASTER_GOLD.XREF WHERE MASTER_ID = $MH_ID)
ORDER BY ROW_ID;


-- 3. MATCHING: why the engine linked them.
--    Point at: SSN agreement links MMIS to MA-21 (rule S0). The Sullivan record has no SSN,
--    so it links on phone + DOB + first name (rule S4). Rules, not guesses.
SELECT SOURCE_A, SOURCE_B, NAME_A, NAME_B, DOB_A, DOB_B,
       MATCH_TYPE, ROUND(HYBRID_SCORE, 2) AS score, ROUTING
FROM MASSHEALTH.INTEGRATION_SILVER.MATCH_RESULTS
WHERE ROW_A IN (SELECT ROW_ID FROM MASSHEALTH.MASTER_GOLD.XREF WHERE MASTER_ID = $MH_ID)
   OR ROW_B IN (SELECT ROW_ID FROM MASSHEALTH.MASTER_GOLD.XREF WHERE MASTER_ID = $MH_ID);


-- 4. GOLD: one person.
--    Point at: one golden record, 3 source records behind it, current name Oliveira.
SELECT MASTER_ID, DISPLAY_NAME, DOB_CLEAN, ADDRESS_CLEAN, PHONE_CLEAN,
       CLUSTER_SIZE, SOURCE_SYSTEMS, PROGRAMS, QUALITY_SCORE
FROM MASSHEALTH.MASTER_GOLD.GOLDEN_RECORDS
WHERE MASTER_ID = $MH_ID;

-- 4b. Lineage: every source record still traceable back to bronze.
SELECT _SOURCE_SYSTEM, SOURCE_RECORD_ID, FIRST_NAME_AS_GIVEN, LAST_NAME_CLEAN, PROGRAM, IS_ANCHOR
FROM MASSHEALTH.MASTER_GOLD.XREF
WHERE MASTER_ID = $MH_ID;

-- 4c. The business payoff: two MMIS IDs meant two capitation payments.
SELECT ALERT_TYPE, DETAIL, AMOUNT_AT_RISK
FROM MASSHEALTH.MASTER_GOLD.ALERTS
WHERE MASTER_ID = $MH_ID;

-- 4d. Program-wide: the same pattern across all of MassHealth.
SELECT COUNT(*) AS duplicate_enrollments, SUM(AMOUNT_AT_RISK) AS annual_amount_at_risk
FROM MASSHEALTH.MASTER_GOLD.ALERTS
WHERE ALERT_TYPE = 'DUPLICATE_ENROLLMENT';


/* >>> FLIP TO THE MASSHEALTH MEMBER INDEX APP
       Scorecard, then Person 360 for MH-003477, then Steward Workbench (Paul Haidari). */


/* ---------------------------------------------------------------------
   ACT 2: ROLL UP TO THE EOHHS HUB
   Each agency does steps 1 to 4 in its own database and passes MASTER_GOLD up.
   --------------------------------------------------------------------- */

-- 5. What each agency sends the hub. One row per agency master.
--    Point at: BSAS sends only salted tokens. No name, DOB or SSN leaves BSAS (42 CFR Part 2).
--    The BSAS token equals the DTA token for ANA SULLIVAN 1967-09-02, so the hub links them
--    without ever seeing BSAS identity data.
SELECT 'MASSHEALTH' AS agency, MASTER_ID, FIRST_NAME_CLEAN, LAST_NAME_CLEAN, DOB_CLEAN, LEFT(TOKEN_NAME_DOB_ZIP, 16) AS token
FROM EOHHS_HUB.RAW_BRONZE.MASSHEALTH_PERSON WHERE MASTER_ID = $MH_ID
UNION ALL
SELECT 'DTA', MASTER_ID, FIRST_NAME_CLEAN, LAST_NAME_CLEAN, DOB_CLEAN, LEFT(TOKEN_NAME_DOB_ZIP, 16)
FROM EOHHS_HUB.RAW_BRONZE.DTA_PERSON
WHERE MASTER_ID IN (SELECT SOURCE_RECORD_ID FROM EOHHS_HUB.MASTER_GOLD.XREF WHERE MASTER_ID = $EOH_ID)
UNION ALL
SELECT 'BSAS', MASTER_ID, NULL, NULL, NULL, LEFT(TOKEN_NAME_DOB_ZIP, 16)
FROM EOHHS_HUB.RAW_BRONZE.BSAS_PERSON
WHERE MASTER_ID IN (SELECT SOURCE_RECORD_ID FROM EOHHS_HUB.MASTER_GOLD.XREF WHERE MASTER_ID = $EOH_ID);


-- 6. Hub matching across agencies.
--    Point at: MassHealth knows her as Oliveira, DTA and EHS as Sullivan; phone + DOB links them.
--    DTA has a day/month DOB swap (02-09 vs 09-02): ML caught it at 0.82.
--    BSAS links on the token alone (rule S6) without exposing anything.
SELECT SOURCE_A, SOURCE_B, NAME_A, NAME_B, DOB_A, DOB_B,
       MATCH_TYPE, ROUND(HYBRID_SCORE, 2) AS score, ROUTING
FROM EOHHS_HUB.INTEGRATION_SILVER.MATCH_RESULTS
WHERE ROW_A IN (SELECT ROW_ID FROM EOHHS_HUB.MASTER_GOLD.XREF WHERE MASTER_ID = $EOH_ID)
   OR ROW_B IN (SELECT ROW_ID FROM EOHHS_HUB.MASTER_GOLD.XREF WHERE MASTER_ID = $EOH_ID)
ORDER BY MATCH_TYPE;


-- 7. One Commonwealth resident: one EOHHS ID, four agencies, five records.
SELECT MASTER_ID AS eohhs_id, DISPLAY_NAME, DOB_CLEAN, ADDRESS_CLEAN,
       SOURCE_SYSTEMS, CLUSTER_SIZE, PROGRAMS
FROM EOHHS_HUB.MASTER_GOLD.GOLDEN_RECORDS
WHERE MASTER_ID = $EOH_ID;

SELECT _SOURCE_SYSTEM AS agency, SOURCE_RECORD_ID, FIRST_NAME_AS_GIVEN, LAST_NAME_CLEAN, DOB_CLEAN, PROGRAM
FROM EOHHS_HUB.MASTER_GOLD.XREF
WHERE MASTER_ID = $EOH_ID
ORDER BY 1;


-- 8. The ID flows back down, and governance holds.
--    Point at: MassHealth now carries her EOHHS ID, but LINKED_AGENCIES omits BSAS.
--    The hub can link her treatment record; MassHealth never learns it exists.
SELECT MASTER_ID, EOHHS_ID, LINKED_AGENCIES, UPDATED_AT
FROM MASSHEALTH.MASTER_GOLD.EOHHS_ID_MAP
WHERE MASTER_ID = $MH_ID;


-- 9. Commonwealth view: how residents overlap across agencies.
SELECT COMBINATION, N_AGENCIES, RESIDENTS
FROM EOHHS_HUB.MASTER_GOLD.AGENCY_OVERLAP
ORDER BY RESIDENTS DESC;

-- 9b. What the linked view makes visible.
SELECT ALERT_TYPE, COUNT(*) AS residents
FROM EOHHS_HUB.MASTER_GOLD.ALERTS
GROUP BY 1 ORDER BY 2 DESC;


/* >>> FLIP TO THE COMMONWEALTH RESIDENT INDEX APP
       Overview, Overlap, Person 360 for EOH-001942, Sharing, Alerts,
       then approve Kovalenko in the Steward Workbench and show the ID flow back. */
