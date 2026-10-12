#!/usr/bin/env bash
# Backs up the checkout service's database (every session, payment and notice) into
# CHECKOUT_BACKUP_DIR, keeping CHECKOUT_BACKUP_KEEP_DAYS days; optionally copies them off the
# server with rclone. Run nightly from cron (see apps/checkout/README.md, "Backups").
#
# Reads DATABASE_URL from the service's .env (CHECKOUT_ENV_FILE, default
# /opt/pos/apps/checkout/api/.env). Settings, in that file or the environment:
#   CHECKOUT_BACKUP_DIR            default /var/backups/checkout
#   CHECKOUT_BACKUP_KEEP_DAYS      default 30 (payment questions come up weeks later)
#   CHECKOUT_BACKUP_RCLONE_REMOTE  e.g. oci:checkout-backups; empty: no off-server copy
set -euo pipefail

env_file="${CHECKOUT_ENV_FILE:-/opt/pos/apps/checkout/api/.env}"
if [[ ! -r "$env_file" ]]; then
  echo "Can't read $env_file" >&2
  exit 1
fi
# What the environment already sets wins over the file.
while IFS='=' read -r key value || [[ -n "$key" ]]; do
  [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
  [[ -n "${!key+set}" ]] && continue
  value="${value%$'\r'}"
  case "$value" in
    \"*\" | \'*\') value="${value:1:${#value}-2}" ;;
  esac
  export "$key=$value"
done < "$env_file"

: "${DATABASE_URL:?DATABASE_URL is not set in $env_file}"
backup_dir="${CHECKOUT_BACKUP_DIR:-/var/backups/checkout}"
keep_days="${CHECKOUT_BACKUP_KEEP_DAYS:-30}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
# Backups hold payers' emails and every payment: readable by this user only.
umask 077
mkdir -p "$backup_dir"
cd "$backup_dir"
# A failed run leaves no half-written file behind.
trap 'rm -f "$backup_dir/db-$stamp.dump.partial"' EXIT

# pg_dump takes the URL without Prisma's ?schema=….
db_url="${DATABASE_URL%%\?*}"
pg_dump --format=custom --file="db-$stamp.dump.partial" "$db_url"
mv "db-$stamp.dump.partial" "db-$stamp.dump"
echo "$(date -u +%FT%TZ) db-$stamp.dump $(du -h "db-$stamp.dump" | cut -f1)"

find "$backup_dir" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name '*.partial' \) -mtime +"$keep_days" -delete

if [[ -n "${CHECKOUT_BACKUP_RCLONE_REMOTE:-}" ]]; then
  rclone copy "$backup_dir" "$CHECKOUT_BACKUP_RCLONE_REMOTE" --include 'db-*.dump'
  echo "$(date -u +%FT%TZ) copied to $CHECKOUT_BACKUP_RCLONE_REMOTE"
fi
