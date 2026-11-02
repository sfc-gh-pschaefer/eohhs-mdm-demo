"""Render sql/template.sql into one build script per database.

    python3 render.py   ->  sql/build/MASSHEALTH.sql, DTA.sql, BSAS.sql, EHS.sql, EOHHS_HUB.sql

Each agency differs only in its source mappings, gate checks, trust ranks and
alerts. The hub runs the same pipeline over the agencies' MASTER_GOLD exports.
"""
import csv
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
COLS = ["_SOURCE_SYSTEM", "SOURCE_RECORD_ID", "AGENCY_ID", "SSN", "SSN_LAST4", "FIRST_NAME", "LAST_NAME", "MIDDLE_NAME",
        "DOB_CLEAN", "GENDER_CLEAN", "EMAIL_CLEAN", "PHONE_CLEAN", "ADDRESS_STREET", "ADDRESS_CITY", "ADDRESS_ZIP",
        "PROGRAM", "PROGRAM_STATUS", "_LOAD_TS"]
DIGITS = "NULLIF(REGEXP_REPLACE({}, '[^0-9]', ''), '')"
SSN9 = "NULLIF(REPLACE({}, '-', ''), '')"


def stacked(sources, extra_cols=()):
    parts = []
    for table, m in sources:
        cols = COLS + list(extra_cols)
        sel = ",\n         ".join(f"{m.get(c, 'NULL')} AS {c}" if c not in ("_SOURCE_SYSTEM",) else f"'{m[c]}' AS {c}" for c in cols)
        parts.append(f"  SELECT {sel}\n  FROM {table}")
    return "\n  UNION ALL\n".join(parts)


def load_sql(db, tables):
    out = [f"CREATE STAGE IF NOT EXISTS {db}.RAW_BRONZE.LANDING;",
           f"CREATE OR REPLACE FILE FORMAT {db}.RAW_BRONZE.CSV_RAW TYPE = CSV FIELD_OPTIONALLY_ENCLOSED_BY = '\"' "
           f"SKIP_HEADER = 1 NULL_IF = ('') EMPTY_FIELD_AS_NULL = TRUE TRIM_SPACE = FALSE;"]
    for schema, t, comment in tables:
        f = os.path.join(DATA, f"{db}__{schema}__{t}.csv")
        with open(f) as fh:
            header = next(csv.reader(fh))
        cols = ", ".join(f"{c} VARCHAR" for c in header)
        out += [f"CREATE OR REPLACE TABLE {db}.{schema}.{t} ({cols}) COMMENT = '{comment}';",
                f"PUT file://{f} @{db}.RAW_BRONZE.LANDING/{t}/ AUTO_COMPRESS=TRUE OVERWRITE=TRUE;",
                f"COPY INTO {db}.{schema}.{t} FROM @{db}.RAW_BRONZE.LANDING/{t}/ FILE_FORMAT = (FORMAT_NAME = {db}.RAW_BRONZE.CSV_RAW) PURGE = TRUE;"]
    return "\n".join(out)


def gate_sql(db, checks):
    """checks: [(table, [(metric_fn, column, expectation_or_None, severity)])]"""
    out = []
    for table, ms in checks:
        fq = f"{db}.RAW_BRONZE.{table}"
        fns = ",\n    ".join(f"{fn}(SELECT {col} FROM {fq}) AS m{i}" for i, (fn, col, _, _) in enumerate(ms))
        rows = "\n  UNION ALL\n".join(
            f"  SELECT '{fn.split('.')[-1]}' metric, '{col}' col, m{i} val, rc, {('NULL' if e is None else repr(e))} expectation, '{sev}' severity FROM m"
            for i, (fn, col, e, sev) in enumerate(ms))
        out.append(f"""INSERT INTO {db}.GOV.DQ_GATE_RESULTS
WITH m AS (SELECT (SELECT COUNT(*) FROM {fq}) AS rc,
    {fns}),
f AS (
{rows})
SELECT $GATE_RUN, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ, '{db}', '{fq}', metric, col, val, rc,
       ROUND(100.0 * val / NULLIF(rc, 0), 2), expectation, severity,
       CASE WHEN expectation IS NULL THEN TRUE ELSE val = 0 END
FROM f;""")
        out.append(f"ALTER TABLE {fq} SET DATA_METRIC_SCHEDULE = 'TRIGGER_ON_CHANGES';")
        for fn, col, e, sev in ms:
            out.append(f"ALTER TABLE {fq} ADD DATA METRIC FUNCTION {fn} ON ({col});")
        out.append(f"ALTER TABLE {fq} ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.ROW_COUNT ON ();")
    return "\n".join(out)


def remediation_sql(db, items):
    """items: [(table, column, kind)] kind in {'blank', 'ssn'}"""
    out = []
    for t, col, kind in items:
        fq = f"{db}.RAW_BRONZE.{t}"
        if kind == "blank":
            out.append(f"""INSERT INTO {db}.GOV.DQ_REMEDIATION_LOG
SELECT $REMED_RUN, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ, '{fq}', '{col}', 'SNOWFLAKE.CORE.BLANK_COUNT', 'set_null', COUNT(*),
       'Blank names score as identical under Jaro-Winkler and would merge unrelated residents.'
FROM {fq} WHERE {col} IS NOT NULL AND TRIM({col}) = '';
UPDATE {fq} SET {col} = NULL WHERE {col} IS NOT NULL AND TRIM({col}) = '';""")
        else:
            pred = f"{col} IS NOT NULL AND (NOT REPLACE({col}, '-', '') REGEXP '^[0-9]{{9}}$' OR REPLACE({col}, '-', '') IN ('000000000','999999999','123456789'))"
            out.append(f"""INSERT INTO {db}.GOV.DQ_REMEDIATION_LOG
SELECT $REMED_RUN, CURRENT_TIMESTAMP()::TIMESTAMP_NTZ, '{fq}', '{col}', '{db}.GOV.INVALID_SSN_COUNT', 'set_null', COUNT(*),
       'Placeholder SSNs collide with each other and would produce false exact matches.'
FROM {fq} WHERE {pred};
UPDATE {fq} SET {col} = NULL WHERE {pred};""")
    return "\n".join(out)


def rank(order):
    return "CASE _SOURCE_SYSTEM " + " ".join(f"WHEN '{s}' THEN {i + 1}" for i, s in enumerate(order)) + f" ELSE {len(order) + 1} END"


AGENCY_TOKENS = ("{db}.GOV.TOKENIZE(SSN) AS TOKEN_SSN, "
                 "{db}.GOV.TOKENIZE(FIRST_NAME_CLEAN || '|' || LAST_NAME_CLEAN || '|' || DOB_CLEAN) AS TOKEN_NAME_DOB, "
                 "{db}.GOV.TOKENIZE(FIRST_NAME_CLEAN || '|' || LAST_NAME_CLEAN || '|' || DOB_CLEAN || '|' || ADDRESS_ZIP) AS TOKEN_NAME_DOB_ZIP")
CLEAN_DMFS = """ALTER TABLE PERSON_CLEAN SET DATA_METRIC_SCHEDULE = 'TRIGGER_ON_CHANGES';
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION {db}.GOV.INVALID_SSN_COUNT ON (SSN) EXPECTATION ssn_valid_after_cleansing (VALUE = 0);
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION {db}.GOV.INVALID_EMAIL_COUNT ON (EMAIL_CLEAN) EXPECTATION email_valid (VALUE = 0);
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION {db}.GOV.INVALID_MA_ZIP_COUNT ON (ADDRESS_ZIP) EXPECTATION zip_in_ma (VALUE = 0);
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (DOB_CLEAN);
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (LAST_NAME_CLEAN);
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.DUPLICATE_COUNT ON (SSN);
ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.ROW_COUNT ON ();"""
ACTIVE = "BOOLOR_AGG(PROGRAM_STATUS IN ('ENROLLED', 'ACTIVE', 'OPEN', 'IN_TREATMENT'))"


def dup_alert(db, system, alert, amount, detail, status_filter="TRUE"):
    return f"""SELECT x.MASTER_ID, '{alert}' AS ALERT_TYPE, {amount} AS AMOUNT_AT_RISK,
         COUNT(DISTINCT x.SOURCE_RECORD_ID) || ' {detail}' AS DETAIL,
         ANY_VALUE(g.SOURCE_COUNT) AS SYSTEMS
  FROM {db}.MASTER_GOLD.XREF x JOIN {db}.MASTER_GOLD.GOLDEN_RECORDS g ON g.MASTER_ID = x.MASTER_ID
  WHERE x._SOURCE_SYSTEM = '{system}' AND {status_filter}
  GROUP BY x.MASTER_ID HAVING COUNT(DISTINCT x.SOURCE_RECORD_ID) > 1"""


def hub_export(db, part2=False):
    if part2:
        return f"""-- BSAS shares tokens only. No name, DOB, address or program detail leaves BSAS.
CREATE OR REPLACE VIEW {db}.MASTER_GOLD.HUB_EXPORT AS
SELECT MASTER_ID, TOKEN_SSN, TOKEN_NAME_DOB, TOKEN_NAME_DOB_ZIP, IS_ACTIVE, LAST_UPDATED
FROM {db}.MASTER_GOLD.GOLDEN_RECORDS;"""
    return f"""CREATE OR REPLACE VIEW {db}.MASTER_GOLD.HUB_EXPORT AS
SELECT MASTER_ID, FIRST_NAME_CLEAN, LAST_NAME_CLEAN, MIDDLE_NAME, DOB_CLEAN, GENDER_CLEAN, EMAIL_CLEAN, PHONE_CLEAN,
       ADDRESS_STREET_CLEAN, ADDRESS_CITY, ADDRESS_ZIP, SSN_LAST4, TOKEN_SSN, TOKEN_NAME_DOB, TOKEN_NAME_DOB_ZIP,
       PROGRAMS, IS_ACTIVE, ADDRESS_AS_OF, LAST_UPDATED
FROM {db}.MASTER_GOLD.GOLDEN_RECORDS;"""


def eohhs_map(db):
    return f"""CREATE TABLE IF NOT EXISTS {db}.MASTER_GOLD.EOHHS_ID_MAP (
  MASTER_ID VARCHAR, EOHHS_ID VARCHAR, LINKED_AGENCIES VARCHAR, UPDATED_AT TIMESTAMP_NTZ)
  COMMENT = 'Written back by EOHHS_HUB: the Commonwealth Resident ID for each agency master record.';"""


AGENCIES = {
    "MASSHEALTH": dict(
        label="MassHealth", entity="members", prefix="MH", agency_id_label="member ID",
        persona="You are a data steward at MassHealth, the Massachusetts Medicaid program.",
        survivorship="IDs and DOB from MMIS first (system of record), then MA-21, then HIX; name from MMIS; contact from HIX; address most recent.",
        tables=[("RAW_BRONZE", "MMIS_MEMBER", "MMIS: enrolled members, system of record for eligibility"),
                ("RAW_BRONZE", "HIX_APPLICATION", "HIX: MAGI applications from the Health Connector"),
                ("RAW_BRONZE", "MA21_CASE", "MA-21: non-MAGI and long-term care cases")],
        sources=[
            ("MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", dict(_SOURCE_SYSTEM="MMIS", SOURCE_RECORD_ID="MEMBER_ID", AGENCY_ID="MEMBER_ID",
              SSN=SSN9.format("SSN"), SSN_LAST4="RIGHT(" + SSN9.format("SSN") + ", 4)", FIRST_NAME="FIRST_NAME", LAST_NAME="LAST_NAME",
              MIDDLE_NAME="NULLIF(MIDDLE_INIT, '')", DOB_CLEAN="TRY_TO_DATE(DOB, 'YYYY-MM-DD')", GENDER_CLEAN="SEX",
              PHONE_CLEAN=DIGITS.format("PHONE"), ADDRESS_STREET="ADDR_LINE1", ADDRESS_CITY="CITY", ADDRESS_ZIP="LEFT(ZIP, 5)",
              PROGRAM="'MassHealth ' || ELIG_CATEGORY", PROGRAM_STATUS="'ENROLLED'", _LOAD_TS="TRY_TO_TIMESTAMP(RECORD_TS)")),
            ("MASSHEALTH.RAW_BRONZE.HIX_APPLICATION", dict(_SOURCE_SYSTEM="HIX", SOURCE_RECORD_ID="APPLICATION_ID",
              SSN=SSN9.format("SSN"), SSN_LAST4="RIGHT(" + SSN9.format("SSN") + ", 4)", FIRST_NAME="APPLICANT_FIRST", LAST_NAME="APPLICANT_LAST",
              DOB_CLEAN="TRY_TO_DATE(DATE_OF_BIRTH, 'YYYY-MM-DD')", EMAIL_CLEAN="LOWER(EMAIL)", PHONE_CLEAN=DIGITS.format("PHONE"),
              ADDRESS_STREET="HOME_STREET", ADDRESS_CITY="HOME_CITY", ADDRESS_ZIP="LEFT(HOME_ZIP, 5)",
              PROGRAM="'HIX application'", PROGRAM_STATUS="'SUBMITTED'", _LOAD_TS="TRY_TO_TIMESTAMP(SUBMITTED_AT)")),
            ("MASSHEALTH.RAW_BRONZE.MA21_CASE", dict(_SOURCE_SYSTEM="MA21", SOURCE_RECORD_ID="CASE_NO", AGENCY_ID="NULL",
              SSN=SSN9.format("SSN"), SSN_LAST4="RIGHT(" + SSN9.format("SSN") + ", 4)",
              FIRST_NAME="SPLIT_PART(CLIENT_NAME, ', ', 2)", LAST_NAME="SPLIT_PART(CLIENT_NAME, ', ', 1)",
              DOB_CLEAN="TRY_TO_DATE(BIRTH_DT, 'MM/DD/YYYY')", GENDER_CLEAN="GENDER",
              ADDRESS_STREET="SPLIT_PART(RES_ADDRESS, ', ', 1)", ADDRESS_CITY="REGEXP_SUBSTR(RES_ADDRESS, ', (.*) MA [0-9]{5}$', 1, 1, 'e', 1)",
              ADDRESS_ZIP="RIGHT(RES_ADDRESS, 5)", PROGRAM="'MA-21 non-MAGI' || IFF(LTC_FLAG = 'Y', ' (LTC)', '')",
              PROGRAM_STATUS="'ACTIVE'", _LOAD_TS="TRY_TO_TIMESTAMP(LAST_UPDATED)"))],
        gate=[("MMIS_MEMBER", [("SNOWFLAKE.CORE.NULL_COUNT", "SSN", None, "info"), ("MASSHEALTH.GOV.INVALID_SSN_COUNT", "SSN", "VALUE = 0", "warn"),
                               ("SNOWFLAKE.CORE.DUPLICATE_COUNT", "SSN", None, "info"), ("SNOWFLAKE.CORE.BLANK_COUNT", "FIRST_NAME", "VALUE = 0", "warn"),
                               ("MASSHEALTH.GOV.INVALID_DOB_COUNT", "DOB", "VALUE = 0", "warn"), ("MASSHEALTH.GOV.INVALID_MA_ZIP_COUNT", "ZIP", "VALUE = 0", "warn")]),
              ("HIX_APPLICATION", [("SNOWFLAKE.CORE.NULL_COUNT", "SSN", None, "info"), ("MASSHEALTH.GOV.INVALID_SSN_COUNT", "SSN", "VALUE = 0", "warn"),
                                   ("MASSHEALTH.GOV.INVALID_EMAIL_COUNT", "EMAIL", "VALUE = 0", "warn"), ("SNOWFLAKE.CORE.NULL_COUNT", "DATE_OF_BIRTH", "VALUE = 0", "warn")]),
              ("MA21_CASE", [("MASSHEALTH.GOV.INVALID_SSN_COUNT", "SSN", "VALUE = 0", "warn"), ("MASSHEALTH.GOV.INVALID_DOB_COUNT", "BIRTH_DT", "VALUE = 0", "warn")])],
        remediation=[("MMIS_MEMBER", "FIRST_NAME", "blank"), ("MMIS_MEMBER", "SSN", "ssn"), ("HIX_APPLICATION", "SSN", "ssn"), ("MA21_CASE", "SSN", "ssn")],
        id_rank=["MMIS", "MA21", "HIX"], name_rank=["MMIS", "MA21", "HIX"], contact_rank=["HIX", "MMIS", "MA21"],
        alerts=lambda db: dup_alert(db, "MMIS", "DUPLICATE_ENROLLMENT", "(COUNT(DISTINCT x.SOURCE_RECORD_ID) - 1) * 7800",
                                    "MMIS member IDs for one person (capitation paid on each)"),
    ),
    "DTA": dict(
        label="DTA", entity="clients", prefix="DTA", agency_id_label="client ID",
        persona="You are a data steward at the Massachusetts Department of Transitional Assistance (SNAP and cash assistance).",
        survivorship="IDs, DOB and name from BEACON (system of record); contact from DTA Connect; address most recent.",
        tables=[("RAW_BRONZE", "BEACON_CLIENT", "BEACON: SNAP, TAFDC and EAEDC cases"),
                ("RAW_BRONZE", "DTA_CONNECT_ACCOUNT", "DTA Connect: self-service portal accounts")],
        sources=[
            ("DTA.RAW_BRONZE.BEACON_CLIENT", dict(_SOURCE_SYSTEM="BEACON", SOURCE_RECORD_ID="CLIENT_ID", AGENCY_ID="CLIENT_ID",
              SSN=SSN9.format("SSN"), SSN_LAST4="RIGHT(" + SSN9.format("SSN") + ", 4)", FIRST_NAME="FIRST_NM", LAST_NAME="LAST_NM",
              DOB_CLEAN="TRY_TO_DATE(BIRTH_DATE, 'YYYYMMDD')", GENDER_CLEAN="SEX_CD", ADDRESS_STREET="STREET_ADDR",
              ADDRESS_CITY="CITY_NM", ADDRESS_ZIP="LEFT(ZIP_CD, 5)", PROGRAM="PROGRAM_CD", PROGRAM_STATUS="CASE_STATUS",
              _LOAD_TS="TRY_TO_TIMESTAMP(CERT_DATE)")),
            ("DTA.RAW_BRONZE.DTA_CONNECT_ACCOUNT", dict(_SOURCE_SYSTEM="DTA_CONNECT", SOURCE_RECORD_ID="PORTAL_USER_ID",
              FIRST_NAME="FIRST_NAME", LAST_NAME="LAST_NAME", DOB_CLEAN="TRY_TO_DATE(DOB, 'MM/DD/YYYY')", EMAIL_CLEAN="LOWER(EMAIL)",
              PHONE_CLEAN=DIGITS.format("MOBILE"), ADDRESS_STREET="SPLIT_PART(MAILING_ADDRESS, ', ', 1)",
              ADDRESS_CITY="SPLIT_PART(MAILING_ADDRESS, ', ', 2)", ADDRESS_ZIP="RIGHT(MAILING_ADDRESS, 5)",
              PROGRAM="'DTA Connect portal'", PROGRAM_STATUS="'ACTIVE'", _LOAD_TS="TRY_TO_TIMESTAMP(LAST_LOGIN)"))],
        gate=[("BEACON_CLIENT", [("SNOWFLAKE.CORE.NULL_COUNT", "SSN", None, "info"), ("DTA.GOV.INVALID_SSN_COUNT", "SSN", "VALUE = 0", "warn"),
                                 ("SNOWFLAKE.CORE.DUPLICATE_COUNT", "SSN", None, "info"), ("SNOWFLAKE.CORE.BLANK_COUNT", "LAST_NM", "VALUE = 0", "warn"),
                                 ("DTA.GOV.INVALID_DOB_COUNT", "BIRTH_DATE", "VALUE = 0", "warn"), ("DTA.GOV.INVALID_MA_ZIP_COUNT", "ZIP_CD", "VALUE = 0", "warn")]),
              ("DTA_CONNECT_ACCOUNT", [("DTA.GOV.INVALID_EMAIL_COUNT", "EMAIL", "VALUE = 0", "warn"), ("SNOWFLAKE.CORE.NULL_COUNT", "EMAIL", None, "info")])],
        remediation=[("BEACON_CLIENT", "LAST_NM", "blank"), ("BEACON_CLIENT", "SSN", "ssn")],
        id_rank=["BEACON", "DTA_CONNECT"], name_rank=["BEACON", "DTA_CONNECT"], contact_rank=["DTA_CONNECT", "BEACON"],
        alerts=lambda db: dup_alert(db, "BEACON", "DUPLICATE_ACTIVE_CASE", "(COUNT(DISTINCT x.SOURCE_RECORD_ID) - 1) * 3492",
                                    "open BEACON cases for one person (benefits issued on each)", "x.PROGRAM_STATUS = 'OPEN'"),
    ),
    "BSAS": dict(
        label="BSAS", entity="clients", prefix="BSAS", agency_id_label="provider client ID",
        persona="You are a data steward at the DPH Bureau of Substance Addiction Services.",
        survivorship="IDs, DOB and name from ESM admissions first, then the OTP registry; address most recent.",
        part2=True,
        tables=[("RAW_BRONZE", "ESM_ADMISSION", "ESM: treatment admissions reported by licensed providers (42 CFR Part 2)"),
                ("RAW_BRONZE", "OTP_REGISTRY", "OTP central registry: opioid treatment program enrollment (42 CFR Part 2)")],
        sources=[
            ("BSAS.RAW_BRONZE.ESM_ADMISSION", dict(_SOURCE_SYSTEM="ESM_ADMISSION", SOURCE_RECORD_ID="EPISODE_ID", AGENCY_ID="PROVIDER_CLIENT_ID",
              SSN=SSN9.format("SSN"), SSN_LAST4="COALESCE(RIGHT(" + SSN9.format("SSN") + ", 4), SSN_LAST4)", FIRST_NAME="FIRST_NAME",
              LAST_NAME="LAST_NAME", DOB_CLEAN="TRY_TO_DATE(DOB, 'YYYY-MM-DD')", GENDER_CLEAN="SEX", ADDRESS_STREET="STREET",
              ADDRESS_CITY="CITY", ADDRESS_ZIP="LEFT(ZIP, 5)", PROGRAM="SERVICE_TYPE || ' admission'",
              PROGRAM_STATUS="IFF(TRY_TO_DATE(ADMIT_DATE) >= DATEADD(day, -365, '2026-10-01'::DATE), 'IN_TREATMENT', 'DISCHARGED')",
              _LOAD_TS="TRY_TO_TIMESTAMP(ADMIT_DATE)")),
            ("BSAS.RAW_BRONZE.OTP_REGISTRY", dict(_SOURCE_SYSTEM="OTP_REGISTRY", SOURCE_RECORD_ID="REGISTRY_ID", SSN_LAST4="SSN_LAST4",
              FIRST_NAME="FIRST_NAME", LAST_NAME="LAST_NAME", DOB_CLEAN="TRY_TO_DATE(DOB, 'MM/DD/YYYY')", GENDER_CLEAN="SEX",
              PROGRAM="'OTP registry'", PROGRAM_STATUS="'IN_TREATMENT'", _LOAD_TS="TRY_TO_TIMESTAMP(ENROLLED_ON)"))],
        gate=[("ESM_ADMISSION", [("SNOWFLAKE.CORE.NULL_COUNT", "SSN", None, "info"), ("BSAS.GOV.INVALID_SSN_COUNT", "SSN", "VALUE = 0", "warn"),
                                 ("BSAS.GOV.INVALID_DOB_COUNT", "DOB", "VALUE = 0", "warn"), ("SNOWFLAKE.CORE.NULL_COUNT", "ZIP", None, "info")]),
              ("OTP_REGISTRY", [("SNOWFLAKE.CORE.NULL_COUNT", "SSN_LAST4", None, "info"), ("BSAS.GOV.INVALID_DOB_COUNT", "DOB", "VALUE = 0", "warn")])],
        remediation=[("ESM_ADMISSION", "SSN", "ssn")],
        id_rank=["ESM_ADMISSION", "OTP_REGISTRY"], name_rank=["ESM_ADMISSION", "OTP_REGISTRY"], contact_rank=["ESM_ADMISSION", "OTP_REGISTRY"],
        alerts=lambda db: dup_alert(db, "ESM_ADMISSION", "FRAGMENTED_CARE", "NULL::NUMBER",
                                    "treatment episodes at different providers under different client IDs"),
    ),
    "EHS": dict(
        label="EHS", entity="clients", prefix="EHS", agency_id_label="A-number",
        persona="You are a data steward at the Executive Office of Health and Human Services (refugee services and human service transportation).",
        survivorship="IDs and DOB from ORI RISIS first (A-number, documented DOB), then HST; contact from HST; address most recent.",
        tables=[("RAW_BRONZE", "ORI_RISIS_CLIENT", "ORI RISIS: Office for Refugees and Immigrants client records"),
                ("RAW_BRONZE", "HST_RIDER", "HST broker: human service transportation riders")],
        sources=[
            ("EHS.RAW_BRONZE.ORI_RISIS_CLIENT", dict(_SOURCE_SYSTEM="ORI_RISIS", SOURCE_RECORD_ID="ORI_CLIENT_ID", AGENCY_ID="A_NUMBER",
              SSN=SSN9.format("SSN"), SSN_LAST4="RIGHT(" + SSN9.format("SSN") + ", 4)", FIRST_NAME="GIVEN_NAME",
              LAST_NAME="NULLIF(FAMILY_NAME, 'FNU')", DOB_CLEAN="TRY_TO_DATE(DOB, 'YYYY-MM-DD')", GENDER_CLEAN="SEX",
              ADDRESS_STREET="ADDRESS", ADDRESS_CITY="CITY", ADDRESS_ZIP="LEFT(ZIP, 5)", PROGRAM="'ORI refugee services'",
              PROGRAM_STATUS="'ACTIVE'", _LOAD_TS="TRY_TO_TIMESTAMP(ARRIVAL_DATE)")),
            ("EHS.RAW_BRONZE.HST_RIDER", dict(_SOURCE_SYSTEM="HST_BROKER", SOURCE_RECORD_ID="HST_RIDER_ID",
              FIRST_NAME="NULLIF(REPLACE(RIDER_FIRST, '.', ''), '')", LAST_NAME="RIDER_LAST", DOB_CLEAN="TRY_TO_DATE(RIDER_DOB, 'YYYY-MM-DD')",
              PHONE_CLEAN=DIGITS.format("PHONE"), ADDRESS_STREET="SPLIT_PART(PICKUP_ADDRESS, ', ', 1)",
              ADDRESS_CITY="TRIM(REGEXP_REPLACE(SPLIT_PART(PICKUP_ADDRESS, ', ', 2), '[0-9]{5}$', ''))", ADDRESS_ZIP="RIGHT(PICKUP_ADDRESS, 5)",
              PROGRAM="'HST rides (' || SPONSOR_AGENCY || ')'", PROGRAM_STATUS="'ACTIVE'", _LOAD_TS="TRY_TO_TIMESTAMP(LAST_TRIP_DATE)"))],
        gate=[("ORI_RISIS_CLIENT", [("SNOWFLAKE.CORE.NULL_COUNT", "SSN", None, "info"), ("EHS.GOV.INVALID_DOB_COUNT", "DOB", "VALUE = 0", "warn"),
                                    ("SNOWFLAKE.CORE.NULL_COUNT", "A_NUMBER", None, "info")]),
              ("HST_RIDER", [("SNOWFLAKE.CORE.NULL_COUNT", "RIDER_DOB", "VALUE = 0", "warn"), ("SNOWFLAKE.CORE.NULL_COUNT", "MASSHEALTH_ID", None, "info")])],
        remediation=[],
        id_rank=["ORI_RISIS", "HST_BROKER"], name_rank=["ORI_RISIS", "HST_BROKER"], contact_rank=["HST_BROKER", "ORI_RISIS"],
        alerts=lambda db: dup_alert(db, "HST_BROKER", "DUPLICATE_RIDER", "NULL::NUMBER", "HST rider IDs for one person (trips split across IDs)"),
    ),
}

HUB_SOURCES = ["MASSHEALTH", "DTA", "BSAS", "EHS"]
# The hub gates what agencies send it: gold records should arrive clean.
HUB_GATE = [(f"{a}_PERSON", [("SNOWFLAKE.CORE.NULL_COUNT", "DOB_CLEAN", None, "info"),
                             ("EOHHS_HUB.GOV.INVALID_MA_ZIP_COUNT", "ADDRESS_ZIP", "VALUE = 0", "warn"),
                             ("EOHHS_HUB.GOV.INVALID_EMAIL_COUNT", "EMAIL_CLEAN", "VALUE = 0", "warn"),
                             ("SNOWFLAKE.CORE.NULL_COUNT", "TOKEN_SSN", None, "info")]) for a in ("MASSHEALTH", "DTA", "EHS")] + [
    ("BSAS_PERSON", [("SNOWFLAKE.CORE.NULL_COUNT", "TOKEN_SSN", None, "info"),
                     ("SNOWFLAKE.CORE.NULL_COUNT", "TOKEN_NAME_DOB", "VALUE = 0", "warn")])]
HUB_TOKEN_COLS = ["TOKEN_SSN", "TOKEN_NAME_DOB", "TOKEN_NAME_DOB_ZIP"]


def hub_sources():
    out = []
    for a in HUB_SOURCES:
        t = f"EOHHS_HUB.RAW_BRONZE.{a}_PERSON"
        base = dict(_SOURCE_SYSTEM=a, SOURCE_RECORD_ID="MASTER_ID", SSN="TOKEN_SSN", PROGRAM_STATUS="IFF(IS_ACTIVE, 'ACTIVE', 'INACTIVE')",
                    TOKEN_SSN="TOKEN_SSN", TOKEN_NAME_DOB="TOKEN_NAME_DOB", TOKEN_NAME_DOB_ZIP="TOKEN_NAME_DOB_ZIP", _LOAD_TS="LAST_UPDATED")
        if a == "BSAS":
            base.update(PROGRAM="'BSAS (token only)'")
        else:
            base.update(SSN_LAST4="SSN_LAST4", FIRST_NAME="FIRST_NAME_CLEAN", LAST_NAME="LAST_NAME_CLEAN", MIDDLE_NAME="MIDDLE_NAME",
                        DOB_CLEAN="DOB_CLEAN", GENDER_CLEAN="GENDER_CLEAN", EMAIL_CLEAN="EMAIL_CLEAN", PHONE_CLEAN="PHONE_CLEAN",
                        ADDRESS_STREET="ADDRESS_STREET_CLEAN", ADDRESS_CITY="ADDRESS_CITY", ADDRESS_ZIP="ADDRESS_ZIP",
                        PROGRAM=f"'{AGENCIES[a]['label']}: ' || NVL(PROGRAMS, '')", _LOAD_TS="COALESCE(ADDRESS_AS_OF, LAST_UPDATED)")
        out.append((t, base))
    return out


HUB_LOAD = "\n".join(
    [f"CREATE OR REPLACE TABLE EOHHS_HUB.RAW_BRONZE.{a}_PERSON COMMENT = 'Shared from {a}.MASTER_GOLD.HUB_EXPORT"
     + (" (salted tokens only, 42 CFR Part 2)" if a == "BSAS" else "") + f"' AS SELECT * FROM {a}.MASTER_GOLD.HUB_EXPORT;"
     for a in HUB_SOURCES]
    + ["""-- Hub answer key: each agency master record maps to the resident most of its
-- source records belong to. Scoring only.
CREATE OR REPLACE TABLE EOHHS_HUB.GOV.GROUND_TRUTH AS
""" + "\nUNION ALL\n".join(
        f"""SELECT '{a}' SOURCE_SYSTEM, x.MASTER_ID SOURCE_RECORD_ID, MODE(g.RESIDENT_ID) RESIDENT_ID
FROM {a}.MASTER_GOLD.XREF x JOIN {a}.GOV.GROUND_TRUTH g ON g.SOURCE_SYSTEM = x._SOURCE_SYSTEM AND g.SOURCE_RECORD_ID = x.SOURCE_RECORD_ID
GROUP BY 2""" for a in HUB_SOURCES) + ";",
       "CREATE OR REPLACE TABLE EOHHS_HUB.GOV.RESIDENT_TRUTH (RESIDENT_ID VARCHAR, TRUE_FIRST VARCHAR, TRUE_LAST VARCHAR, TRUE_DOB VARCHAR, SEX VARCHAR, "
       "AGENCY_FOOTPRINT VARCHAR, N_AGENCIES VARCHAR, REFUGEE VARCHAR, HOMELESS VARCHAR, INCOME_FPL_PCT VARCHAR);",
       f"PUT file://{DATA}/EOHHS_HUB__GOV__RESIDENT_TRUTH.csv @EOHHS_HUB.RAW_BRONZE.LANDING/truth/ AUTO_COMPRESS=TRUE OVERWRITE=TRUE;",
       "COPY INTO EOHHS_HUB.GOV.RESIDENT_TRUTH FROM @EOHHS_HUB.RAW_BRONZE.LANDING/truth/ FILE_FORMAT = (FORMAT_NAME = EOHHS_HUB.RAW_BRONZE.CSV_RAW) PURGE = TRUE;"])

HUB_ALERTS = """WITH x AS (SELECT * FROM EOHHS_HUB.MASTER_GOLD.XREF),
  f AS (
    SELECT MASTER_ID,
      BOOLOR_AGG(_SOURCE_SYSTEM = 'MASSHEALTH') HAS_MH, BOOLOR_AGG(_SOURCE_SYSTEM = 'DTA' AND PROGRAM_STATUS = 'ACTIVE' AND PROGRAM ILIKE '%SNAP: OPEN%') SNAP_OPEN,
      BOOLOR_AGG(_SOURCE_SYSTEM = 'BSAS' AND PROGRAM_STATUS = 'ACTIVE') IN_TREATMENT,
      MAX_BY(ADDRESS_STREET_CLEAN, IFF(_SOURCE_SYSTEM = 'MASSHEALTH', 1, NULL)) MH_STREET,
      MAX(IFF(_SOURCE_SYSTEM = 'MASSHEALTH', _LOAD_TS, NULL)) MH_AS_OF,
      MAX_BY(ADDRESS_STREET_CLEAN || ', ' || ADDRESS_ZIP || ' (' || _SOURCE_SYSTEM || ')', IFF(_SOURCE_SYSTEM NOT IN ('MASSHEALTH', 'BSAS') AND ADDRESS_STREET_CLEAN IS NOT NULL, DATE_PART(EPOCH, _LOAD_TS), NULL)) OTHER_ADDR,
      MAX_BY(ADDRESS_STREET_CLEAN, IFF(_SOURCE_SYSTEM NOT IN ('MASSHEALTH', 'BSAS') AND ADDRESS_STREET_CLEAN IS NOT NULL, DATE_PART(EPOCH, _LOAD_TS), NULL)) OTHER_STREET,
      MAX(IFF(_SOURCE_SYSTEM NOT IN ('MASSHEALTH', 'BSAS') AND ADDRESS_STREET_CLEAN IS NOT NULL, _LOAD_TS, NULL)) OTHER_AS_OF,
      COUNT(DISTINCT _SOURCE_SYSTEM) SYSTEMS
    FROM x GROUP BY 1)
  SELECT MASTER_ID, 'ADDRESS_UPDATE_AVAILABLE' AS ALERT_TYPE, NULL::NUMBER AS AMOUNT_AT_RISK,
         'MassHealth mails ' || MH_STREET || '; newer address on file: ' || OTHER_ADDR || ', ' || DATEDIFF(day, MH_AS_OF, OTHER_AS_OF) || ' days newer' AS DETAIL, SYSTEMS
  FROM f WHERE HAS_MH AND MH_STREET IS NOT NULL AND OTHER_STREET IS NOT NULL AND MH_STREET != OTHER_STREET AND DATEDIFF(day, MH_AS_OF, OTHER_AS_OF) > 90
  UNION ALL
  SELECT MASTER_ID, 'SNAP_WITHOUT_MASSHEALTH', NULL, 'Open SNAP case at DTA, no MassHealth coverage: express lane enrollment candidate', SYSTEMS
  FROM f WHERE SNAP_OPEN AND NOT HAS_MH
  UNION ALL
  SELECT MASTER_ID, 'TREATMENT_WITHOUT_COVERAGE', NULL, 'In BSAS treatment, no MassHealth coverage (42 CFR Part 2: BSAS-authorized users only)', SYSTEMS
  FROM f WHERE IN_TREATMENT AND NOT HAS_MH"""

HUB_AFTER = """CREATE OR REPLACE TABLE EOHHS_HUB.MASTER_GOLD.AGENCY_OVERLAP AS
  WITH p AS (
    SELECT MASTER_ID, BOOLOR_AGG(_SOURCE_SYSTEM = 'MASSHEALTH') MASSHEALTH, BOOLOR_AGG(_SOURCE_SYSTEM = 'DTA') DTA,
           BOOLOR_AGG(_SOURCE_SYSTEM = 'BSAS') BSAS, BOOLOR_AGG(_SOURCE_SYSTEM = 'EHS') EHS
    FROM EOHHS_HUB.MASTER_GOLD.XREF GROUP BY 1)
  SELECT ARRAY_TO_STRING(ARRAY_CONSTRUCT_COMPACT(IFF(MASSHEALTH, 'MassHealth', NULL), IFF(DTA, 'DTA', NULL), IFF(BSAS, 'BSAS', NULL), IFF(EHS, 'EHS', NULL)), ' + ') AS COMBINATION,
         MASSHEALTH, DTA, BSAS, EHS, IFF(MASSHEALTH, 1, 0) + IFF(DTA, 1, 0) + IFF(BSAS, 1, 0) + IFF(EHS, 1, 0) AS N_AGENCIES, COUNT(*) AS RESIDENTS
  FROM p GROUP BY ALL;
""" + "\n".join(
    f"""  DELETE FROM {a}.MASTER_GOLD.EOHHS_ID_MAP;
  INSERT INTO {a}.MASTER_GOLD.EOHHS_ID_MAP
  SELECT x.SOURCE_RECORD_ID, x.MASTER_ID,
         (SELECT LISTAGG(DISTINCT y._SOURCE_SYSTEM, ', ') WITHIN GROUP (ORDER BY y._SOURCE_SYSTEM) FROM EOHHS_HUB.MASTER_GOLD.XREF y
           WHERE y.MASTER_ID = x.MASTER_ID{'' if a == 'BSAS' else " AND y._SOURCE_SYSTEM != 'BSAS'"}),
         CURRENT_TIMESTAMP()::TIMESTAMP_NTZ
  FROM EOHHS_HUB.MASTER_GOLD.XREF x WHERE x._SOURCE_SYSTEM = '{a}';""" for a in HUB_SOURCES)

HUB_T1_EXTRA = """,
-- Hub-only: BSAS arrives as tokens, so a salted name + DOB + ZIP token is
-- the S3 equivalent that works without ever seeing the values.
s6 AS (
  SELECT a.ROW_ID, b.ROW_ID, 'T1_S6_TOKEN_NAME_DOB_ZIP', 0.95
  FROM r a JOIN r b ON a.TOKEN_NAME_DOB_ZIP = b.TOKEN_NAME_DOB_ZIP AND a.ROW_ID < b.ROW_ID
  WHERE NOT (a.SSN IS NOT NULL AND b.SSN IS NOT NULL AND a.SSN != b.SSN)
)"""


def render(db, cfg, template):
    hub = db == "EOHHS_HUB"
    rep = {
        "DB": db, "LABEL": cfg["label"], "ENTITY": cfg["entity"], "ID_PREFIX": cfg["prefix"], "PERSONA": cfg["persona"].replace("'", "''"),
        "AGENCY_ID_LABEL": cfg["agency_id_label"], "SURVIVORSHIP_NOTE": cfg["survivorship"],
        "ID_RANK": rank(cfg["id_rank"]), "NAME_RANK": rank(cfg["name_rank"]), "CONTACT_RANK": rank(cfg["contact_rank"]),
        "ACTIVE_EXPR": ACTIVE, "GROUND_TRUTH": f"{db}.GOV.GROUND_TRUTH",
    }
    if hub:
        rep.update(LOAD_SQL=f"CREATE STAGE IF NOT EXISTS {db}.RAW_BRONZE.LANDING;\nCREATE OR REPLACE FILE FORMAT {db}.RAW_BRONZE.CSV_RAW TYPE = CSV "
                   "FIELD_OPTIONALLY_ENCLOSED_BY = '\"' SKIP_HEADER = 1 NULL_IF = ('') EMPTY_FIELD_AS_NULL = TRUE;\n" + HUB_LOAD,
                   GATE_SQL=gate_sql(db, HUB_GATE),
                   REMEDIATION_SQL="", STACKED_SQL=stacked(hub_sources(), HUB_TOKEN_COLS),
                   TOKEN_COLS="TOKEN_SSN, TOKEN_NAME_DOB, TOKEN_NAME_DOB_ZIP", CLEAN_DMFS="ALTER TABLE PERSON_CLEAN SET DATA_METRIC_SCHEDULE = 'TRIGGER_ON_CHANGES';\n"
                   "ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (DOB_CLEAN);\n"
                   "ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.NULL_COUNT ON (TOKEN_SSN);\n"
                   "ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION EOHHS_HUB.GOV.INVALID_MA_ZIP_COUNT ON (ADDRESS_ZIP) EXPECTATION zip_in_ma (VALUE = 0);\n"
                   "ALTER TABLE PERSON_CLEAN ADD DATA METRIC FUNCTION SNOWFLAKE.CORE.ROW_COUNT ON ();",
                   T1_FILTER="FIRST_NAME_CLEAN IS NOT NULL OR LAST_NAME_CLEAN IS NOT NULL OR TOKEN_NAME_DOB IS NOT NULL",
                   EXTRA_T1_RULES=HUB_T1_EXTRA, EXTRA_T1_UNION=" UNION ALL SELECT * FROM s6",
                   SSN_EDIT_EXPR="NULL::NUMBER", SSN_VALIDITY="100.0",
                   ALERTS_SQL=HUB_ALERTS, AFTER_REFRESH=HUB_AFTER, EXTRA_SQL="")
    else:
        rep.update(LOAD_SQL=load_sql(db, cfg["tables"] + [("GOV", "GROUND_TRUTH", "Synthetic answer key. Scoring only, never read by matching.")]),
                   GATE_SQL=gate_sql(db, cfg["gate"]), REMEDIATION_SQL=remediation_sql(db, cfg["remediation"]),
                   STACKED_SQL=stacked(cfg["sources"]), TOKEN_COLS=AGENCY_TOKENS.format(db=db), CLEAN_DMFS=CLEAN_DMFS.format(db=db),
                   T1_FILTER="FIRST_NAME_CLEAN IS NOT NULL OR LAST_NAME_CLEAN IS NOT NULL", EXTRA_T1_RULES="", EXTRA_T1_UNION="",
                   SSN_EDIT_EXPR="EDITDISTANCE(a.SSN, b.SSN)",
                   SSN_VALIDITY="ROUND(100.0*COUNT_IF(SSN REGEXP '^[0-9]{9}$')/NULLIF(COUNT(SSN),0),1)",
                   ALERTS_SQL=cfg["alerts"](db), AFTER_REFRESH="",
                   EXTRA_SQL=hub_export(db, cfg.get("part2", False)) + "\n" + eohhs_map(db))
    s = template
    for k, v in rep.items():
        s = s.replace(f"@@{k}@@", v)
    assert "@@" not in s, [l for l in s.splitlines() if "@@" in l][:3]
    return s


HUB = dict(label="EOHHS Commonwealth Resident Index", entity="residents", prefix="EOH", agency_id_label="agency ID",
           persona="You are a data steward at the Massachusetts Executive Office of Health and Human Services, linking agency master records into one Commonwealth Resident Index.",
           survivorship="Name and DOB from MassHealth first, then DTA, then EHS; contact from DTA first; address most recent across agencies.",
           id_rank=["MASSHEALTH", "DTA", "EHS", "BSAS"], name_rank=["MASSHEALTH", "DTA", "EHS", "BSAS"], contact_rank=["DTA", "MASSHEALTH", "EHS", "BSAS"])

if __name__ == "__main__":
    tpl = open(os.path.join(HERE, "sql", "template.sql")).read()
    os.makedirs(os.path.join(HERE, "sql", "build"), exist_ok=True)
    for db, cfg in list(AGENCIES.items()) + [("EOHHS_HUB", HUB)]:
        with open(os.path.join(HERE, "sql", "build", f"{db}.sql"), "w") as f:
            f.write(render(db, cfg, tpl))
        print("rendered", db)
