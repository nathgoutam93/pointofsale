#!/usr/bin/env bash
# Deploys an update to the online server: pulls the branch, installs and builds, runs the
# migrations (control schema and every business), restarts the API and waits for it. With
# apps/web/.env (the web app in a browser, README.md), it then publishes the web app too.
#   /opt/pos/deploy/deploy.sh            the checked-out branch
#   /opt/pos/deploy/deploy.sh <branch>   another branch
# Runs as the user that owns /opt/pos (with sudo for systemctl). See README.md.
set -euo pipefail

# All in a function: bash reads a script as it runs it, and the pull below may change this file.
main() {
  local root api web branch port
  root="$(cd "$(dirname "$0")/.." && pwd)"
  api="$root/apps/api"
  web="$root/apps/web"
  cd "$root"

  if [[ ! -f "$api/.env" ]]; then
    echo "No $api/.env: set the server up first (README.md, Hosting the online server)." >&2
    exit 1
  fi
  if [[ -f "$web/.env" ]]; then check_web "$web"; fi
  if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
    echo "$root has local changes; commit or undo them first:" >&2
    git status --short --untracked-files=no >&2
    exit 1
  fi

  branch="${1:-$(git rev-parse --abbrev-ref HEAD)}"
  echo "==> Pulling $branch"
  git fetch origin "$branch"
  git checkout "$branch"
  git merge --ff-only "origin/$branch"
  echo "    at $(git log -1 --format='%h %s')"

  echo "==> Installing and building"
  # Only what the API needs (and the root's TypeScript), and the web app if this server serves
  # it: never the desktop app, which a small server has no memory or disk to spare for.
  if [[ -f "$web/.env" ]]; then
    pnpm install --frozen-lockfile --filter "@pos/api..." --filter "@pos/web..." --filter point-of-sale
  else
    pnpm install --frozen-lockfile --filter "@pos/api..." --filter point-of-sale
  fi
  pnpm --filter @pos/types --filter @pos/contracts build
  pnpm --filter @pos/api prisma:generate
  pnpm --filter @pos/api build

  # Before the new API starts: it expects this version's tables. Behind PgBouncer, migrations go
  # straight to PostgreSQL: set MIGRATE_DATABASE_URL in the API's .env (see README, step 12).
  echo "==> Migrating"
  migrate_url="$(sed -n 's/^MIGRATE_DATABASE_URL=//p' "$api/.env" | tail -n 1)"
  if [ -n "$migrate_url" ]; then
    (cd "$api" && DATABASE_URL="$migrate_url" node dist/tenancy/cli.js migrate)
  else
    (cd "$api" && node dist/tenancy/cli.js migrate)
  fi

  echo "==> Restarting"
  sudo systemctl restart pos-api
  port="$(sed -n 's/^PORT=//p' "$api/.env" | tail -n 1)"
  port="${port:-3001}"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/meta" > /dev/null 2>&1; then
      echo "==> Deployed: the API answers on port $port"
      # After the API: the new page may need what this version of the API added.
      if [[ -f "$web/.env" ]]; then publish_web "$web"; fi
      return 0
    fi
    sleep 1
  done
  echo "The API didn't answer within 30 seconds. Its log: journalctl -u pos-api -n 50" >&2
  exit 1
}

# Before anything changes: what publishing the web app needs is there.
check_web() {
  local web="$1" target="${POS_WEB_ROOT:-/var/www/pos-web}"
  if ! grep -q '^VITE_API_BASE_URL=.' "$web/.env"; then
    echo "$web/.env has no VITE_API_BASE_URL: the web app wouldn't know where the API is." >&2
    exit 1
  fi
  if [[ ! -d "$target" || ! -w "$target" ]]; then
    echo "$target doesn't exist or isn't writable: create it first (README.md, The web app in a browser)." >&2
    exit 1
  fi
}

# Builds the web app (VITE_API_BASE_URL from apps/web/.env) and puts it where nginx serves it
# (POS_WEB_ROOT, default /var/www/pos-web; deploy/nginx-pos-web.conf). The new built files go in
# next to the old ones, whose names differ, then index.html is swapped in one step: a page open
# from before keeps loading its own files. Built files older than 30 days are deleted.
publish_web() {
  local web="$1" target="${POS_WEB_ROOT:-/var/www/pos-web}"
  echo "==> Building the web app"
  pnpm --filter @pos/web exec vite build
  echo "==> Publishing the web app to $target"
  mkdir -p "$target/assets"
  cp -R "$web/dist/assets/." "$target/assets/"
  # Anything else at the top of the build (index.html last, below).
  find "$web/dist" -mindepth 1 -maxdepth 1 ! -name assets ! -name index.html -exec cp -R {} "$target/" \;
  cp "$web/dist/index.html" "$target/.index.html.new"
  mv -f "$target/.index.html.new" "$target/index.html"
  find "$target/assets" -type f -mtime +30 -delete
}

main "$@"
exit
