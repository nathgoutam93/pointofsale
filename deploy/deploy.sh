#!/usr/bin/env bash
# Deploys an update to the online server: pulls the branch, installs and builds, runs the
# migrations (control schema and every business), restarts the API and waits for it.
#   /opt/pos/deploy/deploy.sh            the checked-out branch
#   /opt/pos/deploy/deploy.sh <branch>   another branch
# Runs as the user that owns /opt/pos (with sudo for systemctl). See README.md.
set -euo pipefail

# All in a function: bash reads a script as it runs it, and the pull below may change this file.
main() {
  local root api branch port
  root="$(cd "$(dirname "$0")/.." && pwd)"
  api="$root/apps/api"
  cd "$root"

  if [[ ! -f "$api/.env" ]]; then
    echo "No $api/.env: set the server up first (README.md, Hosting the online server)." >&2
    exit 1
  fi
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
  # Only what the API needs (and the root's TypeScript): not the desktop app or the web app,
  # which a small server has no memory or disk to spare for.
  pnpm install --frozen-lockfile --filter "@pos/api..." --filter point-of-sale
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
      return 0
    fi
    sleep 1
  done
  echo "The API didn't answer within 30 seconds. Its log: journalctl -u pos-api -n 50" >&2
  exit 1
}

main "$@"
exit
