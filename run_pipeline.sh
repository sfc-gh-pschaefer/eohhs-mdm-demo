#!/usr/bin/env bash
# Rebuild the EOHHS Commonwealth Resident Index end to end.
#   data -> 4 agency pipelines (parallel) -> hub -> caller grants -> scorecards
# Usage: ./run_pipeline.sh [connection]   (default: $SNOWFLAKE_CONNECTION, else "default")
set -euo pipefail
cd "$(dirname "$0")"
CONN="${1:-${SNOWFLAKE_CONNECTION:-default}}"
mkdir -p logs
python3 generate_data.py > logs/generate.log
python3 render.py > logs/render.log

run() {
  local db=$1 start log
  start=$(date +%s); log="logs/$db.log"
  if ! snow sql -c "$CONN" -f "sql/build/$db.sql" > "$log" 2>&1 || grep -q "Error ─" "$log"; then
    echo "FAILED: $db (see $log)"; grep -A4 "Error ─" "$log" || tail -20 "$log"; return 1
  fi
  echo "ok  $db  ($(( $(date +%s) - start ))s)"
}

pids=()
for db in MASSHEALTH DTA BSAS EHS; do run "$db" & pids+=($!); done
for p in "${pids[@]}"; do wait "$p"; done
run EOHHS_HUB
snow sql -c "$CONN" -f sql/app_grants.sql > logs/app_grants.log 2>&1 && echo "ok  app grants"

snow sql -c "$CONN" -q "
SELECT 'EOHHS_HUB' AS DB, * FROM EOHHS_HUB.GOV.MATCH_QUALITY_SCORECARD UNION ALL
SELECT 'MASSHEALTH', * FROM MASSHEALTH.GOV.MATCH_QUALITY_SCORECARD UNION ALL
SELECT 'DTA', * FROM DTA.GOV.MATCH_QUALITY_SCORECARD UNION ALL
SELECT 'BSAS', * FROM BSAS.GOV.MATCH_QUALITY_SCORECARD UNION ALL
SELECT 'EHS', * FROM EHS.GOV.MATCH_QUALITY_SCORECARD"
