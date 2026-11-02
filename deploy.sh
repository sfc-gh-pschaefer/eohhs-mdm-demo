#!/usr/bin/env bash
# Build and deploy one of the two apps from the shared codebase in app/.
# Usage: ./deploy.sh hub|masshealth [connection]
set -euo pipefail
cd "$(dirname "$0")"
TARGET="${1:?hub or masshealth}"; CONN="${2:-${SNOWFLAKE_CONNECTION:-default}}"
case "$TARGET" in
  hub)        NAME=EOHHS_RESIDENT_INDEX; DB=EOHHS_HUB ;;
  masshealth) NAME=MASSHEALTH_MEMBER_INDEX; DB=MASSHEALTH ;;
  *) echo "unknown target $TARGET"; exit 1 ;;
esac
OUT="build/$TARGET"
rm -rf "$OUT"; mkdir -p "$OUT"
rsync -a --exclude node_modules --exclude .next --exclude snowflake.yml app/ "$OUT/"
sed -i '' "/^export const DEPLOYMENT/s/= 'hub';/= '$TARGET';/" "$OUT/lib/deployment.ts"
cat > "$OUT/snowflake.yml" <<YML
definition_version: "2"
entities:
  app:
    type: snowflake-app
    identifier: { name: $NAME, database: $DB, schema: APP }
    artifacts:
      - src: ./*
        dest: ./
        ignore: [node_modules, .next, .env*, .git, "*.log", output, "*.tsbuildinfo"]
    query_warehouse: EOHHS_WH
    code_stage: $DB.APP.CODE_STAGE
YML
cd "$OUT" && snow app deploy -c "$CONN"
