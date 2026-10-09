#!/usr/bin/env bash
# Moved to deploy/pos/backup.sh. Kept so cron entries running /opt/pos/deploy/backup.sh still
# back up the POS.
exec "$(dirname "$0")/pos/backup.sh" "$@"
