import { test, expect } from './support/fixtures'
import { NIP46_PERMS, nip46PermsAreStale, permsToNip55Json } from '../../packages/einundzwanzig-group/js/nip46-perms'

/**
 * Amber-Stabilität: die NIP-46-Perm-Liste MUSS jeden Kind abdecken, den der Client je
 * signiert — Amber-Default (Policy 1) gewährt sonst nur die gelisteten Kinds vorab und
 * promptet für jeden fehlenden mitten im Flow (Nutzer steckt fest). Dazu die reine
 * Staleness-Entscheidung für den Reconnect-Nudge. welshman-app-frei, kein Browser.
 */

const perms = NIP46_PERMS.split(',')

test.describe('NIP46_PERMS (vollständige Abdeckung)', () => {
    test('deckt alle signierten Kinds ab — inkl. der kritischen 27235 (Login + Admin)', () => {
        // Jeder Kind, den der Client signiert (Kind-Audit). 27235 ist am kritischsten:
        // ohne ihn kein Server-Login-Handoff und kein NIP-86-Relay-Admin.
        //
        // Die Liste war unvollständig und hat damit genau den Bug durchgelassen, den sie
        // fangen soll: 1111 (Thread-Kommentar) fehlte in NIP46_PERMS, der Test fragte ihn
        // nicht ab. Ergänzt wurden 1111 und die Admin-Kinds 9000/9001/9002/9007/9008 —
        // wer hier einen Kind hinzufügt, muss ihn auch in NIP46_PERMS führen.
        const required = [
            0, 5, 7, 9, 1018, 1068, 1111, 1984,
            9000, 9001, 9002, 9005, 9007, 9008, 9021, 9022, 9041, 9734,
            // 10003 (NIP-51 Lesezeichenliste) seit P2 — ohne diese Berechtigung kann ein
            // Amber-Nutzer nichts merken. 30003 steht bewusst NICHT hier: Lesezeichen-Sets
            // werden nur gelesen, dieser Client signiert sie nie.
            10003,
            10009, 22242, 27235, 28934, 28936,
            // 30078 (NIP-78 App-Data) = Lesestand. Publiziert wird er erst in P6 —
            // die Berechtigung muss trotzdem heute schon drinstehen, weil welshman die
            // Rechte einer bestehenden Amber-Verbindung nie nachverhandelt.
            30078,
            // 45002 (Buzz-Forum-Bewertung) seit P3. Buzz-only — aber die Perm-Liste ist
            // relay-unabhängig: sie wird beim KOPPELN einmal ausgehandelt, lange bevor
            // feststeht, welchen Space der Nutzer öffnet, und welshman verhandelt eine
            // bestehende Verbindung nie nach.
            45002,
            // 9042/9043 (Buzz-Timeout und dessen Aufhebung) seit P4 — die einzige
            // Maßnahme gegen eine Person, die diese Oberfläche noch anbietet. Auch hier
            // gilt: Buzz-only, aber die Perm-Liste wird beim KOPPELN ausgehandelt, lange
            // bevor feststeht, welchen Space der Nutzer öffnet.
            9042, 9043,
            // 30300 (NIP-ER, private Erinnerung) seit P5 — wieder Buzz-only, wieder beim
            // KOPPELN ausgehandelt. Der `content` ist NIP-44-Chiffrat an den eigenen
            // Schlüssel; `nip44_encrypt`/`nip44_decrypt` stehen seit der 10009-Space-Liste
            // in NIP46_PERMS und werden vom Fall darunter geprüft. Ohne SIE könnte ein
            // Amber-Nutzer die Erinnerung signieren und danach nie wieder lesen.
            30300,
            // 20001 (Buzz-Praesenz) seit P6 — der einzige Eintrag dieser Liste, der
            // WIEDERKEHREND signiert wird (Herzschlag alle 45 s, solange ein Raum offen
            // ist). Fehlte er, promptete ein Bunker im Minutentakt statt einmal beim
            // Koppeln, und weil bestehende Verbindungen nie nachverhandelt werden, waere
            // die Praesenz fuer frueher gekoppelte Nutzer entweder tot oder eine Lawine.
            20001,
            // 31925 (the NIP-52 answer to a Portal date) since „Ein Eingang" P5 — the ONLY
            // permission that phase added. Without it an Amber user's first „Zusagen" is
            // refused and the surface is dead for them: an existing bunker connection is
            // never renegotiated.
            31925,
        ]
        for (const kind of required) {
            expect(perms, `sign_event:${kind} muss enthalten sein`).toContain(`sign_event:${kind}`)
        }
    })

    test('the list is CHARACTER-IDENTICAL to the one written out here — one change per phase', () => {
        /*
         * ── Why the expected state is written out in full ─────────────────────────────
         *
         * Every change to NIP46_PERMS marks EVERY existing bunker pairing as stale
         * (`nip46PermsAreStale` → reconnect nudge). That is the price, and it is defensible
         * once per release; two additions in one release are two nudges for the same user,
         * and the second one costs the trust the first one still had.
         *
         * The cases above check PRESENCE — they cannot see that a phase added three kinds
         * instead of one. This case can: it compares the complete list in its order.
         * Whoever adds an entry there has to add the same line here, and thereby say
         * expressly that it is the one change of this phase.
         *
         * State: „Ein Eingang" P5 (2026-09-18) — 42 entries, `sign_event:31925` the only
         * addition against P4.
         */
        const erwartet = [
            'nip44_encrypt',
            'nip44_decrypt',
            'sign_event:0',
            'sign_event:5',
            'sign_event:7',
            'sign_event:9',
            'sign_event:1018',
            'sign_event:1068',
            'sign_event:1111',
            'sign_event:1984',
            'sign_event:9000',
            'sign_event:9001',
            'sign_event:9002',
            'sign_event:9005',
            'sign_event:9007',
            'sign_event:9008',
            'sign_event:9021',
            'sign_event:9022',
            'sign_event:9030',
            'sign_event:9031',
            'sign_event:9032',
            'sign_event:9033',
            'sign_event:9040',
            'sign_event:9041',
            'sign_event:9042',
            'sign_event:9043',
            'sign_event:9044',
            'sign_event:9734',
            'sign_event:10003',
            'sign_event:10009',
            'sign_event:20001',
            'sign_event:22242',
            'sign_event:27235',
            'sign_event:28934',
            'sign_event:28936',
            'sign_event:30078',
            'sign_event:30300',
            'sign_event:31925',
            'sign_event:41010',
            'sign_event:41011',
            'sign_event:41012',
            'sign_event:45002',
        ]

        expect(perms).toEqual(erwartet)
        expect(perms.length, 'die Anzahl ist Teil der Zusage').toBe(42)
    })

    test('enthält KEIN sign_event:20002 — der Tipp-Indikator wird nicht geschrieben', () => {
        // Gegenrichtung derselben Zusage: P6 hat 20002 GEMESSEN und ausdruecklich nicht
        // ausgeliefert (Entscheidung 2026-09-03). Ein Recht fuer eine Art, die dieser
        // Client nie signiert, waere eine falsche Angabe in einer Liste, deren Beleg
        // ausdruecklich die Aufrufstelle ist — und die naechste Runde laese es als
        // „gibt es also".
        expect(perms).not.toContain('sign_event:20002')
    })

    test('enthält nip44 encrypt/decrypt, aber kein nip04 (Client nutzt nur nip44)', () => {
        expect(perms).toContain('nip44_encrypt')
        expect(perms).toContain('nip44_decrypt')
        expect(NIP46_PERMS).not.toContain('nip04')
    })

    test('jeder sign_event trägt einen expliziten :kind — Amber verwirft nacktes sign_event', () => {
        const signEntries = perms.filter((p) => p.startsWith('sign_event'))
        expect(signEntries.length).toBeGreaterThan(0)
        for (const entry of signEntries) {
            expect(entry, `"${entry}" muss sign_event:<kind> sein`).toMatch(/^sign_event:\d+$/)
        }
    })

    test('keine Duplikate', () => {
        expect(new Set(perms).size).toBe(perms.length)
    })
})

test.describe('nip46PermsAreStale (Reconnect-Nudge-Entscheidung)', () => {
    test('NIP-46 ohne Merker (bestehende Alt-Verbindung) → stale', () => {
        expect(nip46PermsAreStale('nip46', null)).toBe(true)
    })

    test('NIP-46 mit aktuellem Perms-String → frisch', () => {
        expect(nip46PermsAreStale('nip46', NIP46_PERMS)).toBe(false)
    })

    test('NIP-46 mit veraltetem (unvollständigem) String → stale', () => {
        expect(nip46PermsAreStale('nip46', 'nip44_encrypt,sign_event:9')).toBe(true)
    })

    test('Nsec/NIP-07 sind nie stale (kein Remote-Perm-Modell)', () => {
        expect(nip46PermsAreStale('nip01', null)).toBe(false)
        expect(nip46PermsAreStale('nip07', null)).toBe(false)
        expect(nip46PermsAreStale(undefined, null)).toBe(false)
    })
})

test.describe('permsToNip55Json (Amber NIP-55 permissions-Array)', () => {
    test('sign_event:<kind> → {type,kind}; Methoden ohne kind → nur {type}', () => {
        const json = JSON.parse(permsToNip55Json('sign_event:9,nip44_encrypt,sign_event:27235'))
        expect(json).toContainEqual({ type: 'sign_event', kind: 9 })
        expect(json).toContainEqual({ type: 'sign_event', kind: 27235 })
        expect(json).toContainEqual({ type: 'nip44_encrypt' })
    })

    test('deckt die volle NIP46_PERMS-Liste ab (jeder sign_event mit numerischem kind)', () => {
        const json = JSON.parse(permsToNip55Json(NIP46_PERMS)) as Array<{ type: string; kind?: number }>
        expect(json.length).toBe(NIP46_PERMS.split(',').length)
        for (const p of json) {
            if (p.type === 'sign_event') {
                expect(typeof p.kind).toBe('number')
                expect(Number.isNaN(p.kind)).toBe(false)
            } else {
                expect(p.kind).toBeUndefined()
            }
        }
        // Die kritische 27235 muss als sign_event-Eintrag vorhanden sein.
        expect(json).toContainEqual({ type: 'sign_event', kind: 27235 })
    })
})
