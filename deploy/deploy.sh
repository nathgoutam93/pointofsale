#!/usr/bin/env bash
# Moved to deploy/pos/deploy.sh (each product deploys with its own deploy/<product>/deploy.sh).
# Kept so /opt/pos/deploy/deploy.sh, as servers and notes have it, still deploys the POS.
exec "$(dirname "$0")/pos/deploy.sh" "$@"
