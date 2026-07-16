import { test, expect } from './support/fixtures'
import { getLnUrl, type TrustedEvent, type Zapper } from '@welshman/util'
import { memoedToChatMessage, evictChatMsgCache, type ChatBuildCtx } from '../../packages/einundzwanzig-group/js/feeds'

/**
 * Regression (⚡-Chip verschwand): der ChatMessage-Memo (memoedToChatMessage) schloss den
 * Zapper aus dem Cache-Key aus. Da warmZappers den Zapper fast IMMER erst NACH den 9735-
 * Receipts auflöst, rechnete der erste Compute count 0 (Signer-Check ohne Zapper) und cachte
 * ihn — der spätere zappersByLnurl-Emit traf denselben Key → Cache-Hit auf die 0-Message →
 * Chip erschien nie, auch nicht nach Reload. Fix: Zapper-Ref (gegated auf „hat Receipts") im
 * Key → sobald der Zapper auflöst, bustet er den Eintrag und die Message baut neu (Selbstheilung).
 */

const AUTHOR = 'cc'.repeat(32) // Nachrichtenautor = Zap-Empfänger
const SERVER = 'aa'.repeat(32) // nostrPubkey des LNURL-Servers (signiert das 9735)
const ALICE = 'a1'.repeat(32) // Zapper
const LNURL = getLnUrl('author@example.com') as string // aus lud16 des Autors abgeleitet (deterministisch)

const zapper: Zapper = {
    lnurl: LNURL,
    nostrPubkey: SERVER,
    allowsNostr: true,
    minSendable: 1000,
    maxSendable: 100_000_000,
}

const bolt11For = (msats: number): string => `lnbc${msats / 100}n1restwirdignoriert`

// Leerer Content → parse() liefert keine Nodes → renderAsHtml (DOM/document) wird nie gerufen;
// der Memo-/Zap-Pfad ist DOM-frei im Node-Worker prüfbar (die Zap-Summe hängt nicht am Text).
const EVENT: TrustedEvent = { id: 'msg-1', kind: 9, pubkey: AUTHOR, created_at: 1000, content: '', sig: '', tags: [] } as TrustedEvent

const receipt: TrustedEvent = {
    id: `receipt-${ALICE}`,
    kind: 9735,
    pubkey: SERVER,
    created_at: 0,
    content: '',
    sig: '',
    tags: [
        ['bolt11', bolt11For(21_000)],
        ['description', JSON.stringify({ kind: 9734, pubkey: ALICE, created_at: 0, tags: [['amount', '21000'], ['lnurl', LNURL]], content: '⚡' })],
        ['p', AUTHOR],
        ['e', EVENT.id],
    ],
} as TrustedEvent

const makeCtx = (zappers: Map<string, Zapper>): ChatBuildCtx => ({
    me: null,
    $profiles: new Map([[AUTHOR, { lud16: 'author@example.com' }]]),
    $handles: new Map() as ChatBuildCtx['$handles'],
    $zappers: zappers,
    byId: new Map([[EVENT.id, EVENT]]),
    commentsByRoot: new Map(),
    reactionsByTarget: new Map(),
    pollResponsesByTarget: new Map(),
    zapsByTarget: new Map([[EVENT.id, [receipt]]]),
})

test.describe('memoedToChatMessage — Zapper-Auflösung bustet den Cache', () => {
    test('Receipt vor Zapper: erst count 0 (gecacht), nach Zapper-Load count 1 (kein stale Hit)', () => {
        evictChatMsgCache([EVENT.id]) // Cache für dieses Event sauber

        // 1. Emit: Receipt da, Zapper noch nicht gewärmt → 0 (Signer nicht prüfbar) → wird gecacht.
        const before = memoedToChatMessage(EVENT, makeCtx(new Map()))
        expect(before.zaps.count).toBe(0)

        // 2. Emit: derselbe Receipt, Zapper jetzt aufgelöst → MUSS neu bauen, nicht den 0-Treffer liefern.
        const after = memoedToChatMessage(EVENT, makeCtx(new Map([[LNURL, zapper]])))
        expect(after.zaps.count).toBe(1)
        expect(after.zaps.sats).toBe(21)
    })
})
