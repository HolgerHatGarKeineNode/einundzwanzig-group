import { test, expect, type Page } from './support/fixtures'
import { execFileSync } from 'node:child_process'
import { useZooid, ZOOID_WS } from './support/zooid'
import { loginNsec } from './support/login'
import { publishVerified } from './support/publishVerified'

/**
 * **Der Negativbeweis: auf einem zooid-Space entsteht KEIN Agentenvorschlag.**
 *
 * Headless Buzz-Agenten (kind 10100) sind eine reine Buzz-Sache — auf zooid läuft
 * kein `buzz-acp`, eine Erwähnung dort weckt niemanden. Der Riegel dagegen steht
 * zweifach (`agentDirectory.ts`: kein REQ; `agentDirectoryData.ts
 * agentMentionItems`: leere Liste), und die REGELN dazu decken 20 Pure-Fälle ab:
 *
 *   node --test packages/einundzwanzig-group/js/agentDirectoryData.test.ts
 *
 * Diese Spec deckt etwas anderes, das kein Pure-Test beantworten kann: dass die
 * **Fläche** sich daran hält. Ein zweiter Ladepfad, ein vergessener Aufruf, eine
 * Alpine-Bindung an der falschen Quelle — alles davon ließe die 20 Fälle grün und
 * den Vorschlag trotzdem im DOM erscheinen.
 *
 * ── Warum hier eine Positivkontrolle in DERSELBEN Prüfung steht ────────────────
 *
 * „Kein Agent im Popover" ist auch dann wahr, wenn das Popover gar nicht aufgeht,
 * die Seite nicht lädt oder der Composer fehlt. Eine Abwesenheitsmessung ohne
 * Gegenprobe misst sich selbst. Deshalb gilt in jedem Fall unten zuerst: das
 * Popover geht auf und zeigt einen MENSCHEN. Erst danach zählt die Null.
 *
 * ── Und warum das geseedete 10100 nachgelesen wird ─────────────────────────────
 *
 * Läge es gar nicht am Relay, wäre die Null trivial — der Test bewiese dann nur,
 * dass ein nicht vorhandenes Ereignis keinen Vorschlag erzeugt. `publishVerified`
 * fragt den Relay deshalb erneut, bis das Ereignis wirklich zurückkommt.
 *
 * Determinismus: der Raum ist `welcome` (der Test-User ist dort im Seed schon
 * Mitglied, `zooid-testserver.sh:288`), das Agentenprofil trägt einen
 * Zufallsnamen und `channel_ids: [welcome]` — es ist also für GENAU diesen Raum
 * gedacht. Nichts außer der Relay-Art spricht dagegen, es vorzuschlagen.
 */

const NSEC = process.env.NOSTR_TEST_NSEC as string
const NAK = process.env.NAK ?? `${process.env.HOME}/go/bin/nak`
/** Relay-Owner-Secret (zooid-testserver.sh:280) — darf immer schreiben. */
const ADMIN = 'b2ee09a54bedf17ee1db562bdddd75c48661d981eb52c49dc206c55ba8439414'
const ADMIN_PUB = 'da99fbe39247109327ac8504750d0227d50a8f84049ac8bd2f6c7ad0806ed76d'
const RAUM = 'welcome'
/** kind 10100 = Agenten-Verzeichnisprofil (ersetzbar, NIP-01 10000–19999). */
const AGENT_PROFILE = '10100'

const rnd = (): number => Math.floor(Math.random() * 1e9)

function nak(args: readonly string[], attempts = 3): string {
    let last: unknown
    for (let i = 0; i < attempts; i++) {
        try {
            return execFileSync(NAK, [...args]).toString()
        } catch (error) {
            last = error
            execFileSync('sleep', ['1'])
        }
    }
    throw last
}

type RelayEvent = { id: string; content: string; pubkey: string }

/**
 * Ein 10100 an den zooid-Relay, das nach den Regeln des Clients ein PERFEKTER
 * Kandidat wäre: richtiger Kanal, `respond_to: "anyone"` (also für jeden
 * Betrachter freigegeben), 64-hex-Autor. Nur die Relay-Art spricht dagegen.
 *
 * Der Autor ist ADMIN — ein Pubkey, der im Directory (13534) steht. Damit ist
 * ausgeschlossen, dass die Null nur daran liegt, dass der Client den Autor gar
 * nicht kennt.
 */
function seedAgentProfil(name: string): void {
    const content = JSON.stringify({
        pubkey: ADMIN_PUB,
        name,
        display_name: name,
        agent_type: 'agent',
        channel_ids: [RAUM],
        channels: [RAUM],
        respond_to: 'anyone',
        respond_to_allowlist: [],
        capabilities: [],
        status: 'online',
    })
    const args = ['event', '--auth', '--sec', ADMIN, '-k', AGENT_PROFILE, '-c', content]
    const finde = (): RelayEvent | undefined =>
        nak(['req', '-k', AGENT_PROFILE, '--auth', '--sec', ADMIN, ZOOID_WS])
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l) as RelayEvent)
            .find((e) => e.content.includes(name))
    publishVerified(NAK, args, ZOOID_WS, finde, `Agentenprofil ${name} (kind ${AGENT_PROFILE})`)
}

async function oeffneRaum(page: Page): Promise<void> {
    await useZooid(page)
    await loginNsec(page, NSEC)
    await page.goto(`/rooms/${RAUM}`)
}

/**
 * Das Vorschlags-Popover des RAUM-Composers, über den KONTEXT adressiert.
 *
 * `mentionOpen` ist ein Zustand für beide Composer: bei offenem Popover stehen
 * immer zwei solche Blöcke im DOM, der zweite im ausgeblendeten Thread-Panel.
 * Ein `.first()` traf beim Bau dieser Spec genau den unsichtbaren — der Test
 * meldete „hidden" und sah aus wie ein Produktfehler.
 */
const popover = (page: Page) => page.locator('[data-mention-popover="room"]')

/** Nur die Agenten-Zeilen IM Raum-Popover — das Merkmal setzt `chat-composer.blade.php`. */
const agentZeilen = (page: Page) => page.locator('[data-mention-popover="room"] button[data-agent="true"]')

/**
 * `@`-Popover öffnen und auf einen Treffer warten. `pressSequentially` statt
 * `fill`: `onComposerInput` liest `selectionStart`, und die Vorschlagsliste hängt
 * am Wort VOR dem Cursor — ein in einem Rutsch gesetzter Wert hat schon einen
 * anderen Verlauf hinter sich als echtes Tippen.
 */
async function tippe(page: Page, text: string): Promise<void> {
    const composer = page.getByPlaceholder('Nachricht schreiben…')
    await expect(composer).toBeVisible({ timeout: 20_000 })
    await composer.click()
    await composer.fill('')
    await composer.pressSequentially(text, { delay: 30 })
}

test('zooid: ein perfekt passendes Agentenprofil erzeugt KEINEN Vorschlag — der Mensch daneben schon', async ({
    page,
}) => {
    const agent = `zooidagent${rnd()}`
    seedAgentProfil(agent)

    await oeffneRaum(page)

    // ── Positivkontrolle: das Popover geht überhaupt auf ──────────────────────
    // „Alice Test" ist das kind-0-Profil des Test-Users, der im Seed als
    // Directory-Mitglied steht (zooid-testserver.sh:273/282). Steht sie da, ist
    // bewiesen: Composer da, Directory geladen, Popover offen, Filter greift.
    await tippe(page, '@ali')
    await expect(popover(page).getByText('Alice Test', { exact: false })).toBeVisible({ timeout: 20_000 })
    await expect(agentZeilen(page)).toHaveCount(0)

    // ── Der eigentliche Befund: der Agentenname trifft NICHTS ─────────────────
    // Sein Verzeichniseintrag liegt am Relay (oben nachgelesen), sein Kanal ist
    // dieser Raum, sein `respond_to` ist „anyone". Auf einem Buzz-Space wäre das
    // ein Vorschlag; hier darf gar kein Popover aufgehen.
    await tippe(page, `@${agent}`)
    await expect(agentZeilen(page)).toHaveCount(0)
    await expect(popover(page)).toHaveCount(0)
})

test('zooid: auch die ersten Zeichen des Agentennamens öffnen kein Popover mit Agent', async ({ page }) => {
    // Getrennter Fall, weil `@zooidagent…` als GANZES auch dann nichts fände,
    // wenn der Client die Einträge zwar lädt, aber anders indexiert. Ein Präfix,
    // das sonst breit trifft, schließt das aus.
    const agent = `zooidagent${rnd()}`
    seedAgentProfil(agent)

    await oeffneRaum(page)
    await tippe(page, '@zooid')

    // Positivkontrolle für DIESEN Fall: dass die Fläche lebt, zeigt der Composer
    // mit dem getippten Text — und dass ein anderer Präfix sehr wohl trifft.
    await expect(page.getByPlaceholder('Nachricht schreiben…')).toHaveValue('@zooid')
    await expect(agentZeilen(page)).toHaveCount(0)

    await tippe(page, '@ali')
    await expect(popover(page).getByText('Alice Test', { exact: false })).toBeVisible({ timeout: 20_000 })
})
