#!/usr/bin/env bash
# Imports the three LendLoop workflows into the running n8n container and publishes them.
# Re-running is safe: import overwrites workflows with the same id.
set -euo pipefail

CONTAINER="${N8N_CONTAINER:-lendloop-n8n}"

# The error handler goes first so the other two can point at it.
for file in error-handler request-notification overdue-reminders; do
  docker exec "$CONTAINER" n8n import:workflow --input="/workflows/${file}.json"
done
for id in LendLoopErrors01 LendLoopNotify01 LendLoopOverdue1; do
  docker exec "$CONTAINER" n8n publish:workflow --id="$id"
done
docker exec "$CONTAINER" n8n list:workflow
