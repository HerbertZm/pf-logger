#!/usr/bin/env bash
#
# CI smoke test — exercises a running pf-logger API end to end against a freshly
# seeded database. Run from the repo root against a server that is already
# listening (see the `smoke` job in .github/workflows/deploy.yml).
#
# Assumes the DB was seeded with:
#   - `npm run db:seed`       → superadmin `admin` / `changeme`
#   - `npm run db:seed-test`  → the `[TEST]` tournament fixture
#
# Env:
#   BASE_URL   API base (default http://127.0.0.1:8080)
#   ADMIN_USER login username (default admin)
#   ADMIN_PASS login password (default changeme)
#
# Exits non-zero on the first failed assertion so the deploy is blocked.

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-changeme}"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1" >&2; exit 1; }

# GET/POST helpers that capture body + HTTP status. Body → stdout, status → $HTTP.
req() {
  local method="$1" path="$2" data="${3:-}" auth="${4:-}"
  local args=(-sS -X "$method" -w '\n%{http_code}' "$BASE_URL$path")
  [ -n "$data" ] && args+=(-H 'Content-Type: application/json' -d "$data")
  [ -n "$auth" ] && args+=(-H "Authorization: Bearer $auth")
  local out; out="$(curl "${args[@]}")"
  HTTP="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

echo "Smoke test → $BASE_URL"

# 1. Public liveness — DB must be reachable.
req GET /api/health
[ "$HTTP" = "200" ] || fail "GET /api/health returned $HTTP (want 200): $BODY"
echo "$BODY" | jq -e '.ok == true and .db == "ok"' >/dev/null \
  || fail "GET /api/health body not healthy: $BODY"
pass "public health ok"

# 2. Unauthenticated request to a protected route is rejected.
req GET /api/tournaments
[ "$HTTP" = "401" ] || fail "GET /api/tournaments without auth returned $HTTP (want 401)"
pass "protected route rejects anonymous"

# 3. Login as the seeded superadmin.
req POST /api/login "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}"
[ "$HTTP" = "200" ] || fail "POST /api/login returned $HTTP (want 200): $BODY"
TOKEN="$(echo "$BODY" | jq -r '.token')"
[ -n "$TOKEN" ] && [ "$TOKEN" != "null" ] || fail "login did not return a token: $BODY"
echo "$BODY" | jq -e '.role == "superadmin"' >/dev/null \
  || fail "seeded admin is not superadmin: $BODY"
pass "login returns token + superadmin role"

# 4. /me echoes the authenticated identity.
req GET /api/me '' "$TOKEN"
[ "$HTTP" = "200" ] || fail "GET /api/me returned $HTTP (want 200): $BODY"
echo "$BODY" | jq -e ".username == \"$ADMIN_USER\"" >/dev/null \
  || fail "GET /api/me wrong user: $BODY"
pass "authenticated /me works"

# 5. Authenticated admin health — verifies workers + PF JWT state are readable
#    (the carry-forward item from plans/phase-2.md §"Carry-forward from Phase 1").
req GET /api/admin/health '' "$TOKEN"
[ "$HTTP" = "200" ] || fail "GET /api/admin/health returned $HTTP (want 200): $BODY"
echo "$BODY" | jq -e '.ok == true and .db == "ok"' >/dev/null \
  || fail "GET /api/admin/health not healthy: $BODY"
pass "authenticated admin health ok"

# 6. The seed-test fixture is visible through the API.
req GET /api/tournaments '' "$TOKEN"
[ "$HTTP" = "200" ] || fail "GET /api/tournaments returned $HTTP (want 200): $BODY"
echo "$BODY" | jq -e 'type == "array" and length >= 1' >/dev/null \
  || fail "GET /api/tournaments did not return a non-empty array: $BODY"
echo "$BODY" | jq -e 'any(.[]; .name | test("\\[TEST\\]"))' >/dev/null \
  || fail "seed-test tournament not found in /api/tournaments: $BODY"
pass "seed-test tournament visible via API"

echo "All smoke assertions passed."
