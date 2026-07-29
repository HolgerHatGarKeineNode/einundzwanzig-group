import { test, expect } from './support/fixtures'
import { buildAttachment, relayHttpOrigin, BLOSSOM_SERVER } from '../../packages/einundzwanzig-group/js/uploads'

/**
 * C6a Blossom-Anhang: `buildAttachment` baut URL + NIP-92-`imeta`-Tag aus dem
 * Server-Ergebnis. Reiner Kern (nur `URL`, kein Netzwerk/Store).
 *
 * `size` ist seit P6 Pflicht-Argument: Buzz verlangt `url`, `m`, `x` UND `size`
 * (`imeta.rs:161`) und gleicht die Zahl gegen die gespeicherte Blob-Größe ab. Ein
 * fehlendes `size` war einer der drei Gründe, warum Anhänge dort abgelehnt wurden.
 */

test('imeta-Tag trägt url/m/x/size in NIP-92-Form', () => {
    const { url, imetaTag } = buildAttachment('https://blossom.band/abc.webp', 'image/webp', 'deadbeef', 4711)
    expect(url).toBe('https://blossom.band/abc.webp')
    expect(imetaTag).toEqual([
        'imeta',
        'url https://blossom.band/abc.webp',
        'm image/webp',
        'x deadbeef',
        'size 4711',
    ])
})

test('size steht auf BEIDEN Strecken im Tag, nicht nur bei Buzz', () => {
    // Der Vereins-Blossom stört sich nicht daran (NIP-92 sieht das Feld vor), und ein
    // zweiter Tag-Bau je Relay wäre eine Fehlerquelle mehr.
    const { imetaTag } = buildAttachment(`${BLOSSOM_SERVER}/abc.webp`, 'image/webp', 'x', 12)
    expect(imetaTag).toContain('size 12')
})

test('unbrauchbare Größe wird weggelassen statt gelogen', () => {
    // 0/negativ/NaN lehnt Buzz mit „size must be a positive integer" ab — dann lieber
    // gar kein Feld: ein erfundener Wert scheiterte am Sidecar-Abgleich.
    for (const bad of [0, -5, Number.NaN, 1.5]) {
        const { imetaTag } = buildAttachment('https://cdn.example/a.webp', 'image/webp', 'x', bad)
        expect(imetaTag.some((t) => t.startsWith('size '))).toBe(false)
    }
})

test('relayHttpOrigin macht aus der Relay-URL die Medien-Adresse', () => {
    // Buzz bedient Nostr-WS und Medien-REST auf demselben Port — die Ableitung ist die
    // Adresse selbst, keine Konvention.
    expect(relayHttpOrigin('ws://localhost:3001/')).toBe('http://localhost:3001')
    expect(relayHttpOrigin('wss://relay.example/')).toBe('https://relay.example')
    expect(relayHttpOrigin('wss://relay.example:8443/pfad')).toBe('https://relay.example:8443')
    // Schon http(s) → unverändert (ein Space kann als HTTP-URL konfiguriert sein).
    expect(relayHttpOrigin('https://relay.example/')).toBe('https://relay.example')
})

test('ergänzt Bild-Endung aus dem MIME, wenn der Pfad nur der Hash ist', () => {
    // Manche Blossom-Server liefern nur /<sha256> ohne Endung — renderMessageLink
    // erkennt Bilder aber nur mit Extension, also anhängen.
    const { url, imetaTag } = buildAttachment('https://cdn.example/deadbeef', 'image/png', 'deadbeef', 1)
    expect(url).toBe('https://cdn.example/deadbeef.png')
    expect(imetaTag[1]).toBe('url https://cdn.example/deadbeef.png')
})

test('Fallback-Endung .webp bei MIME ohne Subtyp', () => {
    const { url } = buildAttachment('https://cdn.example/hash', 'image', 'x', 1)
    expect(url).toBe('https://cdn.example/hash.webp')
})

test('nimmt dim (BxH) ins imeta-Tag auf, wenn übergeben', () => {
    const { imetaTag } = buildAttachment('https://blossom.band/a.webp', 'image/webp', 'x', 1, '800x600')
    expect(imetaTag).toContain('dim 800x600')
})

test('hängt die Endung an den Pfad, NICHT hinter den Query-String', () => {
    // Server-URL mit Query ohne Pfad-Endung: die Endung muss vor den Query, sonst
    // wird der Query-Wert korrupt und das Bild lädt nicht.
    const { url } = buildAttachment('https://cdn.example/deadbeef?token=abc', 'image/png', 'x', 1)
    expect(url).toBe('https://cdn.example/deadbeef.png?token=abc')
})

test('erkennt Endung nur am letzten Pfad-Segment (Punkt im Zwischensegment)', () => {
    const { url } = buildAttachment('https://cdn.example/v1.2/deadbeef', 'image/png', 'x', 1)
    expect(url).toBe('https://cdn.example/v1.2/deadbeef.png')
})

test('normalisiert eingeschleuste Newlines aus der Server-URL', () => {
    // Ein bösartiger Server könnte Whitespace/Newlines liefern → als Fremdtext im
    // publizierten Content. `new URL().href` entfernt sie.
    const { url } = buildAttachment('https://blossom.band/abc.webp\n\nFREMDTEXT', 'image/webp', 'x', 1)
    expect(url).not.toContain('\n')
    expect(url).not.toContain('FREMDTEXT ')
})

test('weist Nicht-http(s)-URLs ab', () => {
    expect(() => buildAttachment('javascript:alert(1)', 'image/png', 'x', 1)).toThrow()
})
