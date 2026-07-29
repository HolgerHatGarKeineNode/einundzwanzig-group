import { test, expect } from './support/fixtures'
import { useBuzz, BUZZ_USER_NSEC, BUZZ_OWNER_NSEC, BUZZ_OWNER_SEC_HEX, BUZZ_ROOM_WELCOME, BUZZ_PORT } from './support/buzz'
import { loginNsec } from './support/login'
import { spawnSync } from 'node:child_process'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { nsecEncode } from 'nostr-tools/nip19'
import { makeBlossomAuthEvent } from '@welshman/util'
import { buildAttachment, relayHttpOrigin } from '../../packages/einundzwanzig-group/js/uploads'

/** Pfad zum `nak`-Binary (wie in den Seed-Skripten und buzz-admin.spec.ts). */
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
const WS = () => `ws://localhost:${BUZZ_PORT}`

/**
 * Publiziert ein kind-9 mit den übergebenen `-t`-Tags und gibt zurück, was das Relay
 * geantwortet hat. `accepted` liest das `OK`-Ergebnis: nak schreibt bei Ablehnung
 * `failed: msg: <grund>` auf stderr/stdout und liefert keinen Erfolg.
 *
 * Absichtlich KEIN throw bei Ablehnung — die Ablehnung ist hier teils das erwartete
 * Ergebnis (siehe die Fallen-Prüfung unten).
 */
function publish(tags: string[], content: string): { accepted: boolean; detail: string; id: string } {
    const args = ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9', '-t', `h=${BUZZ_ROOM_WELCOME}`]
    for (const t of tags) {
        args.push('-t', t)
    }
    args.push('-c', content, WS())
    // `spawnSync` statt `execFileSync`: nak schreibt den Publish-Status („success" bzw.
    // „failed: msg: …") auf **stderr**, das Event-JSON auf stdout. Wer nur stdout liest,
    // sieht jede Ablehnung als leeres Ergebnis — und einen erfolgreichen Publish auch.
    const res = spawnSync(NAK, args, { encoding: 'utf8', timeout: 30_000 })
    const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
    const id = /"id":"([0-9a-f]{64})"/.exec(out)?.[1] ?? ''
    const failed = /failed: ?(?:msg: ?)?(.*)/.exec(out)?.[1]?.trim() ?? ''
    return { accepted: out.includes('success') && !failed, detail: failed || out.trim(), id }
}

/**
 * P1 (Buzz-Migrationsplan, docs/plans/2026-07-28T1542-buzz-relay-migration.md) — das
 * Buzz-Pendant zu den zooid-E2E-Specs. Läuft NUR mit `E2E_RELAY=buzz` (siehe
 * playwright.config.ts + support/global-setup.ts, das dann den isolierten
 * buzz-test-Docker-Stack statt zooid aufsetzt/seedet). Im Default-Modus (zooid,
 * unverändert) wird diese Datei übersprungen — kein Einfluss auf die bestehende Suite.
 */
test.describe('Buzz-Relay (E2E, nur E2E_RELAY=buzz)', () => {
    test.skip(process.env.E2E_RELAY !== 'buzz', 'nur im Buzz-Modus (E2E_RELAY=buzz) relevant')

    test.beforeEach(async ({ page }) => {
        await useBuzz(page)
    })

    test('Login + Raumliste + Chat lesen/schreiben gegen den Buzz-Test-Stack', async ({ page }) => {
        await loginNsec(page, BUZZ_USER_NSEC)

        // Raumliste (39000, historisches REQ mit EOSE — Buzz pusht 39000 nicht live,
        // aber der Erstladefall ist ein normales REQ, siehe Plan „Belegte Ausgangslage").
        // Auf die RAUM-KACHEL zielen, nicht auf irgendeinen Text: seit die Threading-Tests
        // in denselben Raum schreiben, nennt auch die Threads-Übersicht („# E2E-Welcome"
        // als Herkunft einer Thread-Zeile) diesen Namen — `getByText` traf dann zwei
        // Elemente und der Fall kippte, sobald der Stack NICHT frisch geseedet war.
        await expect(page.getByRole('button', { name: '# E2E-Welcome' })).toBeVisible({ timeout: 15_000 })

        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)

        // Seed-Nachrichten (kind 9, buzz-testserver.sh) lesbar.
        await expect(page.getByText('Hallo aus dem Testraum! 👋')).toBeVisible({ timeout: 15_000 })
        await expect(page.getByText('Antwort vom Owner')).toBeVisible()

        // Fund gegenüber zooid: Relay-Mitgliedschaft (kind 9030) reicht bei einem
        // `visibility=open`-Channel zum LESEN, aber die Insel blendet die Eingabe erst
        // nach explizitem Channel-Join (kind 9021) ein ("Tritt dem Raum bei, um
        // mitzuschreiben."). Idempotent beitreten: schon Mitglied (Re-Run) → kein
        // Beitreten-Button mehr, direkt zur Eingabe.
        const joinButton = page.getByRole('button', { name: 'Beitreten' })
        if (await joinButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
            await joinButton.click()
        }

        // Senden + Live-Empfang (kind 9 → OK true → Rendering, wie im P1-Smoke-Test belegt).
        const marker = `Buzz-E2E-${Math.floor(Math.random() * 1e9)}`
        const input = page.getByRole('textbox').first()
        try {
            await input.waitFor({ state: 'visible', timeout: 15_000 })
        } catch {
            // Der Join (9021) selbst kam serverseitig durch (per nak-Gegenprobe belegt,
            // 39002 listet den User bereits als member) — die Live-Sub der 39002 nach
            // dem Join braucht offenbar länger als 15s. Ein Reload liest den Zustand neu
            // vom Relay statt auf die Live-Sub zu warten.
            await page.reload()
            await input.waitFor({ state: 'visible', timeout: 15_000 })
        }
        await input.fill(marker)
        await page.keyboard.press('Enter')
        await expect(page.getByText(marker)).toBeVisible({ timeout: 10_000 })
    })

    /**
     * **Die Threading-Regeln am echten Relay** — der Gegenpart zu den Client-Prüfungen in
     * `room.spec.ts` (die laufen gegen zooid und belegen, welche Tags der Client ERZEUGT;
     * hier steht, was Buzz damit MACHT).
     *
     * Der wichtigste Satz steht in Schritt 4: **die `root`-only-Form wird angenommen.** Es
     * gibt kein Relay, das den Client vor diesem Fehler bewahrt — kein Reject, kein NOTICE,
     * nur eine Antwort, die niemand je wiederfindet. Genau deshalb ist die Client-Garantie
     * („erzeugt nie `root` ohne `reply`", `js/threading.ts` + `js/threading.test.ts`) die
     * EINZIGE Absicherung, und deshalb steht sie hier als Testfall und nicht als Kommentar.
     *
     * Bewusst ohne Browser: geprüft wird die Relay-Semantik, nicht die Oberfläche. Das macht
     * den Fall schnell und frei von Render-/Live-Sub-Timing.
     */
    test('Threading-Regeln am Relay: reply/root+reply akzeptiert, Verstöße abgelehnt — root-only NICHT', () => {
        const stamp = Math.floor(Math.random() * 1e9)

        // 1) Wurzel.
        const root = publish([], `THREADSPEC-ROOT-${stamp}`)
        expect(root.accepted, `Wurzel abgelehnt: ${root.detail}`).toBe(true)

        // 2) Tiefe 1 — EIN `reply`-Marker. Genau das schreibt der Client.
        const r1 = publish([`e=${root.id};;reply`], `THREADSPEC-R1-${stamp}`)
        expect(r1.accepted, `Antwort auf die Wurzel abgelehnt: ${r1.detail}`).toBe(true)

        // 3) Tiefe 2 — `root` UND `reply`.
        const r2 = publish([`e=${root.id};;root`, `e=${r1.id};;reply`], `THREADSPEC-R2-${stamp}`)
        expect(r2.accepted, `Verschachtelte Antwort abgelehnt: ${r2.detail}`).toBe(true)

        // 4) DIE FALLE: die NIP-10-konforme `root`-only-Form. Buzz nimmt sie an und
        //    verknüpft sie NICHT — kein Fehler, kein Hinweis, nichts. Hier steht sie als
        //    Tatsache fest, damit niemand sie später für „auch erlaubt" hält.
        const trap = publish([`e=${root.id};;root`], `THREADSPEC-TRAP-${stamp}`)
        expect(trap.accepted, 'root-only wird von Buzz ANGENOMMEN — das Relay ist kein Netz').toBe(true)

        // 5) Tiefe 2 OHNE `root`-Tag → harte Ablehnung. Der Beleg, dass Regel 2 keine
        //    Stilfrage ist: liefe der Client hier falsch, verschwände die Antwort mit
        //    einer Fehlermeldung, die der Nutzer nicht einordnen kann.
        const missingRoot = publish([`e=${r1.id};;reply`], `THREADSPEC-NOROOT-${stamp}`)
        expect(missingRoot.accepted).toBe(false)
        expect(missingRoot.detail).toContain('root tag does not match thread ancestry')

        // 6) Antwort auf ein Parent, das das Relay nicht kennt → Ablehnung. Deshalb wartet
        //    `sendThreadReply` auf die Bestätigung der Wurzel, bevor die Antwort rausgeht.
        const orphan = publish([`e=${'1'.repeat(64)};;reply`], `THREADSPEC-ORPHAN-${stamp}`)
        expect(orphan.accepted).toBe(false)
        expect(orphan.detail).toContain('reply parent not found')
    })

    /**
     * **Bild-Anhang gegen Buzz — der ganze Weg**, nicht nur der Tag-Bau: Blob hochladen,
     * Descriptor lesen, `imeta` mit dem ECHTEN Client-Bauer erzeugen, kind 9 publizieren.
     *
     * Drei Dinge standen dem im Weg, jedes für sich ein harter Reject; die Gegenproben
     * halten alle drei fest, damit keins davon unbemerkt zurückfällt:
     *  1. **Ziel-Server.** Buzz nimmt nur Anhänge aus seinem eigenen Medienspeicher an
     *     (`imeta.rs`) — eine Vereins-Blossom-URL ist dort grundsätzlich unbrauchbar.
     *  2. **`size` fehlte** im Client-Tag. Ohne das Feld: harter Reject.
     *  3. **`X-SHA-256`** (BUD-11) war nicht gesetzt — der Upload selbst endete in 401.
     *     Deshalb steht der Upload hier mit im Test und nicht nur der Tag.
     *
     * `makeBlossomAuthEvent` ist unverändert welshmans Helfer: er setzt `["u", …]`,
     * Buzz prüft `["server", …]` nur, wenn vorhanden — die Auth passt ohne Zutun.
     */
    test('Bild-Anhang: Upload + imeta wird angenommen — Fremd-URL und fehlendes size nicht', async () => {
        const stamp = Math.floor(Math.random() * 1e9)
        const server = relayHttpOrigin(WS())
        expect(server).toBe(`http://localhost:${BUZZ_PORT}`)

        // Minimales gültiges WebP (1×1) — Buzz sniffed den Typ, ein Fantasie-Blob fliegt raus.
        const bytes = Uint8Array.from(atob('UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA='), (c) => c.charCodeAt(0))
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

        // Hex → Bytes lokal: `@noble/hashes/utils` ist über die package-exports des Pakets
        // nicht importierbar (Playwright lädt die Spec als ESM in node).
        const sk = Uint8Array.from(BUZZ_OWNER_SEC_HEX.match(/../g)!.map((b) => parseInt(b, 16)))
        const authTemplate = makeBlossomAuthEvent({ action: 'upload', server, hashes: [hash] })
        const authEvent = finalizeEvent({ ...authTemplate, created_at: Math.floor(Date.now() / 1000) }, sk)
        const authHeader = `Nostr ${btoa(JSON.stringify(authEvent))}`

        // Gegenprobe zuerst: OHNE den BUD-11-Header lehnt Buzz den Upload ab (401).
        const withoutHeader = await fetch(`${server}/upload`, {
            method: 'PUT',
            headers: { Authorization: authHeader },
            body: bytes,
        })
        expect(withoutHeader.status, 'ohne X-SHA-256 muss der Upload scheitern').toBe(401)

        const res = await fetch(`${server}/upload`, {
            method: 'PUT',
            headers: { Authorization: authHeader, 'X-SHA-256': hash },
            body: bytes,
        })
        expect(res.status).toBe(200)
        const desc = (await res.json()) as { url: string; sha256: string; size: number; type: string }
        expect(desc.url).toContain(`${server}/media/`)
        expect(desc.sha256).toBe(hash)

        // Der echte Client-Bauer — kein nachgebautes Tag.
        const att = buildAttachment(desc.url, desc.type, desc.sha256, desc.size, '1x1')
        const imetaArg = (tag: string[]) => `imeta=${tag.slice(1).join(';')}`

        const ok = publish([imetaArg(att.imetaTag)], `IMETA-OK-${stamp} ${att.url}`)
        expect(ok.accepted, `Anhang abgelehnt: ${ok.detail}`).toBe(true)

        // Gegenprobe 1: dasselbe Bild, aber als Vereins-Blossom-URL.
        const fremd = ['imeta', `url https://blossom.einundzwanzig.space/${hash}.webp`, `m ${desc.type}`, `x ${hash}`, `size ${desc.size}`]
        const fremdRes = publish([imetaArg(fremd)], `IMETA-FREMD-${stamp}`)
        expect(fremdRes.accepted).toBe(false)
        expect(fremdRes.detail).toContain('imeta url must be a local /media/ path')

        // Gegenprobe 2: der Tag, den der Client bis P6 gebaut hat — ohne `size`.
        const ohneSize = att.imetaTag.filter((t) => !t.startsWith('size '))
        const ohneSizeRes = publish([imetaArg(ohneSize)], `IMETA-NOSIZE-${stamp}`)
        expect(ohneSizeRes.accepted).toBe(false)
        expect(ohneSizeRes.detail).toContain('imeta tag must include url, m, x, and size')
    })

    /**
     * **Beitreten → Composer, OHNE Reload.**
     *
     * Der Beitritt selbst lief immer: das Relay nimmt den 9021 an, `channel_members`
     * bekommt die Zeile und die relay-signierte 39002 führt den Pubkey. Nur sah die
     * Oberfläche das nicht — sie wartete auf die Live-Sub `{kinds:[39002], limit:0}`, und
     * **die liefert bei Buzz nichts**: Gruppen-Events liegen kanal-gescopt und gehen nicht
     * über den globalen Fan-out (`NOSTR.md:124`). Am Relay nachgemessen: 19 s nach einem
     * angenommenen Join kam über die Live-Sub kein einziges Event, ein historisches REQ
     * lieferte die neue Liste sofort. Der Composer erschien deshalb erst nach F5.
     *
     * Der Test fährt bewusst mit einem FRISCHEN Schlüssel, damit der Beitritt echt ist und
     * nicht durch eine Wiederverwendung des Stacks trivial grün wird. `page.reload()` kommt
     * hier absichtlich NICHT vor — genau das ist die Aussage.
     */
    /**
     * **Das Raum-Menü kennt nur noch „Bearbeiten"** — weder „Löschen" noch „Mitglieder",
     * und zwar in KEINER Rolle.
     *
     * Mit zwei Schlüsseln belegt, weil eine Abwesenheit, die nur an einem Schlüssel
     * geprüft wird, auch dann grün wäre, wenn das Menü aus einem ganz anderen Grund
     * leer bliebe: Der erste ist der Eigentümer des Raums (Buzz trägt den Ersteller als
     * `["p","<pk>","","owner"]` in die 39002 ein), der zweite ein Relay-**admin** ohne
     * Eigentum. Beide sehen dasselbe — genau das ist die Aussage. Der Admin-Schlüssel
     * ist nötig, damit das „…"-Menü überhaupt erscheint; sonst prüfte der Fall nur das
     * Admin-Gate.
     *
     * **Das ist ein Schutz gegen Versehen, keine Zugriffskontrolle.** Der Relay lässt jeden
     * Admin weiterhin jeden Raum löschen und Mitglieder setzen; hier fehlen nur die
     * Schaltflächen.
     */
    test('Raum-Menü bietet nur „Bearbeiten" — kein Löschen, keine Mitglieder (zwei Schlüssel)', async ({ page, browser, baseURL }) => {
        const roomName = `OwnerRoom-${Math.floor(Math.random() * 1e9)}`
        const h = crypto.randomUUID()
        // Raum vom OWNER anlegen → Buzz setzt ihn als `owner` der 39002.
        const create = spawnSync(
            NAK,
            ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9007', '-t', `h=${h}`, '-t', `name=${roomName}`, WS()],
            { encoding: 'utf8', timeout: 30_000 },
        )
        expect(`${create.stdout ?? ''}${create.stderr ?? ''}`).toContain('success')

        // Vorbedingung am Relay: die Rolle steht wirklich in der 39002.
        const members = spawnSync(
            NAK,
            ['req', '-k', '39002', '-d', h, '--auth', '--sec', BUZZ_OWNER_SEC_HEX, WS()],
            { encoding: 'utf8', timeout: 20_000 },
        )
        expect(members.stdout, 'Buzz muss den Ersteller als owner führen').toContain('"owner"')

        // 1) Der EIGENTÜMER sieht „Bearbeiten" — und weder Löschen noch Mitglieder.
        await loginNsec(page, BUZZ_OWNER_NSEC)
        const tile = page.locator('div.group', { hasText: roomName })
        await expect(tile).toBeVisible({ timeout: 20_000 })
        await tile.getByRole('button', { name: 'Raum verwalten' }).click()
        await expect(page.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible()
        await expect(page.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0)
        await expect(page.getByRole('menuitem', { name: 'Mitglieder' })).toHaveCount(0)
        await page.keyboard.press('Escape')

        // 2) Zweiter Schlüssel: Relay-ADMIN, aber nicht Eigentümer dieses Raums.
        const sk = generateSecretKey()
        const addAdmin = spawnSync(
            NAK,
            ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${getPublicKey(sk)}`, '-t', 'role=admin', WS()],
            { encoding: 'utf8', timeout: 30_000 },
        )
        expect(`${addAdmin.stdout ?? ''}${addAdmin.stderr ?? ''}`).toContain('success')

        // EIGENER Browser-Kontext für den zweiten Schlüssel: `loginNsec` erwartet das
        // Login-Formular, und die erste Sitzung liegt im localStorage — ein zweiter Login
        // in derselben Seite läuft ins Leere (gemessen: Timeout auf „Andere Optionen",
        // weil die Seite längst auf /spaces stand).
        const ctx = await browser.newContext({ baseURL })
        const page2 = await ctx.newPage()
        await useBuzz(page2)
        await loginNsec(page2, nsecEncode(sk))
        const tileAsAdmin = page2.locator('div.group', { hasText: roomName })
        await expect(tileAsAdmin).toBeVisible({ timeout: 20_000 })
        await tileAsAdmin.getByRole('button', { name: 'Raum verwalten' }).click()
        // Zweiter Schlüssel, gleiches Bild: Menü da (Admin-Gate greift), Löschen fehlt.
        await expect(page2.getByRole('menuitem', { name: 'Bearbeiten' })).toBeVisible()
        await expect(page2.getByRole('menuitem', { name: 'Löschen' })).toHaveCount(0)
        // Und auch hier kein „Mitglieder" — in keiner der beiden Rollen.
        await expect(page2.getByRole('menuitem', { name: 'Mitglieder' })).toHaveCount(0)
        await ctx.close()

        spawnSync(NAK, ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9008', '-t', `h=${h}`, WS()], {
            encoding: 'utf8',
            timeout: 30_000,
        })
    })

    test('Beitreten zeigt den Composer ohne Reload (39002 wird gezielt nachgeladen)', async ({ page }) => {
        const sk = generateSecretKey()
        const pub = getPublicKey(sk)

        // Relay-Mitgliedschaft (9030) durch den Owner — ohne sie darf der Key gar nichts.
        const add = spawnSync(
            NAK,
            ['event', '--auth', '--sec', BUZZ_OWNER_SEC_HEX, '-k', '9030', '-t', `p=${pub}`, '-t', 'role=member', WS()],
            { encoding: 'utf8', timeout: 30_000 },
        )
        expect(`${add.stdout ?? ''}${add.stderr ?? ''}`, 'Relay-Mitgliedschaft konnte nicht gesetzt werden').toContain('success')

        await loginNsec(page, nsecEncode(sk))
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)

        // Vorbedingung: dieser Schlüssel ist noch KEIN Raum-Mitglied.
        const joinButton = page.getByRole('button', { name: 'Beitreten' })
        await expect(joinButton, 'frischer Schlüssel muss erst beitreten müssen').toBeVisible({ timeout: 20_000 })

        await joinButton.click()

        // Die eigentliche Zusage: der Composer erscheint, ohne dass jemand neu lädt.
        await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 20_000 })
        await expect(joinButton).toBeHidden()

        // Und der Rueckweg, im selben Fall: Buzz schickt die aktualisierte 39002 auch
        // nach dem Austritt nicht ueber den Fan-out. Ohne das gespiegelte Nachladen
        // bliebe der Composer stehen, obwohl der Nutzer draussen ist — der naechste
        // Sendeversuch scheiterte dann am Relay, ohne dass die Oberflaeche es andeutet.
        await page.getByRole('button', { name: 'Raum verlassen' }).click()
        await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeHidden({ timeout: 20_000 })
        await expect(joinButton).toBeVisible()
    })

    /**
     * Kein NIP-86 gegen Buzz — der Regressionstest zu einem Bug, den erst das
     * Browser-Log des Nutzers sichtbar gemacht hat (2026-07-29).
     *
     * `deriveUserIsSpaceAdmin` schützte den Probe-Aufruf mit der SYNCHRONEN
     * `spaceIsBuzz`. Die liefert beim ersten Rendern aber immer `false` — das
     * NIP-11-Doc ist da noch unterwegs, sie stößt das Laden nur an. Also feuerte
     * der Aufruf doch, Buzz quittierte mit `405 Method Not Allowed`, und der
     * Nutzer bekam bei JEDEM Seitenaufbau eine Signatur-Anfrage für ein
     * NIP-98-Event, das niemand auswertet.
     *
     * Der Test hängt am Netzwerkverkehr statt an einer Store-Zusicherung: was
     * zählt, ist dass nichts rausgeht — nicht, wie der Client intern entscheidet.
     */
    test('kein NIP-86-Management-Request gegen Buzz (kein 405, keine Signatur-Anfrage)', async ({ page }) => {
        const posts: string[] = []
        page.on('request', (req) => {
            if (req.method() === 'POST' && req.url().includes(`:${BUZZ_PORT}`)) {
                posts.push(req.url())
            }
        })

        await loginNsec(page, BUZZ_USER_NSEC)
        await page.goto(`/rooms/${BUZZ_ROOM_WELCOME}`)
        await expect(page.getByPlaceholder('Nachricht schreiben…')).toBeVisible({ timeout: 15_000 })
        // Der Probe-Aufruf hing an der Admin-Ableitung beim Seitenaufbau; nach dem
        // ersten Paint ist er entweder passiert oder er passiert nicht mehr.
        await page.waitForTimeout(2_000)

        expect(posts, `NIP-86-Request(s) an Buzz gegangen: ${posts.join(', ')}`).toHaveLength(0)
    })
})
