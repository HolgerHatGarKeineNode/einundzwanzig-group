import { test, expect } from '@playwright/test'
import type { TrustedEvent } from '@welshman/util'
import {
    getPollEndsAt,
    getPollOptions,
    getPollResponseSelections,
    getPollResults,
    getPollType,
    isPollClosed,
    isPollShareQuote,
    ownPollSelection,
} from '../../packages/einundzwanzig-group/js/polls'

/**
 * NIP-88-Poll-Logik (C5): Auswahl-Regel (Einfach-/Mehrfachwahl) + Tally. Reiner
 * welshman-app-freier Kern aus `polls.ts` — kein Browser, keine Relay-Runtime.
 */

// Minimales Poll-/Response-Event bauen (nur die Felder, die die Logik liest).
const poll = (tags: string[][]): TrustedEvent =>
    ({ id: 'p', pubkey: 'author', kind: 1068, created_at: 0, tags, content: 'Frage?', sig: '' }) as TrustedEvent

const response = (pubkey: string, created_at: number, responses: string[]): TrustedEvent =>
    ({
        id: `${pubkey}-${created_at}`,
        pubkey,
        kind: 1018,
        created_at,
        tags: [['e', 'p'], ...responses.map((r) => ['response', r])],
        content: '',
        sig: '',
    }) as TrustedEvent

const singlePoll = poll([
    ['option', 'a', 'Apfel'],
    ['option', 'b', 'Birne'],
    ['polltype', 'singlechoice'],
])
const multiPoll = poll([
    ['option', 'a', 'Apfel'],
    ['option', 'b', 'Birne'],
    ['polltype', 'multiplechoice'],
])

test.describe('getPollType / getPollOptions', () => {
    test('Default Einfachwahl, Optionen mit id+label', () => {
        expect(getPollType(poll([['option', 'a', 'Apfel']]))).toBe('singlechoice')
        expect(getPollType(multiPoll)).toBe('multiplechoice')
        expect(getPollOptions(singlePoll)).toEqual([
            { id: 'a', label: 'Apfel' },
            { id: 'b', label: 'Birne' },
        ])
        // label defaultet auf id; id-lose Option fällt raus.
        expect(getPollOptions(poll([['option', 'x'], ['option']]))).toEqual([{ id: 'x', label: 'x' }])
    })
})

test.describe('getPollResponseSelections (Einfach-/Mehrfachwahl-Regel)', () => {
    test('Einfachwahl zählt nur die erste, Mehrfachwahl dedupliziert', () => {
        const r = response('u', 1, ['a', 'b', 'a'])
        expect(getPollResponseSelections(r, 'singlechoice')).toEqual(['a'])
        expect(getPollResponseSelections(r, 'multiplechoice')).toEqual(['a', 'b'])
    })
})

test.describe('getPollResults (Tally)', () => {
    test('Einfachwahl: jüngste Response je Wähler überschreibt', () => {
        const responses = [
            response('u1', 1, ['a']),
            response('u1', 5, ['b']), // u1 wählt um → nur b zählt
            response('u2', 2, ['a']),
        ]
        const { options, voters } = getPollResults(singlePoll, responses)
        expect(voters).toBe(2)
        expect(options.find((o) => o.id === 'a')?.votes).toBe(1)
        expect(options.find((o) => o.id === 'b')?.votes).toBe(1)
    })

    test('Mehrfachwahl: jüngste Response summiert je Option', () => {
        const responses = [
            response('u1', 1, ['a']),
            response('u1', 5, ['a', 'b']), // jüngste zählt: a + b
            response('u2', 2, ['b']),
        ]
        const { options, voters } = getPollResults(multiPoll, responses)
        expect(voters).toBe(2)
        expect(options.find((o) => o.id === 'a')?.votes).toBe(1)
        expect(options.find((o) => o.id === 'b')?.votes).toBe(2)
    })
})

test.describe('getPollEndsAt / isPollClosed', () => {
    test('parst endsAt, ignoriert kaputte Werte; closed nur bei abgelaufenem Ende', () => {
        expect(getPollEndsAt(poll([['endsAt', '1700000000']]))).toBe(1700000000)
        expect(getPollEndsAt(poll([['endsAt', 'kaputt']]))).toBeUndefined()
        expect(getPollEndsAt(poll([]))).toBeUndefined()
        // Ohne endsAt nie geschlossen; Vergangenheit = zu, Zukunft = offen.
        expect(isPollClosed(poll([]))).toBe(false)
        expect(isPollClosed(poll([['endsAt', '1000000000']]))).toBe(true)
        expect(isPollClosed(poll([['endsAt', String(Math.floor(Date.now() / 1000) + 3600)]]))).toBe(false)
    })
})

test.describe('created_at-Tie (begründet den Bump in sendPollResponse)', () => {
    test('gleicher created_at überschreibt NICHT (strikt größer) → erste Response bleibt', () => {
        // Warum sendPollResponse created_at über die vorige eigene Stimme bumpt: bei
        // Gleichstand behält getPollResults die zuerst gesehene → Umwahl in derselben
        // Sekunde ginge sonst verloren.
        const responses = [response('u', 5, ['a']), response('u', 5, ['b'])]
        const { options } = getPollResults(singlePoll, responses)
        expect(options.find((o) => o.id === 'a')?.votes).toBe(1)
        expect(options.find((o) => o.id === 'b')?.votes).toBe(0)
    })
})

test.describe('ownPollSelection', () => {
    test('liefert die jüngste eigene Auswahl (typ-korrekt), sonst leer', () => {
        const responses = [response('me', 1, ['a']), response('me', 9, ['b']), response('other', 3, ['a'])]
        expect(ownPollSelection(singlePoll, responses, 'me')).toEqual(['b'])
        expect(ownPollSelection(singlePoll, responses, null)).toEqual([])
        expect(ownPollSelection(singlePoll, responses, 'nobody')).toEqual([])
    })
})

test.describe('isPollShareQuote (Flotilla-Kompat, verhindert Doppelanzeige)', () => {
    // kind-9-Nachricht mit optionalem q-Tag + freiem Content bauen.
    const msg = (content: string, q?: string): TrustedEvent =>
        ({ id: 'm', pubkey: 'author', kind: 9, created_at: 0, tags: q ? [['q', q]] : [], content, sig: '' }) as TrustedEvent
    const pollIds = new Set(['poll1'])

    test('reine Share-Quote einer bekannten Poll wird ausgeblendet', () => {
        expect(isPollShareQuote(msg('nostr:nevent1abc\n\n', 'poll1'), pollIds)).toBe(true)
    })

    test('normale Nachricht ohne q-Tag bleibt sichtbar', () => {
        expect(isPollShareQuote(msg('Hallo Welt'), pollIds)).toBe(false)
    })

    test('Reply-Zitat auf eine NACHRICHT (q ∉ pollIds) bleibt sichtbar', () => {
        expect(isPollShareQuote(msg('nostr:nevent1abc\n\nAntwort', 'msg42'), pollIds)).toBe(false)
    })

    test('Textzitat AUF eine Poll (eigener Kommentar) bleibt sichtbar', () => {
        expect(isPollShareQuote(msg('nostr:nevent1abc\n\nGuter Punkt!', 'poll1'), pollIds)).toBe(false)
    })
})
