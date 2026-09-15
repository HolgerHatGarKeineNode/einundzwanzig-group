/**
 * Pure tests of the response-code guard (Playwright-free).
 *   node --test --experimental-strip-types tests/e2e/support/responseGuard.nodetest.ts
 *
 * Same emphasis as the two guards next to it: what is measured here is the FAILURE
 * DIRECTION. A response without a matching allowance is always a violation, never a quiet
 * exception — and an entry never covers more than the one url in the one test it names.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    ALLOWANCES,
    isAllowed,
    responseMessage,
    violations,
    type Allowance,
    type Response,
} from './responseGuard.ts'

const response = (status: number, url = 'http://127.0.0.1:8137/livewire/update', method = 'POST'): Response => ({
    url,
    status,
    method,
    resourceType: 'xhr',
})

const entry: Allowance = {
    title: /error-path\.spec\.ts.*deleted article/,
    url: /\/articles\/nicht-da/,
    reason: 'test fixture',
}

test('isAllowed: an empty list covers nothing', () => {
    assert.equal(isAllowed(response(500), 'some test', []), false)
})

test('isAllowed: the title alone is not enough — a different url stays a violation', () => {
    assert.equal(isAllowed(response(404, 'http://127.0.0.1:8137/livewire/update'), 'error-path.spec.ts > deleted article', [entry]), false)
})

test('isAllowed: the url alone is not enough — the entry belongs to ITS test', () => {
    assert.equal(isAllowed(response(404, 'http://127.0.0.1:8137/articles/nicht-da'), 'a completely different test', [entry]), false)
})

test('isAllowed: a hit needs title and url together', () => {
    assert.equal(isAllowed(response(404, 'http://127.0.0.1:8137/articles/nicht-da'), 'error-path.spec.ts > deleted article', [entry]), true)
})

test('isAllowed: a `status` narrows the entry and the OTHER status stays a violation', () => {
    const narrow: Allowance = { ...entry, status: 404 }
    const url = 'http://127.0.0.1:8137/articles/nicht-da'
    const title = 'error-path.spec.ts > deleted article'
    assert.equal(isAllowed(response(404, url), title, [narrow]), true)
    // The same url, the same test — but a 500 there is a different fault and stays one.
    assert.equal(isAllowed(response(500, url), title, [narrow]), false)
})

test('violations: the reason this file exists — a 500 on an XHR without an allowance', () => {
    assert.deepEqual(violations([response(500)], 'Dashboard: eine Runde', []), [response(500)])
})

test('violations: no observation is no violation', () => {
    assert.deepEqual(violations([], 'some test', []), [])
})

test('violations: allowed and unallowed responses in the same test are judged apart', () => {
    const allowed = response(404, 'http://127.0.0.1:8137/articles/nicht-da', 'GET')
    const unrelated = response(500)
    const hits = violations([allowed, unrelated], 'error-path.spec.ts > deleted article', [entry])
    assert.deepEqual(hits, [unrelated])
})

test('violations: the same fault forty times is reported once', () => {
    const hits = violations([response(500), response(500), response(500)], 'some test', [])
    assert.equal(hits.length, 1)
})

test('violations: same url, different status ⇒ two findings, not one', () => {
    const url = 'http://127.0.0.1:8137/x'
    const hits = violations([response(500, url), response(419, url)], 'some test', [])
    assert.deepEqual(hits.map((r) => r.status), [500, 419])
})

test('responseMessage: names status, method and url of every violation', () => {
    const text = responseMessage('a > b', [response(500), response(404, 'http://127.0.0.1:8137/x', 'GET')])
    assert.match(text, /500 POST http:\/\/127\.0\.0\.1:8137\/livewire\/update/)
    assert.match(text, /404 GET http:\/\/127\.0\.0\.1:8137\/x/)
    assert.match(text, /ALLOWANCES in responseGuard\.ts/)
})

/**
 * The shipped list itself. Not style policing: an entry whose `url` pattern matched everything would
 * free every error status of its test, which is the blanket the two-pattern rule exists to
 * prevent — and it would do so silently, because the suite stays green either way.
 */
test('ALLOWANCES: every entry names a reason and neither pattern is a blanket', () => {
    for (const allowance of ALLOWANCES) {
        assert.ok(allowance.reason.length > 20, `allowance for ${allowance.url} has no usable reason`)
        assert.ok(allowance.url.source.length > 4, `allowance for ${allowance.title} has a blanket url pattern`)
        assert.ok(allowance.title.source.length > 4, `allowance for ${allowance.url} has a blanket title pattern`)
    }
})
