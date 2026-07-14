import { test, expect } from './support/fixtures'
import { buildAttachment } from '../../packages/einundzwanzig-group/js/uploads'

/**
 * C6a Blossom-Anhang: `buildAttachment` baut URL + NIP-92-`imeta`-Tag aus dem
 * Server-Ergebnis. Reiner Kern (nur `URL`, kein Netzwerk/Store) → Node-testbar.
 */

test('imeta-Tag trägt url/m/x in NIP-92-Form', () => {
    const { url, imetaTag } = buildAttachment('https://blossom.band/abc.webp', 'image/webp', 'deadbeef')
    expect(url).toBe('https://blossom.band/abc.webp')
    expect(imetaTag).toEqual(['imeta', 'url https://blossom.band/abc.webp', 'm image/webp', 'x deadbeef'])
})

test('ergänzt Bild-Endung aus dem MIME, wenn der Pfad nur der Hash ist', () => {
    // Manche Blossom-Server liefern nur /<sha256> ohne Endung — renderMessageLink
    // erkennt Bilder aber nur mit Extension, also anhängen.
    const { url, imetaTag } = buildAttachment('https://cdn.example/deadbeef', 'image/png', 'deadbeef')
    expect(url).toBe('https://cdn.example/deadbeef.png')
    expect(imetaTag[1]).toBe('url https://cdn.example/deadbeef.png')
})

test('Fallback-Endung .webp bei MIME ohne Subtyp', () => {
    const { url } = buildAttachment('https://cdn.example/hash', 'image', 'x')
    expect(url).toBe('https://cdn.example/hash.webp')
})

test('nimmt dim (BxH) ins imeta-Tag auf, wenn übergeben', () => {
    const { imetaTag } = buildAttachment('https://blossom.band/a.webp', 'image/webp', 'x', '800x600')
    expect(imetaTag).toContain('dim 800x600')
})

test('hängt die Endung an den Pfad, NICHT hinter den Query-String', () => {
    // Server-URL mit Query ohne Pfad-Endung: die Endung muss vor den Query, sonst
    // wird der Query-Wert korrupt und das Bild lädt nicht.
    const { url } = buildAttachment('https://cdn.example/deadbeef?token=abc', 'image/png', 'x')
    expect(url).toBe('https://cdn.example/deadbeef.png?token=abc')
})

test('erkennt Endung nur am letzten Pfad-Segment (Punkt im Zwischensegment)', () => {
    const { url } = buildAttachment('https://cdn.example/v1.2/deadbeef', 'image/png', 'x')
    expect(url).toBe('https://cdn.example/v1.2/deadbeef.png')
})

test('normalisiert eingeschleuste Newlines aus der Server-URL', () => {
    // Ein bösartiger Server könnte Whitespace/Newlines liefern → als Fremdtext im
    // publizierten Content. `new URL().href` entfernt sie.
    const { url } = buildAttachment('https://blossom.band/abc.webp\n\nFREMDTEXT', 'image/webp', 'x')
    expect(url).not.toContain('\n')
    expect(url).not.toContain('FREMDTEXT ')
})

test('weist Nicht-http(s)-URLs ab', () => {
    expect(() => buildAttachment('javascript:alert(1)', 'image/png', 'x')).toThrow()
})
