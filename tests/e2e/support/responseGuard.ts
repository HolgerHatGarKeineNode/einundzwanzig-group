/**
 * **The response-code guard — makes a 4xx/5xx answer to the browser a test failure.**
 *
 * Pure, like `relayGuard.ts` and `pageErrorGuard.ts` and for the same reason: the wiring
 * to Chromium (`page.on('response')`, contexts, fixture teardown) lives in `fixtures.ts`,
 * the DECISION lives here and is therefore checkable under `node --test` instead of only
 * inside a running Playwright.
 *
 * ── Why a third guard, next to two that already watch the browser ───────────────────
 *
 * Because neither of them can see this. A 500 on an XHR round trip is a REJECTED PROMISE,
 * not a console line and not an uncaught exception: `pageerror` never fires, and the only
 * thing `console` gets is Chromium's own „Failed to load resource:" — which
 * `pageErrorGuard.RAUSCH_MUSTER` filters out. That pattern states its own blind spot in
 * one sentence: a request to a wrong url caused by a real bug would need a network
 * assertion of its own (`page.route` / `page.on('response')`), not a console guard. This
 * file is that assertion. Until it existed, every „the console was clean" measurement in
 * this repository had a blind half.
 *
 * ── What is watched and what is deliberately not ────────────────────────────────────
 *
 * Watched: every response the page RECEIVES with a status of 400 or above, whatever the
 * resource type — a document, a Livewire round trip, an image, a fetch.
 *
 * Not watched: a request that never produced a response. An aborted request
 * (`route.abort`, the way `directory.spec.ts` kills the directory chunk) fires
 * `requestfailed` and never `response`, so a test that deliberately kills a request does
 * not need an allowance for it. That is a property of the browser, not a decision here —
 * but it is the reason the list below is as short as it is.
 *
 * ── Fail-closed ─────────────────────────────────────────────────────────────────────
 *
 * No matching entry in the allowance list ⇒ violation. An empty observation is never a
 * violation: most tests provoke no error status at all.
 */

/** One 4xx/5xx response the browser received. */
export type Response = {
    url: string
    status: number
    /** The HTTP method of the request that earned it — `GET` and `POST` fail differently. */
    method: string
    /** Playwright's own classification (`document`, `xhr`, `fetch`, `image`, …). */
    resourceType: string
}

/**
 * An allowance — BOTH patterns have to match, and that is the same rule the runtime guard
 * carries: a `title` on its own would cover every unrelated error status in the same test,
 * which is exactly the blanket an allowance list must not become.
 *
 * `title` matches `testInfo.titlePath.join(' > ')` (file plus case title, so one pattern
 * cannot free identically named cases in other files), `url` matches the raw response url.
 * `status` is optional and narrows further; omitted, the entry covers any error status on
 * that url.
 */
export type Allowance = {
    title: RegExp
    url: RegExp
    status?: number
    reason: string
}

/** Is this response covered for THIS test? */
export const isAllowed = (response: Response, title: string, list: readonly Allowance[]): boolean =>
    list.some((entry) =>
        entry.title.test(title)
        && entry.url.test(response.url)
        && (entry.status === undefined || entry.status === response.status))

/**
 * The violations among the observed responses — in order, deduplicated by
 * method+status+url.
 *
 * Deduplicated, unlike the runtime guard and like the relay guard: a page that pulls the
 * same missing asset forty times is one fault, and forty identical lines in the message
 * would bury the second, different one.
 */
export const violations = (
    seen: readonly Response[],
    title: string,
    list: readonly Allowance[],
): Response[] => {
    const hits: Response[] = []
    const known = new Set<string>()
    for (const response of seen) {
        const key = `${response.method} ${response.status} ${response.url}`
        if (known.has(key) || isAllowed(response, title, list)) {
            continue
        }
        known.add(key)
        hits.push(response)
    }

    return hits
}

/**
 * The message. Names test, status, method and url of every violation — a guard that only
 * says „failed" costs a debugging round, and that round is more expensive than the guard.
 */
export const responseMessage = (title: string, hits: readonly Response[]): string =>
    [
        'Response guard: this test received an error status from the server.',
        `  Test:      ${title}`,
        '  Responses:',
        ...hits.map((r) => `    ${r.status} ${r.method} ${r.url} [${r.resourceType}]`),
        '',
        '  A 500 on an XHR round trip is a rejected promise: it appears in NO console, so',
        '  neither the runtime guard nor a "the console was clean" measurement can see it.',
        '  If the status is intended (a test that measures an error path), enter it in',
        '  ALLOWANCES in responseGuard.ts — with a test AND a url pattern, otherwise the',
        '  entry also covers unrelated failures in the same test.',
    ].join('\n')

/**
 * ── The allowance list — error statuses this suite produces on purpose ──────────────
 *
 * Measured over the full suite before the guard was armed (2026-09-15, 649 cases,
 * chromium + desktop). Every entry below names the test that provokes it and why the
 * status is the RIGHT answer there.
 *
 * **The Buzz arm has been measured too, and separately** (2026-09-15,
 * `E2E_RELAY=buzz E2E_SLOT_OFFSET=150`, 172 cases, `E2E_RESPONSE_REPORT`): 5 observed
 * error responses, and exactly ONE of them belongs in this list. The other four were the
 * same `/img/msg` 403 on three different cases, and they are NOT allowed here — they were
 * a fixture defect (an empty `__nostrWorkspace` made the CLIENT media guard inert, so a
 * relay-private `/media/` url went to the server image proxy at all). That is repaired at
 * `support/buzz.ts useBuzzAsWorkspace`, where the measurement stands. An allowance would
 * have written „the Buzz arm proxies relay media" down as intended, which it is not.
 */
export const ALLOWANCES: Allowance[] = [
    {
        title: /buzz-moderations-historie\.spec\.ts.*without moderation rights: 403/,
        url: /:\d+\/moderation\/(?:reports|audit)\?/,
        status: 403,
        reason:
            'The 403 IS the subject of that case: a key without moderation rights drives the audit '
            + 'island\'s load path directly and the case asserts the status itself '
            + '(`expect(statuses).toContain(403)`), plus that it raises no toast, no retry storm and '
            + 'no text. Without the status there would be nothing to measure. The url half covers '
            + 'BOTH endpoints because the island asks for both — `reports` and `audit` — while the '
            + 'case only names `audit`; measured in the Buzz arm, both come back 403 for this key.',
    },
    {
        title: /forge-pr-diff\.spec\.ts.*Kostenansage steht VOR dem Download/,
        url: /\/git\/.*info\/refs/,
        status: 404,
        reason:
            'The positive control of that case: after the click a git fetch MUST go out, and the case '
            + 'says in so many words that whether it succeeds is beside the point („Der Download '
            + 'scheitert … das ist gleichgültig"). Measured, it reaches the relay\'s own git endpoint '
            + 'and gets a 404 rather than the dead port the comment there names.',
    },
    {
        title: /forge-readme\.spec\.ts.*abgelehnter Zugriff nennt den GRUND/,
        url: /\/git\/.*info\/refs/,
        status: 401,
        reason:
            'The 401 IS the subject of that case: a refused clone has to name its reason instead of '
            + 'showing „Fehler beim Laden". Without the status there would be nothing to measure.',
    },
    {
        title: /image-proxy-fallback\.spec\.ts/,
        url: /\/img\/(?:avatar|msg|full)\?src=/,
        status: 400,
        reason:
            'The image proxy REFUSING a non-https source is the subject of that whole file — every '
            + 'case feeds it an `http:`/protocol-relative url on purpose and asserts what the surface '
            + 'does instead. The url pattern is the tight half of this entry; the title half is the '
            + 'file, because all eight cases provoke the same refusal by construction.',
    },
    {
        title: /image-proxy-fallback\.spec\.ts/,
        url: /\/img\/(?:avatar|msg|full)\?src=/,
        status: 500,
        reason:
            'The same file stubs the proxy itself to 500 (`page.route`) to reach the raw-fallback '
            + 'branch. The 500 is authored by the test, not by the app.',
    },
    {
        title: /image-proxy-fallback\.spec\.ts/,
        url: /^https:\/\/legit\.example\//,
        status: 500,
        reason:
            'The second half of the same construction: the ORIGINAL is stubbed to 500 as well, which '
            + 'is how the two cases about „the fallback fails too" reach their state.',
    },
    {
        title: /verein-onboarding\.spec\.ts.*Rechnung abgelaufen/,
        url: /\/api\/verein\/payments\/\d+\/refresh$/,
        status: 404,
        reason:
            'The Verein stub (`support/verein.ts`) answers every route it has no handler for with 404 '
            + 'by construction, and this case registers none for `refresh` while the follow-up plan in '
            + '`js/verein.ts` fires one. Intended as far as the case goes — and worth knowing, because '
            + 'it means that path is exercised against a 404 rather than against a modelled answer.',
    },
    {
        title: /response-guard\.spec\.ts.*Standard page: an intentional 404 is observed/,
        url: /selbsttest-response-guard-gibt-es-nicht/,
        status: 404,
        reason:
            'Self-proof of this guard (response-guard.spec.ts): wiring through `page`. Without the '
            + 'entry the proof could not be kept green, which is how proofs disappear from a suite.',
    },
    {
        title: /response-guard\.spec\.ts.*Own context \(browser\.newContext\)/,
        url: /selbsttest-response-guard-gibt-es-nicht/,
        status: 404,
        reason:
            'Self-proof of this guard (response-guard.spec.ts): wiring through a context the test '
            + 'opened itself — the gap a naive `page`-only version would be blind in.',
    },
]
