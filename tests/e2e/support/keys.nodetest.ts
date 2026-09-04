/**
 * Tests for the P1 harness additions to `keys.ts`: a second zooid test identity
 * (`testKeys2()`/`NOSTR_TEST2_NSEC`) and a reusable fresh-keypair helper
 * (`freshKeypair()`). Style precedent: `schluesselSperre.nodetest.ts`.
 *
 *   node --test --experimental-strip-types tests/e2e/support/keys.nodetest.ts
 *
 * The environment is always passed explicitly to `gesperrteSchreiber()`/
 * `pruefeTestschluessel()` here, never read from `process.env` — a test that depends on
 * the machine's real `.env` is green or red depending on the machine, which is not a
 * test. `testKeys2()` itself has no explicit-env variant (same as `testKeys()`), so those
 * two cases mutate `process.env.NOSTR_TEST2_NSEC` and restore it in a `finally`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decode } from 'nostr-tools/nip19'
import { freshKeypair, gesperrteSchreiber, testKeys2 } from './keys.ts'
import { pruefeTestschluessel } from './keys.ts'

test('freshKeypair: two calls yield two different keys, not the same pair twice', () => {
    const a = freshKeypair()
    const b = freshKeypair()

    assert.notEqual(Buffer.from(a.sk).toString('hex'), Buffer.from(b.sk).toString('hex'))
    assert.notEqual(a.pk, b.pk)
    assert.notEqual(a.npub, b.npub)
    assert.notEqual(a.nsec, b.nsec)
})

test('freshKeypair: the returned nsec/pk/npub are internally consistent (not independently random)', () => {
    const { sk, pk, npub, nsec } = freshKeypair()

    const decoded = decode(nsec)
    assert.equal(decoded.type, 'nsec')
    assert.deepEqual(decoded.data, sk, 'nsec must decode back to the returned sk')

    const decodedNpub = decode(npub)
    assert.equal(decodedNpub.type, 'npub')
    assert.equal(decodedNpub.data, pk, 'npub must decode back to the returned pk')
})

// ── The naming trap this test file exists to guard against ─────────────────────────
//
// `nsecVariablen()`/`gesperrteSchreiber()` match on `/_NSEC$/` (schluesselSperre.ts). A
// second-identity variable named e.g. `NOSTR_TEST_NSEC2` (suffix AFTER `_NSEC`) would
// silently fall outside that sweep — the production-writer guard would simply never see
// it. `NOSTR_TEST2_NSEC` (digit BEFORE `_NSEC`) does not have that problem. This is
// verified below, not assumed.

test('the second identity variable name is picked up by the *_NSEC sweep automatically', () => {
    const secondIdentity = freshKeypair()
    const primary = freshKeypair()

    const liste = gesperrteSchreiber({
        NOSTR_TEST_NSEC: primary.nsec,
        NOSTR_TEST2_NSEC: secondIdentity.nsec,
    })

    assert.deepEqual(
        liste,
        [{ pk: secondIdentity.pk, quelle: 'NOSTR_TEST2_NSEC' }],
        'gesperrteSchreiber() must list NOSTR_TEST2_NSEC as a comparison entry, sourced purely from the *_NSEC name pattern',
    )
})

test('a WRONG name (digit after _NSEC) would NOT be picked up — this is the trap, made concrete', () => {
    const secondIdentity = freshKeypair()
    const primary = freshKeypair()

    const liste = gesperrteSchreiber({
        NOSTR_TEST_NSEC: primary.nsec,
        // Deliberately the wrong shape, to show the sweep really does depend on the
        // exact suffix and isn't just permissive about any name containing "NSEC".
        NOSTR_TEST_NSEC2: secondIdentity.nsec,
    })

    assert.deepEqual(liste, [], 'a variable not ending in _NSEC must NOT appear in the guard list')
})

test('pruefeTestschluessel: catches a REAL production key placed DIRECTLY in NOSTR_TEST2_NSEC, independent of NOSTR_TEST_NSEC', () => {
    // The gap this test closes: until this fix, pruefeTestschluessel() only ever read
    // TEST_SCHLUESSEL_VARIABLE (NOSTR_TEST_NSEC). A production key landing in
    // NOSTR_TEST2_NSEC while NOSTR_TEST_NSEC stayed an ordinary throwaway was invisible
    // to every guard — the primary key never matched anything, and the second identity
    // was never checked at all. Note this is deliberately NOT the "same key in both
    // variables" case covered above: NOSTR_TEST_NSEC here is an unrelated, harmless
    // key, and the match comes purely from NOSTR_TEST2_NSEC against a genuine
    // production-writer stand-in (NOSTR_BOT_NSEC), same as the existing NOSTR_TEST_NSEC
    // coverage in schluesselSperre.nodetest.ts.
    const bot = freshKeypair() // stands in for a real NOSTR_BOT_NSEC-class production key
    const harmlessPrimary = freshKeypair() // NOSTR_TEST_NSEC — ordinary, unrelated

    assert.throws(
        () =>
            pruefeTestschluessel({
                NOSTR_BOT_NSEC: bot.nsec,
                NOSTR_TEST_NSEC: harmlessPrimary.nsec,
                NOSTR_TEST2_NSEC: bot.nsec,
            }),
        (fehler: Error) => {
            assert.match(fehler.message, /PRODUKTION/)
            // The message must name the identity that actually holds the key (NOSTR_TEST2_NSEC) ...
            assert.match(fehler.message, /NOSTR_TEST2_NSEC/)
            // ... and what it matched against.
            assert.match(fehler.message, /NOSTR_BOT_NSEC/)

            return true
        },
        'reusing the second identity as the primary test key must abort the run, same as any other *_NSEC collision',
    )
})

test('testKeys2: reads NOSTR_TEST2_NSEC from the environment, same shape as testKeys()', () => {
    const generated = freshKeypair()
    const before = process.env.NOSTR_TEST2_NSEC
    process.env.NOSTR_TEST2_NSEC = generated.nsec
    try {
        const result = testKeys2()
        assert.equal(result.pk, generated.pk)
        assert.equal(result.npub, generated.npub)
        assert.deepEqual(result.sk, generated.sk)
    } finally {
        if (before === undefined) {
            delete process.env.NOSTR_TEST2_NSEC
        } else {
            process.env.NOSTR_TEST2_NSEC = before
        }
    }
})

test('testKeys2: throws a clear, named error when NOSTR_TEST2_NSEC is missing', () => {
    const before = process.env.NOSTR_TEST2_NSEC
    delete process.env.NOSTR_TEST2_NSEC
    try {
        assert.throws(() => testKeys2(), /NOSTR_TEST2_NSEC/)
    } finally {
        if (before !== undefined) {
            process.env.NOSTR_TEST2_NSEC = before
        }
    }
})

test('testKeys2: throws when NOSTR_TEST2_NSEC is set but is a VALID bech32 of the wrong type (npub, not nsec)', () => {
    const before = process.env.NOSTR_TEST2_NSEC
    // A well-formed npub (valid checksum) is the case `testKeys2()`'s own type check is
    // for — a malformed/garbled value throws earlier, straight out of `decode()`, same
    // as the pre-existing `testKeys()` it mirrors.
    process.env.NOSTR_TEST2_NSEC = freshKeypair().npub
    try {
        assert.throws(() => testKeys2(), /NOSTR_TEST2_NSEC is not an nsec/)
    } finally {
        if (before === undefined) {
            delete process.env.NOSTR_TEST2_NSEC
        } else {
            process.env.NOSTR_TEST2_NSEC = before
        }
    }
})
