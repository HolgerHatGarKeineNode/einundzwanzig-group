#!/usr/bin/env bash
#
# Every test category, one after the other, timed — and the budget as a check.
#
# The rule (user, 2026-10-23): the WHOLE suite — default, browser and the other groups
# together — runs in under 10 minutes. A budget nobody measures is not one; the sum is
# measured here, in one place, serially (two suites at once load each other and invalidate
# both timings).
#
#   composer test:all
#   TEST_BUDGET_SECONDS=300 composer test:all
#
# Categories:
#   default   phpunit.xml          Pest Unit + Feature      php artisan test --parallel
#   browser   phpunit.browser.xml  Pest browser (Chromium)  composer test:browser
#   unit      node:test            npm run build first — the bundle tests measure the BUILT
#                                  artifact and are falsely red against a stale one
#   e2e       Playwright, zooid    npm run test:e2e (6 workers, one serve + relay each)
#   types     phpstan              vendor/bin/phpstan analyse
#
# NOT in here: `npm run test:e2e:buzz` (needs the Docker stack, `E2E_RELAY=buzz`) — it is a
# category of its own and has to be run, and budgeted, on a machine that has the stack.
#
# Exit code: 1 if a category failed or the budget is exceeded.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUDGET="${TEST_BUDGET_SECONDS:-600}"

NAMES=()
CODES=()
SECONDS_TAKEN=()

run_category() { # $1 = name, rest = command
    local name="$1"
    shift
    local started
    started=$(date +%s)
    echo
    echo "━━ ${name}: $*"
    "$@"
    local code=$?
    NAMES+=("${name}")
    CODES+=("${code}")
    SECONDS_TAKEN+=("$(( $(date +%s) - started ))")
}

php artisan config:clear --ansi >/dev/null

run_category default php artisan test --parallel
run_category browser composer test:browser
run_category unit bash -c 'npm run build && npm run test:unit'
run_category e2e npm run test:e2e
run_category types vendor/bin/phpstan analyse --memory-limit=1G --no-progress

total=0
failed=0
echo
echo "━━ categories"
printf '%-9s %-10s %s\n' category result seconds
for i in "${!NAMES[@]}"; do
    if [[ "${CODES[$i]}" == "0" ]]; then
        result=ok
    else
        result="FAILED(${CODES[$i]})"
        failed=1
    fi
    printf '%-9s %-10s %s\n' "${NAMES[$i]}" "${result}" "${SECONDS_TAKEN[$i]}"
    total=$(( total + SECONDS_TAKEN[i] ))
done
printf '%-9s %-10s %s (budget %s)\n' total '' "${total}" "${BUDGET}"

if (( total > BUDGET )); then
    echo "✗ budget exceeded: ${total}s > ${BUDGET}s — optimise, merge or cut before adding tests." >&2
    exit 1
fi

exit "${failed}"
