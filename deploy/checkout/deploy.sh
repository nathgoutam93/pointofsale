#!/usr/bin/env bash
# Deploys a checkout service update: pulls the branch, installs and builds the service, runs its
# migrations, restarts it and waits for it. Only the checkout service: the POS and other
# products keep running as they are until their own deploy/<product>/deploy.sh.
#   /opt/pos/deploy/checkout/deploy.sh            the checked-out branch
#   /opt/pos/deploy/checkout/deploy.sh <branch>   another branch
# Runs as the user that owns /opt/pos (with sudo for systemctl). See apps/checkout/README.md.
set -euo pipefail

# All in a function: bash reads a script as it runs it, and the pull below may change this file.
main() {
  local root api branch port
  root="$(cd "$(dirname "$0")/../.." && pwd)"
  api="$root/apps/checkout/api"
  cd "$root"

  if [[ ! -f "$api/.env" ]]; then
    echo "No $api/.env: set the service up first (apps/checkout/README.md, Running it on the server)." >&2
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
  # Only what the service needs; other products' installs are left as they are.
  pnpm install --frozen-lockfile --filter "@hackd/checkout-api..." --filter hackd
  pnpm --filter "@hackd/checkout-api^..." build     # what the service uses (packages/*)
  pnpm --filter @hackd/checkout-api prisma:generate
  pnpm --filter @hackd/checkout-api build

  # Before the new version starts: it expects this version's tables. Prisma reads the .env.
  echo "==> Migrating"
  pnpm --filter @hackd/checkout-api migrate

  echo "==> Restarting"
  sudo systemctl restart checkout-api
  port="$(sed -n 's/^PORT=//p' "$api/.env" | tail -n 1)"
  port="${port:-8004}"
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/meta" > /dev/null 2>&1; then
      echo "==> Deployed: the checkout service answers on port $port"
      return 0
    fi
    sleep 1
  done
  echo "The service didn't answer within 30 seconds. Its log: journalctl -u checkout-api -n 50" >&2
  exit 1
}

main "$@"
exit
