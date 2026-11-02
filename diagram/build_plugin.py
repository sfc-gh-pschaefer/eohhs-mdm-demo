"""Simple one-page view of the entity resolution plugin workflow."""
import json
W, H, GAP, X0, Y0 = 250, 210, 60, 40, 110
STEPS = [
    ("1. Scope", "/er-scope", "Domain, what an entity is, false-merge risk, data quality rules", "#E8EEF6"),
    ("2. Discover", "/er-discover", "Finds entity tables. Profiler agent scores columns. Outputs a matching plan", "#DBEAFE"),
    ("3. Deploy", "/er-deploy", "Data quality checks, Tier 1 rules, Tier 2 ML, Tier 3 Cortex AI, steward review, golden records", "#FCEFC7"),
    ("4. Deploy app", "/er-deploy-app", "App Runtime web app: scorecard, steward workbench, golden record explorer", "#DCF2E1"),
    ("5. Status", "/er-status", "Pipeline health, match statistics, data quality results", "#EDE3FB"),
]
def txt(sid, x, y, w, h, html, fill="#FFFFFF00", stroke=None, dashed=False):
    st = {"fill": {"type": "color", "color": fill}}
    st["stroke"] = {"color": stroke or "#FFFFFF00", "width": 2 if stroke else 0, "style": "dashed" if dashed else "solid"}
    return {"id": sid, "type": "rectangle", "boundingBox": {"x": x, "y": y, "w": w, "h": h}, "text": html, "style": st}
total_w = 5 * W + 4 * GAP
shapes = [txt("title", X0, 20, total_w, 60,
    "<p style=\"font-size:26px;text-align:left\"><b>Entity resolution plugin for Cortex Code</b></p>"
    "<p style=\"font-size:15px;text-align:left\">A guided conversation from raw tables to a trusted master, all inside Snowflake</p>")]
lines = []
for i, (t, cmd, body, fill) in enumerate(STEPS):
    shapes.append(txt(f"s{i}", X0 + i * (W + GAP), Y0, W, H,
        f"<p style=\"font-size:20px;text-align:center\"><b>{t}</b></p>"
        f"<p style=\"font-size:15px;text-align:center;font-family:Courier\">{cmd}</p><br>"
        f"<p style=\"font-size:14px;text-align:center\">{body}</p>", fill, "#64748B"))
    if i:
        lines.append({"id": f"l{i}", "lineType": "straight",
            "endpoint1": {"type": "shapeEndpoint", "style": "none", "shapeId": f"s{i-1}", "position": {"x": 1, "y": 0.5}},
            "endpoint2": {"type": "shapeEndpoint", "style": "arrow", "shapeId": f"s{i}", "position": {"x": 0, "y": 0.5}},
            "stroke": {"color": "#475569", "width": 3, "style": "solid"}})
shapes.append(txt("sf", X0, Y0 + H + 30, total_w, 50,
    "<p style=\"font-size:16px;text-align:center;color:#FFFFFF\"><b>Runs in the customer's Snowflake account: no data leaves, AI runs in place through Cortex, a steward decides every uncertain match</b></p>",
    "#14558F", "#14558F"))
shapes.append(txt("eohhs", X0 + 2 * (W + GAP), Y0 + H + 110, 3 * W + 2 * GAP, 90,
    "<p style=\"font-size:15px;text-align:left\"><b>Built on top for EOHHS (custom, not in the plugin)</b></p>"
    "<p style=\"font-size:14px;text-align:left\">Cross-agency hub, BSAS token-only sharing, EOHHS ID writeback to each agency, two apps from one codebase</p>",
    "#FFFBEB", "#D97706", dashed=True))
shapes.append(txt("same", X0, Y0 + H + 110, 2 * W + GAP, 90,
    "<p style=\"font-size:15px;text-align:left\"><b>Same pattern for every agency</b></p>"
    "<p style=\"font-size:14px;text-align:left\">MassHealth, DTA, BSAS, EHS each run steps 1 to 5 into their own MASTER_GOLD</p>",
    "#F4F8FC", "#94A3B8"))
json.dump({"version": 1, "pages": [{"id": "p1", "title": "Plugin workflow", "shapes": shapes, "lines": lines}]}, open("plugin.json", "w"))
