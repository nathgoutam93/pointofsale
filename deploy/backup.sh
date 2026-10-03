#!/usr/bin/env bash
# Backs up the online server: the whole database (control schema and every business's schema)
# and the uploaded files, into POS_BACKUP_DIR, keeping POS_BACKUP_KEEP_DAYS days; optionally
# copies them off the server with rclone. Run nightly from cron (see README.md).
#
# Reads DATABASE_URL and UPLOADS_DIR from the API's .env (POS_ENV_FILE, default
# /opt/pos/apps/api/.env). Settings, in that file or the environment:
#   POS_BACKUP_DIR            default /var/backups/pos
#   POS_BACKUP_KEEP_DAYS      default 14
#   POS_BACKUP_RCLONE_REMOTE  e.g. oci:pos-backups; empty: no off-server copy
set -euo pipefail

env_file="${POS_ENV_FILE:-/opt/pos/apps/api/.env}"
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
backup_dir="${POS_BACKUP_DIR:-/var/backups/pos}"
keep_days="${POS_BACKUP_KEEP_DAYS:-14}"
uploads_dir="${UPLOADS_DIR:-$(dirname "$env_file")/uploads}"
stamp="$(date -u +%Y%m%d-%H%M%S)"
# Backups hold every business's data: readable by this user only.
umask 077
mkdir -p "$backup_dir"
cd "$backup_dir"
# A failed run leaves no half-written file behind.
trap 'rm -f "$backup_dir/db-$stamp.dump.partial" "$backup_dir/uploads-$stamp.tar.gz.partial"' EXIT

# pg_dump takes the URL without Prisma's ?schema=… and dumps every schema in the database.
db_url="${DATABASE_URL%%\?*}"
pg_dump --format=custom --file="db-$stamp.dump.partial" "$db_url"
mv "db-$stamp.dump.partial" "db-$stamp.dump"
echo "$(date -u +%FT%TZ) db-$stamp.dump $(du -h "db-$stamp.dump" | cut -f1)"

if [[ -d "$uploads_dir" ]]; then
  tar -czf "uploads-$stamp.tar.gz.partial" -C "$(dirname "$uploads_dir")" "$(basename "$uploads_dir")"
  mv "uploads-$stamp.tar.gz.partial" "uploads-$stamp.tar.gz"
  echo "$(date -u +%FT%TZ) uploads-$stamp.tar.gz $(du -h "uploads-$stamp.tar.gz" | cut -f1)"
else
  echo "No uploads folder at $uploads_dir; skipped" >&2
fi

find "$backup_dir" -maxdepth 1 -type f \( -name 'db-*.dump' -o -name 'uploads-*.tar.gz' -o -name '*.partial' \) \
  -mtime +"$keep_days" -delete

if [[ -n "${POS_BACKUP_RCLONE_REMOTE:-}" ]]; then
  rclone copy "$backup_dir" "$POS_BACKUP_RCLONE_REMOTE" --include 'db-*.dump' --include 'uploads-*.tar.gz'
  echo "$(date -u +%FT%TZ) copied to $POS_BACKUP_RCLONE_REMOTE"
fi
