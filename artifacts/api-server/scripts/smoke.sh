#!/usr/bin/env bash
# End-to-end smoke test against a running dev API (requires DATABASE_URL, REPLIT_DEV_DOMAIN).
# Creates a temporary signed-in session for a throwaway operator and removes it afterwards.
set -euo pipefail

BASE="https://${REPLIT_DEV_DOMAIN}/api"
SID="smoke-$(date +%s)-$RANDOM"
USER_ID="smoke-tester"
COOKIE="sid=${SID}"
PASS=0; FAIL=0

cleanup() {
  psql "$DATABASE_URL" -q -c "DELETE FROM sessions WHERE sid = '${SID}';" -c "DELETE FROM operators WHERE user_id = '${USER_ID}';" >/dev/null || true
}
trap cleanup EXIT

psql "$DATABASE_URL" -q -c "INSERT INTO sessions (sid, sess, expire) VALUES ('${SID}', '{\"user\":{\"id\":\"${USER_ID}\",\"email\":\"smoke@example.test\",\"firstName\":\"Smoke\",\"lastName\":\"Tester\",\"profileImageUrl\":null},\"access_token\":\"x\",\"expires_at\":4102444800}', now() + interval '1 hour');" -c "INSERT INTO operators (user_id, email, added_by) VALUES ('${USER_ID}', 'smoke@example.test', 'smoke-test') ON CONFLICT DO NOTHING;" >/dev/null

req() { # method path [json-body] [extra curl args...]
  local method="$1" path="$2" body="${3:-}"; shift 3 || shift $#
  if [ -n "$body" ]; then
    curl -sk -X "$method" "$BASE$path" -H "Cookie: $COOKIE" -H "Content-Type: application/json" -d "$body" -w '\n%{http_code}' "$@"
  else
    curl -sk -X "$method" "$BASE$path" -H "Cookie: $COOKIE" -w '\n%{http_code}' "$@"
  fi
}
check() { # name expected_code actual_output [jq-expr expected]
  local name="$1" want="$2" out="$3" code body
  code="${out##*$'\n'}"; body="${out%$'\n'*}"
  if [ "$code" != "$want" ]; then
    echo "FAIL $name: expected $want got $code: ${body:0:300}"; FAIL=$((FAIL+1)); return
  fi
  if [ -n "${4:-}" ]; then
    local got; got=$(printf '%s' "$body" | jq -r "$4")
    if [ "$got" != "$5" ]; then echo "FAIL $name: $4 = $got (want $5)"; FAIL=$((FAIL+1)); return; fi
  fi
  echo "ok   $name"; PASS=$((PASS+1))
}
body_of() { printf '%s' "${1%$'\n'*}"; }

echo "== auth"
check "unauthenticated is 401" 401 "$(curl -sk "$BASE/overview" -w '\n%{http_code}')" .error.code UNAUTHENTICATED
check "overview as operator" 200 "$(req GET /overview)" .providers.total 1

echo "== providers"
OUT=$(req GET /providers); check "list providers" 200 "$OUT" '.data[0].name' demo-host
PID=$(body_of "$OUT" | jq -r '.data[0].id')
check "demo host online" 200 "$(req GET /providers/$PID)" .status ONLINE
check "connectivity check" 200 "$(req POST /providers/$PID/connectivity-checks)" .ok true
check "discovery" 200 "$(req POST /providers/$PID/discoveries)" .observedCount 7
check "port usage lists 8080" 200 "$(req GET /providers/$PID/port-usage)" '[.used[] | select(.hostPort==8080)] | length' 1
check "unknown provider 404" 404 "$(req GET /providers/does-not-exist)" .error.code NOT_FOUND
check "invalid provider body 422" 422 "$(req POST /providers '{"kind":"DOCKER_HOST"}')" .error.code VALIDATION_ERROR
check "wrong credential kind 422" 422 "$(req POST /providers '{"kind":"ECS_CLUSTER","name":"smoke-ecs","settings":{"region":"us-east-1","clusterArn":"arn:aws:ecs:us-east-1:1:cluster/x"},"credential":{"kind":"SSH_KEY","privateKey":"k"}}')" .error.code VALIDATION_ERROR
OUT=$(req POST /providers '{"kind":"ECS_CLUSTER","name":"smoke-ecs","settings":{"region":"us-east-1","clusterArn":"arn:aws:ecs:us-east-1:1:cluster/x"},"credential":{"kind":"AWS_KEYS","accessKeyId":"AKIA","secretAccessKey":"s"}}')
check "register ECS provider (adapter pending => OFFLINE)" 201 "$OUT" .status OFFLINE
ECS_ID=$(body_of "$OUT" | jq -r .id)
check "credential never returned" 201 "$OUT" '.credential | has("secretAccessKey")' false
check "delete ECS provider" 204 "$(req DELETE /providers/$ECS_ID)"

echo "== workloads"
OUT=$(req GET "/workloads?providerId=$PID"); check "list workloads" 200 "$OUT" .pagination.totalItems 7
wid() { body_of "$OUT" | jq -r ".data[] | select(.name==\"$1\") | .id"; }
NGINX=$(wid edge-nginx); API=$(wid shop-api); REDIS=$(wid shop-redis); PG=$(wid shop-postgres); GRAFANA=$(wid grafana)
check "search filter" 200 "$(req GET "/workloads?search=shop")" .pagination.totalItems 4
check "managed=false filter" 200 "$(req GET "/workloads?managed=false")" .pagination.totalItems 7
check "workload detail" 200 "$(req GET /workloads/$NGINX)" .image nginx:1.27-alpine

echo "== groups"
# clean leftovers from a previous run
for gid in $(body_of "$(req GET /groups)" | jq -r '.data[] | select(.name | startswith("smoke-")) | .id'); do req DELETE /groups/$gid >/dev/null; done
OUT=$(req POST /groups "{\"providerId\":\"$PID\",\"name\":\"smoke-shop\",\"entryPort\":8080,\"members\":[{\"workloadId\":\"$NGINX\",\"role\":\"ENTRY\",\"containerPort\":80,\"serviceName\":\"edge\"},{\"workloadId\":\"$API\",\"containerPort\":3000},{\"workloadId\":\"$PG\",\"role\":\"EXPOSED\",\"containerPort\":5432,\"serviceName\":\"db\"}]}")
check "create group" 201 "$OUT" .status DRAFT
GID=$(body_of "$OUT" | jq -r .id)
check "entry port allocated" 201 "$OUT" '[.allocations[] | select(.hostPort==8080)] | length' 1
check "exposed member got range port" 201 "$OUT" '.members[] | select(.serviceName=="db") | .hostPort >= 20000 and .hostPort <= 20099' true
check "entry allocation linked to member" 201 "$OUT" '.allocations[] | select(.hostPort==8080) | .memberId != null' true
check "duplicate entry port 409" 409 "$(req POST /groups "{\"providerId\":\"$PID\",\"name\":\"smoke-other\",\"entryPort\":8080}")" .error.code PORT_IN_USE
check "duplicate member 422" 422 "$(req POST /groups/$GID/members "{\"workloadId\":\"$API\",\"containerPort\":3000}")" .error.code WORKLOAD_ALREADY_MEMBER
check "second ENTRY 422" 422 "$(req POST /groups/$GID/members "{\"workloadId\":\"$REDIS\",\"role\":\"ENTRY\",\"containerPort\":6379}")" .error.code ENTRY_ALREADY_SET
OUT=$(req POST /groups/$GID/members "{\"workloadId\":\"$REDIS\",\"containerPort\":6379,\"serviceName\":\"cache\"}")
check "add internal member" 201 "$OUT" .hostPort null
REDIS_MEMBER=$(body_of "$OUT" | jq -r .id)
check "provider with groups cannot be deleted" 409 "$(req DELETE /providers/$PID)" .error.code PROVIDER_HAS_GROUPS
check "group ports" 200 "$(req GET /groups/$GID/ports)" '.data | length' 2

echo "== config"
check "reserved key rejected" 422 "$(req PATCH /groups/$GID/config '{"set":[{"key":"SVC_X","value":"1"}]}')" .error.code VALIDATION_ERROR
check "set group config" 200 "$(req PATCH /groups/$GID/config '{"set":[{"key":"LOG_LEVEL","value":"info"},{"key":"DB_PASSWORD","value":"hunter2","isSecret":true}]}')" '[.data[] | select(.key=="DB_PASSWORD") | .value] | .[0]' null
API_MEMBER=$(body_of "$(req GET /groups/$GID)" | jq -r '.members[] | select(.serviceName=="shop-api") | .id')
check "set member config" 200 "$(req PATCH /groups/$GID/members/$API_MEMBER/config '{"set":[{"key":"LOG_LEVEL","value":"debug"}]}')" '.data[0].value' debug
OUT=$(req GET /groups/$GID/members/$API_MEMBER/env)
check "member env rendered" 200 "$OUT" '.entries[] | select(.key=="LOG_LEVEL") | .origin' MEMBER
check "SVC_ injection present" 200 "$OUT" '.entries[] | select(.key=="SVC_DB_PORT") | .value' 5432
check "secret masked in env" 200 "$OUT" '.entries[] | select(.key=="DB_PASSWORD") | .value' null
check "remove config key" 200 "$(req PATCH /groups/$GID/members/$API_MEMBER/config '{"remove":["LOG_LEVEL"]}')" '.data | length' 0

echo "== plan & apply"
OUT=$(req GET /groups/$GID/plan)
check "plan applicable" 200 "$OUT" .applicable true
check "plan has network + member steps" 200 "$OUT" '.steps | length' 5
check "plan warns about nothing" 200 "$OUT" '.warnings | length' 0
check "apply without key 422" 422 "$(req POST /groups/$GID/applies '{}')" .error.code VALIDATION_ERROR
KEY="smoke-$(date +%s%N)"
OUT=$(req POST /groups/$GID/applies '{"reason":"smoke"}' -H "Idempotency-Key: $KEY")
check "apply accepted" 202 "$OUT" .state PENDING
OPID=$(body_of "$OUT" | jq -r .id)
check "replay same key" 200 "$(req POST /groups/$GID/applies '{"reason":"smoke"}' -H "Idempotency-Key: $KEY")" .id "$OPID"
check "same key different body 422" 422 "$(req POST /groups/$GID/applies '{"reason":"different"}' -H "Idempotency-Key: $KEY")" .error.code IDEMPOTENCY_KEY_REUSED
for i in $(seq 1 30); do
  STATE=$(body_of "$(req GET /operations/$OPID)" | jq -r .state)
  [ "$STATE" = "SUCCEEDED" ] || [ "$STATE" = "FAILED" ] || [ "$STATE" = "UNKNOWN" ] && break
  sleep 0.5
done
check "operation succeeded" 200 "$(req GET /operations/$OPID)" .state SUCCEEDED
check "all steps succeeded" 200 "$(req GET /operations/$OPID)" '[.steps[] | select(.state!="SUCCEEDED")] | length' 0
check "group applied" 200 "$(req GET /groups/$GID)" .status APPLIED
check "allocations applied" 200 "$(req GET /groups/$GID)" '[.allocations[] | select(.state=="APPLIED")] | length' 2
check "plan is noop after apply" 200 "$(req GET /groups/$GID/plan)" .isNoop true
check "workload shows membership" 200 "$(req GET /workloads/$NGINX)" .membership.serviceName edge
check "workload now on group network" 200 "$(req GET /workloads/$NGINX)" '.networks | index("berth-smoke-shop") != null' true
check "operations list" 200 "$(req GET "/operations?groupId=$GID")" '.data[0].id' "$OPID"

echo "== drift after a desired-state change"
check "add member after apply" 201 "$(req POST /groups/$GID/members "{\"workloadId\":\"$GRAFANA\",\"containerPort\":3000,\"serviceName\":\"grafana\"}")" .serviceName grafana
check "group drifted" 200 "$(req GET /groups/$GID)" .status DRIFTED
check "drift reasons present" 200 "$(req GET /groups/$GID)" '.driftReasons | length > 0' true

echo "== entry port move"
check "change entry port" 200 "$(req PATCH /groups/$GID '{"entryPort":8090}')" .entryPort 8090
check "old port released" 200 "$(req GET /groups/$GID/ports)" '[.data[] | select(.hostPort==8080)] | length' 0
check "new port held" 200 "$(req GET /groups/$GID/ports)" '[.data[] | select(.hostPort==8090)] | length' 1

echo "== concurrency: 12 parallel claims for one port"
tmp=$(mktemp -d)
for i in $(seq 1 12); do
  (curl -sk -X POST "$BASE/groups" -H "Cookie: $COOKIE" -H "Content-Type: application/json" \
     -d "{\"providerId\":\"$PID\",\"name\":\"smoke-race-$i\",\"entryPort\":9000}" -o /dev/null -w '%{http_code}' > "$tmp/$i") &
done
wait
WINNERS=$(cat "$tmp"/* | grep -o '201' | wc -l | tr -d ' ')
LOSERS=$(cat "$tmp"/* | grep -o '409' | wc -l | tr -d ' ')
if [ "$WINNERS" = "1" ] && [ "$LOSERS" = "11" ]; then echo "ok   exactly one winner ($WINNERS/201, $LOSERS/409)"; PASS=$((PASS+1)); else echo "FAIL race: $WINNERS winners, $LOSERS losers"; FAIL=$((FAIL+1)); fi
rm -rf "$tmp"

echo "== events"
check "events recorded" 200 "$(req GET "/events?groupId=$GID")" '.pagination.totalItems > 5' true
check "no secret values in events" 200 "$(req GET "/events?groupId=$GID&pageSize=200")" '[.data[] | tostring | select(contains("hunter2"))] | length' 0

echo "== cleanup"
check "remove member" 204 "$(req DELETE /groups/$GID/members/$REDIS_MEMBER)"
for gid in $(body_of "$(req GET "/groups?pageSize=200")" | jq -r '.data[] | select(.name | startswith("smoke-")) | .id'); do req DELETE /groups/$gid >/dev/null; done
check "groups removed" 200 "$(req GET /groups)" '[.data[] | select(.name | startswith("smoke-"))] | length' 0
check "ports released" 200 "$(req GET /providers/$PID/port-usage)" '[.used[] | select(.owner=="BERTH")] | length' 0

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" = "0" ]
