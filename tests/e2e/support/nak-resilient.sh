#!/usr/bin/env bash
# `nak` with one repair: a `req` that came back EMPTY because its NIP-42 round never ran.
#
# Measured 2026-10-25 against a local zooid with 20 synthetic CPU hogs on the machine: of 120
# `nak req --auth` calls, 2 returned exit 0 and no events, with stderr reading only
# "connecting to localhost:3350... ok." — the authentication line is missing, the query was
# never answered. The same query against a room that is really empty prints
# "authenticating to ws://… as npub…" before it returns nothing. That difference is what this
# wrapper keys on: empty stdout AND no authentication line = the call did not complete, ask
# again (up to 3 attempts, short pauses). A genuinely empty answer that did authenticate is
# returned at once, untouched.
#
# Every other subcommand (`event`, `key`, `decrypt`, …) is exec'd as-is: 120 of 120 publishes
# under the same load printed "success", and a rejection (`restricted:`, `blocked:`) is a
# legitimate answer several specs assert on — retrying it would hide the thing under test.
#
# Wired in by `playwright.config.ts` (it moves the real binary to NAK_REAL and points NAK here)
# and by `zooid-testserver.sh` (its own `nak` function). Fifty spec-local `nak()` helpers read
# `process.env.NAK`, which is why the repair sits at the binary and not in the helpers.
REAL="${NAK_REAL:-$HOME/go/bin/nak}"

sub=""
for a in "$@"; do
    case "$a" in
        -*) ;;
        *) sub="$a"; break ;;
    esac
done

if [ "$sub" != "req" ]; then
    exec "$REAL" "$@"
fi

tmp=$(mktemp -d "${TMPDIR:-/tmp}/nak-req.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

rc=0
for attempt in 1 2 3; do
    if [ "$attempt" = 1 ]; then
        "$REAL" "$@" >"$tmp/out" 2>"$tmp/err"
    else
        # stdin was offered to the first attempt only; a retry must not wait on it.
        "$REAL" "$@" </dev/null >"$tmp/out" 2>"$tmp/err"
    fi
    rc=$?
    if [ -s "$tmp/out" ] || grep -q "authenticating" "$tmp/err"; then
        break
    fi
    [ "$attempt" = 3 ] || sleep "0.$((attempt * 3))"
done

cat "$tmp/out"
cat "$tmp/err" >&2
exit "$rc"
