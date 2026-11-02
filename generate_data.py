"""
EOHHS Commonwealth Resident Index : synthetic population generator.

Pure standard library, deterministic for a given seed. Runs two ways:
  python3 generate_data.py -> ./data/<DB>__<SCHEMA>__<TABLE>.csv
  Loaded by sql/01_load.sql into each agency's RAW_BRONZE, ground truth into
  <DB>.GOV.GROUND_TRUTH (scoring only, never read by the matching rules).

Design (rates come from ./research/*.md, most marked ASSUMED there):
  - ~7,000 true residents. Agency footprint mix ~45% one agency, ~35% two,
    ~20% three or more. MassHealth largest, DTA mostly inside MassHealth,
    BSAS and EHS smaller with partial overlap.
  - Each agency has 2 source systems and only the fields it would collect.
  - Within-agency duplicates (churn, re-applications, per-provider client IDs)
    and cross-agency drift (nicknames, typos, DOB swaps, married names, moves).
"""
import csv
import os
import random
from datetime import date, timedelta

N_RESIDENTS = 7000
AS_OF = date(2026, 10, 1)

FIRST_M = ["James", "Michael", "Robert", "John", "David", "William", "Richard", "Joseph", "Thomas", "Christopher",
           "Daniel", "Matthew", "Anthony", "Mark", "Steven", "Paul", "Andrew", "Joshua", "Kevin", "Brian",
           "Jose", "Luis", "Carlos", "Juan", "Miguel", "Pedro", "Jean", "Wilson", "Joao", "Paulo",
           "Mohammed", "Ahmad", "Omar", "Ali", "Hassan", "Minh", "Duc", "Wei", "Jun", "Dmytro",
           "Oleksandr", "Abdi", "Mamadou", "Patrick", "Sean", "Edward", "Timothy", "Ryan", "Jason", "Eric"]
FIRST_F = ["Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
           "Nancy", "Lisa", "Margaret", "Ashley", "Kimberly", "Emily", "Donna", "Michelle", "Katherine", "Rebecca",
           "Maria", "Ana", "Carmen", "Rosa", "Yesenia", "Guadalupe", "Marie", "Fabiola", "Fernanda", "Juliana",
           "Fatima", "Aisha", "Amina", "Mariam", "Leila", "Thu", "Linh", "Mei", "Xiu", "Olena",
           "Iryna", "Hodan", "Fatoumata", "Kathleen", "Colleen", "Theresa", "Christine", "Deborah", "Stephanie", "Nicole"]
LAST = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
        "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
        "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
        "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
        "Murphy", "Sullivan", "OBrien", "Kelly", "McCarthy", "Fitzgerald", "Doherty", "Walsh", "Ryan", "Burke",
        "Silva", "Santos", "Pereira", "Oliveira", "Costa", "Ferreira", "Pierre", "Joseph", "Jean-Baptiste", "Charles",
        "Tran", "Pham", "Le", "Chen", "Wang", "Li", "Zhang", "Ahmed", "Hassan", "Mohamed",
        "Ali", "Abdullah", "Rahimi", "Haidari", "Kovalenko", "Shevchenko", "Bondarenko", "Diallo", "Ortiz", "Rivera",
        "Cruz", "Reyes", "Morales", "Gomez", "Diaz", "Vargas", "Castillo", "Medina", "Soto", "Colon"]
NICK = {"William": "Bill", "Robert": "Bob", "Richard": "Rick", "Joseph": "Joe", "Thomas": "Tom",
        "Christopher": "Chris", "Daniel": "Dan", "Matthew": "Matt", "Anthony": "Tony", "Michael": "Mike",
        "Steven": "Steve", "Andrew": "Andy", "Joshua": "Josh", "Edward": "Ed", "Timothy": "Tim", "James": "Jim",
        "John": "Jack", "David": "Dave", "Patrick": "Pat", "Elizabeth": "Liz", "Patricia": "Patty",
        "Jennifer": "Jen", "Margaret": "Peggy", "Katherine": "Kate", "Rebecca": "Becky", "Kimberly": "Kim",
        "Susan": "Sue", "Deborah": "Debbie", "Christine": "Chris", "Kathleen": "Kathy", "Theresa": "Terry",
        "Stephanie": "Steph", "Jose": "Pepe", "Guadalupe": "Lupe", "Oleksandr": "Sasha", "Mohammed": "Mohamed"}
TRANSLIT = {"Mohammed": "Muhammad", "Ahmad": "Ahmed", "Hassan": "Hasan", "Fatima": "Fatma", "Aisha": "Ayesha",
            "Mariam": "Maryam", "Leila": "Layla", "Oleksandr": "Aleksandr", "Olena": "Elena", "Iryna": "Irina",
            "Dmytro": "Dmitri", "Abdi": "Abdy", "Hodan": "Hodon", "Rahimi": "Raheemi", "Haidari": "Haydari",
            "Kovalenko": "Kowalenko", "Shevchenko": "Shewchenko", "Mohamed": "Muhamed", "Abdullah": "Abdallah"}
# MA cities with representative ZIPs (weights loosely follow Medicaid population)
CITIES = [("BOSTON", ["02119", "02121", "02124", "02125", "02126", "02128", "02130", "02118"], 16),
          ("WORCESTER", ["01603", "01604", "01605", "01607", "01610"], 9),
          ("SPRINGFIELD", ["01103", "01104", "01105", "01107", "01109"], 9),
          ("LOWELL", ["01850", "01851", "01852", "01854"], 6), ("BROCKTON", ["02301", "02302"], 6),
          ("LAWRENCE", ["01840", "01841", "01843"], 6), ("LYNN", ["01902", "01904", "01905"], 5),
          ("NEW BEDFORD", ["02740", "02744", "02745", "02746"], 5), ("FALL RIVER", ["02720", "02721", "02723", "02724"], 5),
          ("CHELSEA", ["02150"], 4), ("HOLYOKE", ["01040"], 4), ("QUINCY", ["02169", "02170", "02171"], 4),
          ("REVERE", ["02151"], 3), ("MALDEN", ["02148"], 3), ("EVERETT", ["02149"], 3), ("FRAMINGHAM", ["01701", "01702"], 3),
          ("FITCHBURG", ["01420"], 2), ("PITTSFIELD", ["01201"], 2), ("SOMERVILLE", ["02143", "02144", "02145"], 2),
          ("CAMBRIDGE", ["02139", "02141"], 2), ("TAUNTON", ["02780"], 2), ("HAVERHILL", ["01830", "01832"], 2)]
STREETS = ["Main St", "Washington St", "Elm St", "Pleasant St", "Center St", "School St", "Union St", "Park Ave",
           "Highland Ave", "Water St", "Chestnut St", "Maple St", "Oak St", "Prospect St", "Broadway",
           "Bowdoin St", "Blue Hill Ave", "Columbia Rd", "Dorchester Ave", "Belmont St", "State St", "Summer St",
           "Essex St", "Hancock St", "Franklin St", "Central St", "Spring St", "Walnut St", "Mill St", "Cedar St"]
STREET_ABBR = {"St": "Street", "Ave": "Avenue", "Rd": "Road"}
SHELTERS = [("112 SOUTHAMPTON ST", "BOSTON", "02118"), ("25 QUEEN ST", "WORCESTER", "01610"),
            ("755 WORTHINGTON ST", "SPRINGFIELD", "01105"), ("50 MIDDLESEX ST", "LOWELL", "01851"),
            ("1 SHELTER PL", "BROCKTON", "02301")]
RESETTLEMENT = [("2 BOYLSTON ST", "BOSTON", "02116"), ("484 MAIN ST", "WORCESTER", "01608"),
                ("1 MONARCH PL", "SPRINGFIELD", "01144"), ("101 JACKSON ST", "LOWELL", "01852")]
LANGS = [("English", 72), ("Spanish", 16), ("Portuguese", 4), ("Haitian Creole", 2.5), ("Chinese", 1.5),
         ("Vietnamese", 1.5), ("Arabic", 0.8), ("Russian", 0.7), ("Other", 1)]
REFUGEE_LANGS = [("Arabic", 20), ("Dari", 18), ("Pashto", 10), ("Haitian Creole", 15), ("Spanish", 10),
                 ("Portuguese", 7), ("Somali", 8), ("Ukrainian", 12)]

# footprint combos: (agencies, weight) within each size bucket
COMBOS = {1: [(("MASSHEALTH",), 55), (("DTA",), 15), (("BSAS",), 12), (("EHS",), 18)],
          2: [(("MASSHEALTH", "DTA"), 60), (("MASSHEALTH", "EHS"), 15), (("MASSHEALTH", "BSAS"), 12),
              (("DTA", "EHS"), 5), (("DTA", "BSAS"), 4), (("BSAS", "EHS"), 4)],
          3: [(("MASSHEALTH", "DTA", "EHS"), 45), (("MASSHEALTH", "DTA", "BSAS"), 40),
              (("MASSHEALTH", "BSAS", "EHS"), 10), (("DTA", "BSAS", "EHS"), 5)],
          4: [(("MASSHEALTH", "DTA", "BSAS", "EHS"), 100)]}
SIZE_MIX = [(1, 45), (2, 35), (3, 15), (4, 5)]


def wchoice(rng, items):
    tot = sum(w for _, w in items)
    x = rng.uniform(0, tot)
    for v, w in items:
        x -= w
        if x <= 0:
            return v
    return items[-1][0]


# ---------------- messiness helpers ----------------
def typo(rng, s):
    if not s or len(s) < 4:
        return s
    i = rng.randrange(1, len(s) - 1)
    k = rng.random()
    if k < 0.35:   # transpose
        return s[:i] + s[i + 1] + s[i] + s[i + 2:]
    if k < 0.65:   # drop
        return s[:i] + s[i + 1:]
    if k < 0.85:   # double
        return s[:i] + s[i] + s[i:]
    return s[:i] + rng.choice("aeiou") + s[i + 1:]


def dob_noise(rng, d, swap=0.0, year=0.0, jan1=0.0):
    r = rng.random()
    if r < swap and d.day <= 12 and d.day != d.month:
        return date(d.year, d.day, d.month)
    r -= swap
    if r < year:
        try:
            return d.replace(year=d.year + rng.choice([-1, 1]))
        except ValueError:
            return d
    r -= year
    if r < jan1:
        return date(d.year, 1, 1)
    return d


def ssn_typo(rng, s):
    i = rng.randrange(0, 8)
    return s[:i] + s[i + 1] + s[i] + s[i + 2:]


def addr_variant(rng, a):
    if rng.random() < 0.5:
        for k, v in STREET_ABBR.items():
            if a.endswith(" " + k):
                return a[: -len(k)] + v
    if rng.random() < 0.3:
        return a.upper()
    return a


def fmt_phone(rng, p):
    if not p:
        return p
    style = rng.random()
    if style < 0.4:
        return f"({p[:3]}) {p[3:6]}-{p[6:]}"
    if style < 0.7:
        return f"{p[:3]}-{p[3:6]}-{p[6:]}"
    return p


# ---------------- population ----------------
def make_residents(rng):
    city_items = [((c, z), w) for c, z, w in CITIES]
    people = []
    for rid in range(1, N_RESIDENTS + 1):
        sex = "F" if rng.random() < 0.52 else "M"
        first = rng.choice(FIRST_F if sex == "F" else FIRST_M)
        last = rng.choice(LAST)
        middle = rng.choice("ABCDEFGHJKLMNPRST") if rng.random() < 0.7 else ""
        age = int(min(95, max(0, rng.gauss(36, 20))))
        dob = AS_OF - timedelta(days=age * 365 + rng.randrange(0, 365))
        ssn = f"{rng.randrange(100, 899):03d}{rng.randrange(10, 99):02d}{rng.randrange(1000, 9999):04d}"
        # address history: 1 current + 0-2 prior
        hist = []
        for _ in range(1 + (rng.random() < 0.30) + (rng.random() < 0.10)):
            city, zips = wchoice(rng, city_items)
            hist.append((f"{rng.randrange(1, 999)} {rng.choice(STREETS)}", city, rng.choice(zips)))
        size = wchoice(rng, SIZE_MIX)
        agencies = wchoice(rng, COMBOS[size])
        people.append(dict(
            rid=rid, first=first, last=last, middle=middle, sex=sex, dob=dob, ssn=ssn,
            maiden=None, married=(rng.choice(LAST) if sex == "F" and age > 24 and rng.random() < 0.10 else None),
            addr=hist, phone=f"{rng.choice(['617', '508', '413', '978', '781', '774', '857', '339'])}{rng.randrange(2000000, 9999999)}",
            email=None, lang=wchoice(rng, LANGS),
            agencies=agencies, refugee=("EHS" in agencies and rng.random() < 0.40),
            homeless=("BSAS" in agencies and rng.random() < 0.25),
            income_fpl=rng.randrange(0, 130) if "DTA" in agencies else rng.randrange(0, 320),
        ))
        p = people[-1]
        p["email"] = f"{p['first'].lower()}.{p['last'].lower().replace('-', '')}{rng.randrange(1, 99)}@example.com" if rng.random() < 0.6 else None
        if p["refugee"]:
            p["lang"] = wchoice(rng, REFUGEE_LANGS)
            if rng.random() < 0.20:   # unknown DOB defaulted to Jan 1 at arrival
                p["dob"] = date(p["dob"].year, 1, 1)
    return people


def view_of(rng, p, *, nick=0.0, typo_r=0.0, swap=0.0, year=0.0, jan1=0.0, married=0.5, translit=0.0,
            addr_old=0.0, middle=0.6):
    """One agency's (or one system's) imperfect view of a true resident."""
    first, last = p["first"], p["last"]
    if rng.random() < nick and first in NICK:
        first = NICK[first]
    if rng.random() < translit:
        first = TRANSLIT.get(first, first)
        last = TRANSLIT.get(last, last)
    if p["married"] and rng.random() < married:
        last = p["married"]
    if rng.random() < typo_r:
        if rng.random() < 0.5:
            first = typo(rng, first)
        else:
            last = typo(rng, last)
    dob = dob_noise(rng, p["dob"], swap, year, jan1)
    hist = p["addr"]
    a = hist[-1] if (len(hist) == 1 or rng.random() >= addr_old) else rng.choice(hist[:-1])
    return dict(first=first, last=last, middle=(p["middle"] if rng.random() < middle else ""), dob=dob,
                street=addr_variant(rng, a[0]), city=a[1], zip=a[2])


def dstr(d, style="iso"):
    if d is None:
        return None
    if style == "us":
        return d.strftime("%m/%d/%Y")
    if style == "compact":
        return d.strftime("%Y%m%d")
    return d.isoformat()


class IdGen:
    def __init__(self, rng):
        self.rng, self.seen = rng, set()

    def num(self, n, prefix=""):
        while True:
            v = prefix + "".join(str(self.rng.randrange(10)) for _ in range(n))
            if v not in self.seen:
                self.seen.add(v)
                return v


# ---------------- agency extracts ----------------
def gen_masshealth(rng, people, ids, truth):
    mmis, hix, ma21 = [], [], []
    for p in people:
        if "MASSHEALTH" not in p["agencies"]:
            continue
        senior = (AS_OF - p["dob"]).days > 65 * 365
        member_ids = [ids.num(12)]
        if rng.random() < 0.03:                      # duplicate member ID (HIX vs MA-21 dupes)
            member_ids.append(ids.num(12))
        for mid in member_ids:
            v = view_of(rng, p, nick=0.05, typo_r=0.04, swap=0.01, addr_old=0.15)
            ssn = None if rng.random() < 0.12 else p["ssn"]
            if ssn and rng.random() < 0.01:
                ssn = ssn_typo(rng, ssn)
            mmis.append(dict(MEMBER_ID=mid, FIRST_NAME=v["first"].upper(), LAST_NAME=v["last"].upper(),
                             MIDDLE_INIT=v["middle"], DOB=dstr(v["dob"]), SEX=p["sex"], SSN=ssn,
                             ADDR_LINE1=v["street"].upper(), CITY=v["city"], STATE="MA", ZIP=v["zip"],
                             PHONE=p["phone"] if rng.random() < 0.85 else None, PRIMARY_LANGUAGE=p["lang"],
                             ELIG_CATEGORY=("NON-MAGI" if senior else rng.choice(["MAGI-ADULT", "MAGI-CHILD", "MAGI-PARENT", "COMMONHEALTH"])),
                             ENROLL_START=dstr(AS_OF - timedelta(days=rng.randrange(30, 3000))),
                             RECORD_TS=dstr(AS_OF - timedelta(days=rng.randrange(0, 60)))))
            truth.append(("MASSHEALTH", "MMIS", mid, p["rid"]))
        if senior or rng.random() < 0.15:            # MA-21 (non-MAGI / LTC)
            if rng.random() < 0.65:
                cid = ids.num(9, "M")
                v = view_of(rng, p, nick=0.10, typo_r=0.05, swap=0.02, addr_old=0.30, middle=0.3)
                ssn = None if rng.random() < 0.08 else p["ssn"]
                ma21.append(dict(CASE_NO=cid, CLIENT_NAME=f"{v['last'].upper()}, {v['first'].upper()}",
                                 BIRTH_DT=dstr(v["dob"], "us"),
                                 SSN=(f"{ssn[:3]}-{ssn[3:5]}-{ssn[5:]}" if ssn else None), GENDER=p["sex"],
                                 RES_ADDRESS=f"{v['street']}, {v['city']} MA {v['zip']}", LTC_FLAG=("Y" if senior and rng.random() < 0.2 else "N"),
                                 LAST_UPDATED=dstr(AS_OF - timedelta(days=rng.randrange(0, 400)))))
                truth.append(("MASSHEALTH", "MA21", cid, p["rid"]))
        elif rng.random() < 0.70:                    # HIX MAGI application
            aid = ids.num(10, "A")
            v = view_of(rng, p, nick=0.20, typo_r=0.06, swap=0.02, addr_old=0.25, middle=0.4)
            ssn = None if rng.random() < 0.15 else p["ssn"]
            hix.append(dict(APPLICATION_ID=aid, APPLICANT_FIRST=v["first"], APPLICANT_LAST=v["last"],
                            DATE_OF_BIRTH=dstr(v["dob"]), SSN=ssn, EMAIL=p["email"], PHONE=fmt_phone(rng, p["phone"]),
                            HOME_STREET=v["street"], HOME_CITY=v["city"].title(), HOME_ZIP=v["zip"],
                            HOUSEHOLD_SIZE=rng.randrange(1, 6), INCOME_FPL_PCT=p["income_fpl"],
                            CITIZENSHIP_STATUS=("QUALIFIED NONCITIZEN" if p["refugee"] else rng.choice(["US CITIZEN"] * 9 + ["QUALIFIED NONCITIZEN"])),
                            SUBMITTED_AT=dstr(AS_OF - timedelta(days=rng.randrange(0, 700)))))
            truth.append(("MASSHEALTH", "HIX", aid, p["rid"]))
    return {"RAW_BRONZE.MMIS_MEMBER": mmis, "RAW_BRONZE.HIX_APPLICATION": hix, "RAW_BRONZE.MA21_CASE": ma21}


def gen_dta(rng, people, ids, truth):
    beacon, connect = [], []
    for p in people:
        if "DTA" not in p["agencies"]:
            continue
        n = 2 if rng.random() < 0.10 else 1        # recert churn -> new client id
        for k in range(n):
            cid = ids.num(10)
            v = view_of(rng, p, nick=0.15, typo_r=0.06, swap=0.01, addr_old=(0.6 if k == 0 and n == 2 else 0.2), translit=0.05)
            ssn = None if rng.random() < 0.04 else p["ssn"]
            if ssn and rng.random() < 0.015:
                ssn = ssn_typo(rng, ssn)
            beacon.append(dict(CLIENT_ID=cid, AU_ID=ids.num(9), FIRST_NM=v["first"].upper(), LAST_NM=v["last"].upper(),
                               BIRTH_DATE=dstr(v["dob"], "compact"), SSN=ssn, SEX_CD=p["sex"],
                               STREET_ADDR=v["street"].upper(), CITY_NM=v["city"], ZIP_CD=v["zip"],
                               PROGRAM_CD=rng.choice(["SNAP"] * 9 + ["TAFDC", "EAEDC"]),
                               CASE_STATUS=("CLOSED" if (n == 2 and k == 0) else "OPEN"),
                               CERT_DATE=dstr(AS_OF - timedelta(days=rng.randrange(10, 900))),
                               RETURNED_MAIL_FLAG=("Y" if rng.random() < 0.06 else "N")))
            truth.append(("DTA", "BEACON", cid, p["rid"]))
        if rng.random() < 0.50:
            uid = ids.num(8, "DC")
            v = view_of(rng, p, nick=0.30, typo_r=0.08, swap=0.02, addr_old=0.1, middle=0.0)
            connect.append(dict(PORTAL_USER_ID=uid, FIRST_NAME=v["first"], LAST_NAME=v["last"],
                                DOB=dstr(v["dob"], "us"), EMAIL=p["email"], MOBILE=fmt_phone(rng, p["phone"]),
                                MAILING_ADDRESS=f"{v['street']}, {v['city'].title()}, MA {v['zip']}",
                                LAST_LOGIN=dstr(AS_OF - timedelta(days=rng.randrange(0, 200)))))
            truth.append(("DTA", "DTA_CONNECT", uid, p["rid"]))
    return {"RAW_BRONZE.BEACON_CLIENT": beacon, "RAW_BRONZE.DTA_CONNECT_ACCOUNT": connect}


def gen_bsas(rng, people, ids, truth):
    esm, otp = [], []
    providers = [f"PRV{n:04d}" for n in range(1, 41)]
    for p in people:
        if "BSAS" not in p["agencies"]:
            continue
        n_ep = 1 + (rng.random() < 0.45) + (rng.random() < 0.15)
        prov_ids = {}
        for e in range(n_ep):
            prov = rng.choice(providers)
            cid = prov_ids.get(prov) or ids.num(7, prov + "-")   # new ID per provider
            prov_ids[prov] = cid
            v = view_of(rng, p, nick=0.15, typo_r=0.07, swap=0.04, year=0.02, jan1=0.01, addr_old=0.3)
            r = rng.random()
            ssn = None if r < 0.30 else (None if r < 0.45 else p["ssn"])
            ssn4 = p["ssn"][-4:] if (0.30 <= r < 0.45) else None
            alias = NICK.get(p["first"]) if rng.random() < 0.15 else None
            if p["homeless"]:
                s = rng.choice(SHELTERS)
                street, city, z = (s if rng.random() < 0.6 else (None, None, None))
            else:
                street, city, z = v["street"], v["city"], v["zip"]
            eid = ids.num(9, "EP")
            esm.append(dict(EPISODE_ID=eid, PROVIDER_ID=prov, PROVIDER_CLIENT_ID=cid, FIRST_NAME=v["first"],
                            LAST_NAME=v["last"], ALIAS_FIRST=alias, DOB=dstr(v["dob"]), SEX=p["sex"],
                            SSN=ssn, SSN_LAST4=ssn4, STREET=street, CITY=city, ZIP=z,
                            HOMELESS_FLAG=("Y" if p["homeless"] else "N"),
                            ADMIT_DATE=dstr(AS_OF - timedelta(days=rng.randrange(0, 1400))),
                            SERVICE_TYPE=rng.choice(["ATS", "CSS", "RESIDENTIAL", "OUTPATIENT", "OTP"])))
            truth.append(("BSAS", "ESM_ADMISSION", eid, p["rid"]))
        if rng.random() < 0.25:                       # OTP central registry
            rid = ids.num(8, "OTP")
            v = view_of(rng, p, nick=0.05, typo_r=0.04, swap=0.02)
            otp.append(dict(REGISTRY_ID=rid, LAST_NAME=v["last"].upper(), FIRST_INITIAL=v["first"][0].upper(),
                            FIRST_NAME=v["first"].upper(), DOB=dstr(v["dob"], "us"), SEX=p["sex"],
                            SSN_LAST4=(p["ssn"][-4:] if rng.random() < 0.8 else None),
                            CLINIC_ID=rng.choice(providers), ENROLLED_ON=dstr(AS_OF - timedelta(days=rng.randrange(0, 1500)))))
            truth.append(("BSAS", "OTP_REGISTRY", rid, p["rid"]))
    return {"RAW_BRONZE.ESM_ADMISSION": esm, "RAW_BRONZE.OTP_REGISTRY": otp}


def gen_ehs(rng, people, ids, truth, mh_member_of):
    risis, hst = [], []
    for p in people:
        if "EHS" not in p["agencies"]:
            continue
        if p["refugee"]:
            oid = ids.num(7, "RIS-")
            v = view_of(rng, p, nick=0.0, typo_r=0.08, translit=0.35, addr_old=0.3, middle=0.1)
            if rng.random() < 0.10:                     # given/surname swapped
                v["first"], v["last"] = v["last"], v["first"]
            if rng.random() < 0.25:
                s = rng.choice(RESETTLEMENT)
                v["street"], v["city"], v["zip"] = s
            risis.append(dict(ORI_CLIENT_ID=oid, A_NUMBER=("A" + ids.num(9)) if rng.random() < 0.8 else None,
                              GIVEN_NAME=v["first"], FAMILY_NAME=("FNU" if rng.random() < 0.02 else v["last"]),
                              DOB=dstr(v["dob"]), SEX=p["sex"], SSN=(p["ssn"] if rng.random() < 0.4 else None),
                              PRIMARY_LANGUAGE=p["lang"], ARRIVAL_DATE=dstr(AS_OF - timedelta(days=rng.randrange(30, 1800))),
                              ADDRESS=v["street"], CITY=v["city"], ZIP=v["zip"],
                              RESETTLEMENT_AGENCY=rng.choice(["IINE", "JFS", "Ascentria", "Catholic Charities", "RIAC"])))
            truth.append(("EHS", "ORI_RISIS", oid, p["rid"]))
        if (not p["refugee"]) or rng.random() < 0.20:
            hid = ids.num(8, "HST-")
            v = view_of(rng, p, nick=0.15, typo_r=0.05, addr_old=0.15, middle=0.0)
            first = v["first"][0] + "." if rng.random() < 0.08 else v["first"]
            mh_id = mh_member_of.get(p["rid"])
            if mh_id and rng.random() < 0.03:
                mh_id = mh_id[:-1] + str((int(mh_id[-1]) + 1) % 10)
            hst.append(dict(HST_RIDER_ID=hid, RIDER_FIRST=first, RIDER_LAST=v["last"],
                            RIDER_DOB=(dstr(v["dob"]) if rng.random() > 0.05 else None),
                            PHONE=fmt_phone(rng, p["phone"]), PICKUP_ADDRESS=f"{v['street']}, {v['city'].title()} {v['zip']}",
                            SPONSOR_AGENCY=("MASSHEALTH" if mh_id else rng.choice(["DDS", "DMH", "MRC", "MCB", "DPH_EI"])),
                            MASSHEALTH_ID=mh_id, LAST_TRIP_DATE=dstr(AS_OF - timedelta(days=rng.randrange(0, 365)))))
            truth.append(("EHS", "HST_BROKER", hid, p["rid"]))
    return {"RAW_BRONZE.ORI_RISIS_CLIENT": risis, "RAW_BRONZE.HST_RIDER": hst}


# ---------------- planted demo stories ----------------
# Hand-written records so the demo always has the same five people to show.
# Their residents are excluded from random generation (agencies=()) and their
# footprint is restored for RESIDENT_TRUTH afterwards.
STORIES = {
    1: dict(first="Maria", last="Santos", sex="F", dob=date(1988, 3, 14), ssn="031645521", footprint=("MASSHEALTH", "DTA", "EHS")),
    2: dict(first="Daniel", last="Nguyen", sex="M", dob=date(2001, 6, 9), ssn="027883104", footprint=("MASSHEALTH",)),
    3: dict(first="Danielle", last="Nguyen", sex="F", dob=date(2001, 6, 9), ssn="027883217", footprint=("MASSHEALTH",)),
    4: dict(first="Kevin", last="Doherty", sex="M", dob=date(1979, 11, 2), ssn="014559873", footprint=("MASSHEALTH", "DTA", "BSAS")),
    5: dict(first="Oleksandr", last="Kovalenko", sex="M", dob=date(1975, 8, 23), ssn=None, footprint=("MASSHEALTH", "EHS")),
    6: dict(first="Katherine", last="Walsh", sex="F", dob=date(1992, 4, 7), ssn="022714456", footprint=("MASSHEALTH",)),
}


def plant_story_people(people):
    for rid, st in STORIES.items():
        p = people[rid - 1]
        p.update(first=st["first"], last=st["last"], sex=st["sex"], dob=st["dob"], ssn=st["ssn"] or "000000000",
                 married=None, refugee=(rid == 5), homeless=False, agencies=())
        p["_footprint"] = st["footprint"]
    return {rid: people[rid - 1] for rid in STORIES}


def _row(out, table, **vals):
    tmpl = {k: None for k in out[table][0]}
    tmpl.update(vals)
    out[table].append(tmpl)


def add_story_rows(out, truth, sp):
    T = lambda d: (AS_OF - timedelta(days=d)).isoformat()
    # 1. Maria Santos: MassHealth still mails her old Lawrence address (returned
    #    mail risk); DTA re-certified SNAP last month at her new Lowell address.
    _row(out, "MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", MEMBER_ID="100000000001", FIRST_NAME="MARIA", LAST_NAME="SANTOS", MIDDLE_INIT="L",
         DOB="1988-03-14", SEX="F", SSN="031645521", ADDR_LINE1="48 ESSEX ST", CITY="LAWRENCE", STATE="MA", ZIP="01840",
         PHONE="9785550142", PRIMARY_LANGUAGE="Portuguese", ELIG_CATEGORY="MAGI-PARENT", ENROLL_START=T(1460), RECORD_TS=T(410))
    _row(out, "MASSHEALTH.RAW_BRONZE.HIX_APPLICATION", APPLICATION_ID="A100000001", APPLICANT_FIRST="Maria", APPLICANT_LAST="Santos",
         DATE_OF_BIRTH="1988-03-14", SSN=None, EMAIL="maria.santos88@example.com", PHONE="(978) 555-0142", HOME_STREET="48 Essex Street",
         HOME_CITY="Lawrence", HOME_ZIP="01840", HOUSEHOLD_SIZE=3, INCOME_FPL_PCT=96, CITIZENSHIP_STATUS="US CITIZEN", SUBMITTED_AT=T(420))
    _row(out, "DTA.RAW_BRONZE.BEACON_CLIENT", CLIENT_ID="1000000001", AU_ID="100000001", FIRST_NM="MARIA", LAST_NM="SANTOS",
         BIRTH_DATE="19880314", SSN="031645521", SEX_CD="F", STREET_ADDR="215 MIDDLESEX ST", CITY_NM="LOWELL", ZIP_CD="01851",
         PROGRAM_CD="SNAP", CASE_STATUS="OPEN", CERT_DATE=T(24), RETURNED_MAIL_FLAG="N")
    _row(out, "DTA.RAW_BRONZE.DTA_CONNECT_ACCOUNT", PORTAL_USER_ID="DC10000001", FIRST_NAME="Maria", LAST_NAME="Santos", DOB="03/14/1988",
         EMAIL="maria.santos88@example.com", MOBILE="978-555-0142", MAILING_ADDRESS="215 Middlesex St, Lowell, MA 01851", LAST_LOGIN=T(6))
    _row(out, "EHS.RAW_BRONZE.HST_RIDER", HST_RIDER_ID="HST-10000001", RIDER_FIRST="Maria", RIDER_LAST="Santos", RIDER_DOB="1988-03-14",
         PHONE="(978) 555-0142", PICKUP_ADDRESS="215 Middlesex St, Lowell 01851", SPONSOR_AGENCY="MASSHEALTH",
         MASSHEALTH_ID="100000000001", LAST_TRIP_DATE=T(12))
    truth["MASSHEALTH"] += [("MASSHEALTH", "MMIS", "100000000001", 1), ("MASSHEALTH", "HIX", "A100000001", 1)]
    truth["DTA"] += [("DTA", "BEACON", "1000000001", 1), ("DTA", "DTA_CONNECT", "DC10000001", 1)]
    truth["EHS"] += [("EHS", "HST_BROKER", "HST-10000001", 1)]
    # 2/3. Nguyen twins: same DOB, address and family phone, different SSNs.
    #      The guards must keep them apart.
    for rid, mid, aid, first, ssn in ((2, "100000000002", "A100000002", "DANIEL", "027883104"),
                                      (3, "100000000003", "A100000003", "DANIELLE", "027883217")):
        _row(out, "MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", MEMBER_ID=mid, FIRST_NAME=first, LAST_NAME="NGUYEN", MIDDLE_INIT="",
             DOB="2001-06-09", SEX=("M" if rid == 2 else "F"), SSN=ssn, ADDR_LINE1="77 COLUMBIA RD", CITY="BOSTON", STATE="MA", ZIP="02125",
             PHONE="6175550199", PRIMARY_LANGUAGE="Vietnamese", ELIG_CATEGORY="MAGI-ADULT", ENROLL_START=T(900), RECORD_TS=T(30))
        _row(out, "MASSHEALTH.RAW_BRONZE.HIX_APPLICATION", APPLICATION_ID=aid, APPLICANT_FIRST=first.title(), APPLICANT_LAST="Nguyen",
             DATE_OF_BIRTH="2001-06-09", SSN=ssn, EMAIL=None, PHONE="617-555-0199", HOME_STREET="77 Columbia Road", HOME_CITY="Boston",
             HOME_ZIP="02125", HOUSEHOLD_SIZE=4, INCOME_FPL_PCT=120, CITIZENSHIP_STATUS="US CITIZEN", SUBMITTED_AT=T(380))
        truth["MASSHEALTH"] += [("MASSHEALTH", "MMIS", mid, rid), ("MASSHEALTH", "HIX", aid, rid)]
    # 4. Kevin Doherty: BSAS treatment record. BSAS shares only salted tokens
    #    with the hub (42 CFR Part 2), yet he still links to MassHealth and DTA.
    _row(out, "MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", MEMBER_ID="100000000004", FIRST_NAME="KEVIN", LAST_NAME="DOHERTY", MIDDLE_INIT="P",
         DOB="1979-11-02", SEX="M", SSN="014559873", ADDR_LINE1="12 BOWDOIN ST", CITY="BOSTON", STATE="MA", ZIP="02124",
         PHONE="6175550177", PRIMARY_LANGUAGE="English", ELIG_CATEGORY="MAGI-ADULT", ENROLL_START=T(700), RECORD_TS=T(15))
    _row(out, "DTA.RAW_BRONZE.BEACON_CLIENT", CLIENT_ID="1000000004", AU_ID="100000004", FIRST_NM="KEVIN", LAST_NM="DOHERTY",
         BIRTH_DATE="19791102", SSN="014559873", SEX_CD="M", STREET_ADDR="12 BOWDOIN ST", CITY_NM="BOSTON", ZIP_CD="02124",
         PROGRAM_CD="SNAP", CASE_STATUS="OPEN", CERT_DATE=T(200), RETURNED_MAIL_FLAG="N")
    _row(out, "BSAS.RAW_BRONZE.ESM_ADMISSION", EPISODE_ID="EP100000004", PROVIDER_ID="PRV0007", PROVIDER_CLIENT_ID="PRV0007-1000004",
         FIRST_NAME="Kevin", LAST_NAME="Doherty", ALIAS_FIRST=None, DOB="1979-11-02", SEX="M", SSN="014559873", SSN_LAST4=None,
         STREET="12 Bowdoin St", CITY="BOSTON", ZIP="02124", HOMELESS_FLAG="N", ADMIT_DATE=T(90), SERVICE_TYPE="OTP")
    truth["MASSHEALTH"] += [("MASSHEALTH", "MMIS", "100000000004", 4)]
    truth["DTA"] += [("DTA", "BEACON", "1000000004", 4)]
    truth["BSAS"] += [("BSAS", "ESM_ADMISSION", "EP100000004", 4)]
    # 5. Oleksandr Kovalenko: ORI transliterated and defaulted DOB to Jan 1 at
    #    arrival, no SSN yet. Same street and ZIP as his MassHealth record. The
    #    hub cannot prove it, so it goes to a steward.
    _row(out, "MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", MEMBER_ID="100000000005", FIRST_NAME="OLEKSANDR", LAST_NAME="KOVALENKO", MIDDLE_INIT="",
         DOB="1975-08-23", SEX="M", SSN=None, ADDR_LINE1="484 MAIN ST", CITY="WORCESTER", STATE="MA", ZIP="01608",
         PHONE="5085550163", PRIMARY_LANGUAGE="Ukrainian", ELIG_CATEGORY="MAGI-ADULT", ENROLL_START=T(300), RECORD_TS=T(40))
    _row(out, "EHS.RAW_BRONZE.ORI_RISIS_CLIENT", ORI_CLIENT_ID="RIS-1000005", A_NUMBER="A100000005", GIVEN_NAME="Aleksandr",
         FAMILY_NAME="Kowalenko", DOB="1975-01-01", SEX="M", SSN=None, PRIMARY_LANGUAGE="Ukrainian", ARRIVAL_DATE=T(330),
         ADDRESS="484 Main St", CITY="WORCESTER", ZIP="01608", RESETTLEMENT_AGENCY="Ascentria")
    truth["MASSHEALTH"] += [("MASSHEALTH", "MMIS", "100000000005", 5)]
    truth["EHS"] += [("EHS", "ORI_RISIS", "RIS-1000005", 5)]
    # 6. Katherine Walsh: HIX application as "Kate", no SSN, birth month and
    #    day swapped. MassHealth steward decides.
    _row(out, "MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", MEMBER_ID="100000000006", FIRST_NAME="KATHERINE", LAST_NAME="WALSH", MIDDLE_INIT="A",
         DOB="1992-04-07", SEX="F", SSN="022714456", ADDR_LINE1="31 HANCOCK ST", CITY="QUINCY", STATE="MA", ZIP="02169",
         PHONE="6175550128", PRIMARY_LANGUAGE="English", ELIG_CATEGORY="MAGI-ADULT", ENROLL_START=T(1000), RECORD_TS=T(60))
    _row(out, "MASSHEALTH.RAW_BRONZE.HIX_APPLICATION", APPLICATION_ID="A100000006", APPLICANT_FIRST="Kate", APPLICANT_LAST="Walsh",
         DATE_OF_BIRTH="1992-07-04", SSN=None, EMAIL="kwalsh92@example.com", PHONE="(617) 555-0128", HOME_STREET="31 Hancock Street",
         HOME_CITY="Quincy", HOME_ZIP="02169", HOUSEHOLD_SIZE=1, INCOME_FPL_PCT=140, CITIZENSHIP_STATUS="US CITIZEN", SUBMITTED_AT=T(20))
    truth["MASSHEALTH"] += [("MASSHEALTH", "MMIS", "100000000006", 6), ("MASSHEALTH", "HIX", "A100000006", 6)]
    for p in sp.values():
        p["agencies"] = p.pop("_footprint")


def plant_intake_defects(rng, out):
    """Defects the quality gate must catch before matching: placeholder SSNs
    collide and would create false exact matches; blank (whitespace) names
    score 100% under Jaro-Winkler."""
    story_ids = {"100000000001", "100000000002", "100000000003", "100000000004", "100000000005", "100000000006",
                 "A100000001", "A100000002", "A100000003", "A100000006", "1000000001", "1000000004", "EP100000004"}
    for table, idcol, n_ssn, n_blank, name_col in (
            ("MASSHEALTH.RAW_BRONZE.MMIS_MEMBER", "MEMBER_ID", 24, 7, "FIRST_NAME"),
            ("MASSHEALTH.RAW_BRONZE.HIX_APPLICATION", "APPLICATION_ID", 9, 0, None),
            ("DTA.RAW_BRONZE.BEACON_CLIENT", "CLIENT_ID", 14, 5, "LAST_NM"),
            ("BSAS.RAW_BRONZE.ESM_ADMISSION", "EPISODE_ID", 11, 0, None)):
        rows = [r for r in out[table] if r[idcol] not in story_ids and r.get("SSN")]
        for r in rng.sample(rows, n_ssn):
            r["SSN"] = rng.choice(["000000000", "999999999", "123456789"])
        if name_col:
            for r in rng.sample([r for r in out[table] if r[idcol] not in story_ids], n_blank):
                r[name_col] = " "


def generate(seed=42):
    """Returns {"<DB>.<SCHEMA>.<TABLE>": [row dicts]} including REFERENCE.GROUND_TRUTH per agency."""
    rng = random.Random(seed)
    people = make_residents(rng)
    story_people = plant_story_people(people)
    ids = IdGen(rng)
    out = {}
    truth = {a: [] for a in ("MASSHEALTH", "DTA", "BSAS", "EHS")}
    for db, fn in (("MASSHEALTH", gen_masshealth), ("DTA", gen_dta), ("BSAS", gen_bsas)):
        for t, rows in fn(rng, people, ids, truth[db]).items():
            out[f"{db}.{t}"] = rows
    mh_member_of = {}
    for r in truth["MASSHEALTH"]:
        if r[1] == "MMIS":
            mh_member_of.setdefault(r[3], r[2])
    for t, rows in gen_ehs(rng, people, ids, truth["EHS"], mh_member_of).items():
        out[f"EHS.{t}"] = rows
    add_story_rows(out, truth, story_people)
    plant_intake_defects(random.Random(seed + 1), out)
    for db, rows in truth.items():
        out[f"{db}.GOV.GROUND_TRUTH"] = [dict(AGENCY=a, SOURCE_SYSTEM=s, SOURCE_RECORD_ID=i, RESIDENT_ID=r) for a, s, i, r in rows]
    out["EOHHS_HUB.GOV.RESIDENT_TRUTH"] = [dict(RESIDENT_ID=p["rid"], TRUE_FIRST=p["first"], TRUE_LAST=p["last"],
                                                TRUE_DOB=p["dob"].isoformat(), SEX=p["sex"],
                                                AGENCY_FOOTPRINT="|".join(p["agencies"]), N_AGENCIES=len(p["agencies"]),
                                                REFUGEE=p["refugee"], HOMELESS=p["homeless"], INCOME_FPL_PCT=p["income_fpl"])
                                           for p in people]
    return out


if __name__ == "__main__":
    data = generate(42)
    os.makedirs("data", exist_ok=True)
    for name, rows in data.items():
        if not rows:
            continue
        with open(f"data/{name.replace('.', '__')}.csv", "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
            w.writeheader()
            w.writerows(rows)
        print(f"{name:40s} {len(rows):6d}")
