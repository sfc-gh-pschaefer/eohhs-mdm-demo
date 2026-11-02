"""Standard Import JSON for the EOHHS flow diagram: one lane per agency, rolling up to the hub."""
import json

X0, STEP, W, H = 90, 210, 160, 100
LANE, HUB_LANE = 160, 180
FS = "font-size:11px;text-align:center"
FILL = dict(src="#E8EEF6", bronze="#F3DFC9", gate="#FDE7CF", silver="#E5E7EB", t1="#DBEAFE", t2="#EDE3FB",
            t3="#D7F0F5", steward="#DCF2E1", gold="#FCEFC7", app="#14558F")

def html(title, body):
    return f"<p style=\"{FS}\"><b>{title}</b><br>{body}</p>"

AG = [  # name, sources, records, remed, t1, t2c, t2m, t3r, t3m, steward, gold, p, r
    ("MassHealth", "MMIS, HIX, MA-21", 9023, 40, 3754, 286, 34, 88, 17, 45, 5309, "100", "98.2"),
    ("DTA", "BEACON, DTA Connect", 5503, 19, 1811, 368, 26, 298, 65, 196, 3698, "100", "89.5"),
    ("BSAS", "ESM admissions, OTP registry", 3314, 11, 1208, 574, 23, 538, 43, 478, 2191, "100", "70.7"),
    ("EHS", "ORI RISIS, HST broker", 2295, 0, 67, 92, 3, 69, 2, 61, 2223, "100", "43.9"),
]
shapes, lines = [], []
lane_h = [LANE] * 4 + [HUB_LANE]
total_h = sum(lane_h)
shapes.append({"id": "lanes", "type": "swimLanes", "boundingBox": {"x": 0, "y": 0, "w": X0 + 18 * STEP + 20, "h": total_h},
               "vertical": False, "titleBar": {"height": 60, "verticalText": True},
               "lanes": [{"title": a[0], "width": LANE, "headerFill": "#14558F", "laneFill": "#FFFFFF"} for a in AG]
               + [{"title": "EOHHS hub", "width": HUB_LANE, "headerFill": "#0B2E4F", "laneFill": "#F4F8FC"}]})

def box(i, col, top, lh, kind, text, w=W):
    sid = f"s{i}_{col}"
    shapes.append({"id": sid, "type": "rectangle",
                   "boundingBox": {"x": X0 + col * STEP, "y": top + (lh - H) / 2, "w": w, "h": H},
                   "text": text, "style": {"fill": {"type": "color", "color": FILL[kind]},
                                            "stroke": {"color": "#94A3B8", "width": 1, "style": "solid"},
                                            **({"textColor": "#FFFFFF"} if kind == "app" else {})}})
    return sid

def arrow(a, b, dashed=False, p1=(1, 0.5), p2=(0, 0.5), kind="straight", color="#475569"):
    lines.append({"id": f"l{len(lines)}", "lineType": kind,
                  "endpoint1": {"type": "shapeEndpoint", "style": "none", "shapeId": a, "position": {"x": p1[0], "y": p1[1]}},
                  "endpoint2": {"type": "shapeEndpoint", "style": "arrow", "shapeId": b, "position": {"x": p2[0], "y": p2[1]}},
                  "stroke": {"color": color, "width": 2 if not dashed else 2, "style": "dashed" if dashed else "solid"}})

top = 0
golds = []
for i, (name, srcs, rec, remed, t1, t2c, t2m, t3r, t3m, stw, gold, p, r) in enumerate(AG):
    db = name.upper()
    row = [
        box(i, 0, top, LANE, "src", html("Sources", f"{srcs}<br>{rec:,} records")),
        box(i, 1, top, LANE, "bronze", html("RAW_BRONZE", "As received")),
        box(i, 2, top, LANE, "gate", html("DQ gate", f"DMFs + remediation<br>{remed} defects fixed")),
        box(i, 3, top, LANE, "silver", html("INTEGRATION_SILVER", f"{rec:,} standardized")),
        box(i, 4, top, LANE, "t1", html("Tier 1 rules", f"S0-S5 with guards<br>{t1:,} pairs")),
        box(i, 5, top, LANE, "t2", html("Tier 2 ML", f"{t2c:,} scored<br>{t2m} merged")),
        box(i, 6, top, LANE, "t3", html("Tier 3 Cortex AI", f"{t3r:,} reviewed<br>{t3m} merged")),
        box(i, 7, top, LANE, "steward", html("Steward", f"{stw} pairs<br>refresh in seconds")),
        box(i, 8, top, LANE, "gold", html(f"{db}.MASTER_GOLD", f"{gold:,} masters<br>P {p}% R {r}%")),
    ]
    for a, b in zip(row, row[1:]):
        arrow(a, b)
    golds.append(row[-1])
    top += LANE

hub = [
    box(4, 9, top, HUB_LANE, "bronze", html("EOHHS_HUB.RAW_BRONZE", "13,421 agency masters<br>BSAS: tokens only")),
    box(4, 10, top, HUB_LANE, "gate", html("DQ gate", "Checks on what<br>agencies send")),
    box(4, 11, top, HUB_LANE, "silver", html("INTEGRATION_SILVER", "13,421 standardized")),
    box(4, 12, top, HUB_LANE, "t1", html("Tier 1 rules", "S0-S6, 6,425 pairs<br>757 on BSAS tokens")),
    box(4, 13, top, HUB_LANE, "t2", html("Tier 2 ML", "1,051 scored<br>110 merged")),
    box(4, 14, top, HUB_LANE, "t3", html("Tier 3 Cortex AI", "566 reviewed<br>68 merged")),
    box(4, 15, top, HUB_LANE, "steward", html("Steward", "349 pairs<br>refresh in seconds")),
    box(4, 16, top, HUB_LANE, "gold", html("EOHHS_HUB.MASTER_GOLD", "8,162 EOHHS IDs<br>P 100% R 75.5%")),
    box(4, 17, top, HUB_LANE, "app", html("Apps", "Resident Index<br>MassHealth Index")),
]
for a, b in zip(hub, hub[1:]):
    arrow(a, b)
# Roll-up: each agency's gold export drops into the hub's RAW_BRONZE.
for k, g in enumerate(golds):
    arrow(g, hub[0], p2=(0.2 + 0.2 * k, 0), kind="elbow", color="#14558F")

# Writeback note in the open space to the right of the agency lanes.
wb_x, wb_y = X0 + 10 * STEP, 30
shapes.append({"id": "writeback", "type": "rectangle",
               "boundingBox": {"x": wb_x, "y": wb_y, "w": 7 * STEP - 50, "h": 4 * LANE - 60},
               "text": "<p style=\"font-size:13px;text-align:left\"><b>EOHHS ID flows back</b><br><br>"
                       "Hub MASTER_GOLD writes the EOHHS ID into each agency's MASTER_GOLD.EOHHS_ID_MAP:<br>"
                       "MassHealth 5,309 / DTA 3,698 / BSAS 2,191 / EHS 2,223 master records.<br><br>"
                       "MassHealth, DTA and EHS see which other agencies serve a resident, never BSAS.<br>"
                       "BSAS sees the full footprint (42 CFR Part 2).<br><br>"
                       "Hub outputs: AGENCY_OVERLAP, ALERTS (676 SNAP without MassHealth, 597 in treatment without coverage, "
                       "address updates from DTA). Zero false merges in every lane, scored against ground truth.</p>",
               "style": {"fill": {"type": "color", "color": "#FFFBEB"}, "stroke": {"color": "#D97706", "width": 2, "style": "dashed"}}})
arrow(hub[7], "writeback", dashed=True, p1=(0.5, 0), p2=(0.944, 1), color="#D97706")

doc = {"version": 1, "pages": [{"id": "flow", "title": "EOHHS Resident Index flow", "shapes": shapes, "lines": lines}]}
open("eohhs_flow.json", "w").write(json.dumps(doc))
print(len(shapes), "shapes", len(lines), "lines", round(len(json.dumps(doc)) / 1024, 1), "KB")
