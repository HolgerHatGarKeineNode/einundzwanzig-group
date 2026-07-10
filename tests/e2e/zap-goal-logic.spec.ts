import { test, expect } from '@playwright/test'
import { ZAP_GOAL, type TrustedEvent } from '@welshman/util'
import { getGoalSummary, getGoalTargetSats, getGoalTitle, goalProgress } from '../../packages/einundzwanzig-group/js/goals'

/**
 * ZAPS.md Z5 JS-Unit (welshman-app-frei): die reine NIP-75-Goal-Logik (kind 9041) —
 * Getter (Titel=content, Details=summary-Tag, Ziel=amount-Tag in Sats) + der
 * Fortschritts-Vergleich gegen das Ziel (pct-Deckelung, reached). Kein Browser.
 */

const goal = (overrides: Partial<TrustedEvent> = {}): TrustedEvent => ({
    id: 'goal-1',
    kind: ZAP_GOAL,
    pubkey: 'cc'.repeat(32),
    created_at: 0,
    content: 'Neuer Beamer für den Space',
    sig: '',
    tags: [
        ['amount', '21000'],
        ['summary', 'Für bessere Vorträge'],
        ['relays', 'wss://relay.example'],
    ],
    ...overrides,
})

test.describe('Goal-Getter (content=Titel, summary/amount-Tags)', () => {
    test('Titel steht im content, nicht in einem Tag', () => {
        expect(getGoalTitle(goal())).toBe('Neuer Beamer für den Space')
    })

    test('Details aus summary-Tag; leer wenn nicht gesetzt', () => {
        expect(getGoalSummary(goal())).toBe('Für bessere Vorträge')
        expect(getGoalSummary(goal({ tags: [['amount', '100']] }))).toBe('')
    })

    test('Ziel aus amount-Tag als rohe Sats; 0 bei fehlend/kaputt/≤0', () => {
        expect(getGoalTargetSats(goal())).toBe(21000)
        expect(getGoalTargetSats(goal({ tags: [] }))).toBe(0)
        expect(getGoalTargetSats(goal({ tags: [['amount', 'abc']] }))).toBe(0)
        expect(getGoalTargetSats(goal({ tags: [['amount', '0']] }))).toBe(0)
        expect(getGoalTargetSats(goal({ tags: [['amount', '-5']] }))).toBe(0)
    })
})

test.describe('goalProgress (Sats gegen Ziel, gedeckelt)', () => {
    test('anteilig, gerundet', () => {
        expect(goalProgress(1000, 250)).toEqual({ pct: 25, reached: false })
        expect(goalProgress(1000, 333)).toEqual({ pct: 33, reached: false })
    })

    test('Ziel erreicht → reached, exakt 100 %', () => {
        expect(goalProgress(1000, 1000)).toEqual({ pct: 100, reached: true })
    })

    test('knapp unter Ziel (99,9 %) → auf 99 gedeckelt, NICHT erreicht (kein falsches 100 %)', () => {
        expect(goalProgress(1000, 999)).toEqual({ pct: 99, reached: false })
    })

    test('Überziel → pct auf 100 gedeckelt, reached bleibt true', () => {
        expect(goalProgress(1000, 5000)).toEqual({ pct: 100, reached: true })
    })

    test('kein Ziel (0) → 0 %, nicht erreicht (Goal ohne amount)', () => {
        expect(goalProgress(0, 500)).toEqual({ pct: 0, reached: false })
    })
})
