import { test, expect } from './support/fixtures'
import { createLightboxZoom, type LightboxZoomState } from '../../packages/einundzwanzig-group/js/lightbox'

/**
 * Lightbox-Zoom-Kern (Pinch/Wheel/Doppeltipp): reine Transform-Mathematik + Pointer-
 * Buchhaltung, `createLightboxZoom()` liefert ein reines Objekt → Node-testbar, kein
 * Browser nötig. `$refs.img`/`window` werden minimal gefaked (nur die Felder, die die
 * Methoden lesen: offsetWidth/offsetHeight, innerWidth/innerHeight).
 */

// `stageCenter()`/`clampPan()` lesen `window.innerWidth/innerHeight` direkt — die reine
// Node-Umgebung dieser Datei kennt kein `window`, also EINMAL für die ganze Datei setzen
// (1000×800 reicht für alle Fälle unten; kein Test verlässt sich auf eine andere Größe).
;(globalThis as unknown as { window: { innerWidth: number; innerHeight: number } }).window = { innerWidth: 1000, innerHeight: 800 }

type FakeImg = { offsetWidth: number; offsetHeight: number }

/** Frische State-Instanz + gefakte Bildmaße (`$refs.img`, von `clampPan()` gelesen). */
function makeState(imgW = 800, imgH = 600): LightboxZoomState {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Object.assign(createLightboxZoom(), { $refs: { img: { offsetWidth: imgW, offsetHeight: imgH } as FakeImg } }) as any
}

/** Minimaler PointerEvent-Stand-in: nur die Felder, die `on Pointer*` liest. */
function fakePointer(pointerId: number, clientX: number, clientY: number, extra: Record<string, unknown> = {}): PointerEvent {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { pointerId, clientX, clientY, currentTarget: {}, pointerType: 'touch', ...extra } as any
}

/** Minimaler WheelEvent-Stand-in inkl. `preventDefault`-Spion. */
function fakeWheel(props: { deltaY: number; deltaMode?: number; ctrlKey?: boolean; clientX?: number; clientY?: number }) {
    let prevented = false
    const event = {
        deltaY: props.deltaY,
        deltaMode: props.deltaMode ?? 0,
        ctrlKey: props.ctrlKey ?? false,
        clientX: props.clientX ?? 500,
        clientY: props.clientY ?? 400,
        preventDefault: () => {
            prevented = true
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any
    return { event: event as WheelEvent, wasPrevented: () => prevented }
}

test.describe('zoomTo', () => {
    test('hält den Fokuspunkt unter dem Cursor ortsfest (konkret nachgerechnet)', () => {
        // Ausgangslage: bereits leicht gezoomt+verschoben (scale=2, x=-40, y=20), Zoom auf
        // next=4 mit Cursor bei (650,350). Bühnenmitte bei 1000×800 = (500,400).
        // Formel aus dem Kommentar in lightbox.ts: translate' = (s-c) - k·((s-c)-translate).
        const s = makeState()
        s.scale = 2
        s.x = -40
        s.y = 20
        s.zoomTo(4, 650, 350, false)

        expect(s.scale).toBe(4)
        expect(s.x).toBeCloseTo(-230, 10)
        expect(s.y).toBeCloseTo(90, 10)

        // Invariante unabhängig nachgerechnet: der Bildpunkt unter dem Cursor
        // (`p = (screen - center - translate) / scale`) muss vor UND nach dem Zoom gleich sein.
        const pBefore = { x: (650 - 500 - -40) / 2, y: (350 - 400 - 20) / 2 }
        const pAfter = { x: (650 - 500 - s.x) / s.scale, y: (350 - 400 - s.y) / s.scale }
        expect(pAfter.x).toBeCloseTo(pBefore.x, 10)
        expect(pAfter.y).toBeCloseTo(pBefore.y, 10)
    })

    test('klemmt auf MIN_SCALE=1 / MAX_SCALE=6', () => {
        const low = makeState()
        low.zoomTo(0.1, 500, 400, false)
        expect(low.scale).toBe(1)

        const high = makeState()
        high.zoomTo(50, 500, 400, false)
        expect(high.scale).toBe(6)
    })

    test('setzt x/y hart auf 0, sobald das Ziel ≤ MIN_SCALE ist', () => {
        const s = makeState()
        s.scale = 2
        s.x = 77
        s.y = -33
        s.zoomTo(1, 500, 400, true)
        expect(s.scale).toBe(1)
        expect(s.x).toBe(0)
        expect(s.y).toBe(0)

        // Auch wenn das Ziel selbst schon UNTER MIN_SCALE liegt (und erst auf 1 geklemmt wird).
        const s2 = makeState()
        s2.scale = 2
        s2.x = 77
        s2.y = -33
        s2.zoomTo(0.3, 500, 400, true)
        expect(s2.scale).toBe(1)
        expect(s2.x).toBe(0)
        expect(s2.y).toBe(0)
    })
})

test.describe('clampPan', () => {
    test('bei scale=1 mit Bild kleiner als Viewport bleibt maxX/maxY = 0', () => {
        const s = makeState(400, 300) // 400×300-Bild in einem 1000×800-Viewport
        s.scale = 1
        s.x = 500
        s.y = 500
        s.clampPan()
        expect(s.x).toBe(0)
        expect(s.y).toBe(0)
    })

    test('schiebt nie über den Rand hinaus (Bild größer als Viewport, gezoomt)', () => {
        // 800×600-Bild bei scale=3 im 1000×800-Viewport: maxX=(2400-1000)/2=700, maxY=(1800-800)/2=500.
        const s = makeState(800, 600)
        s.scale = 3
        s.x = 10_000
        s.y = 10_000
        s.clampPan()
        expect(s.x).toBe(700)
        expect(s.y).toBe(500)

        s.x = -10_000
        s.y = -10_000
        s.clampPan()
        expect(s.x).toBe(-700)
        expect(s.y).toBe(-500)
    })
})

test('toggleZoom: 1 → 2,5 → 1', () => {
    const s = makeState()
    expect(s.scale).toBe(1)
    s.toggleZoom(500, 400)
    expect(s.scale).toBe(2.5)
    s.toggleZoom(500, 400)
    expect(s.scale).toBe(1)
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
})

test.describe('onWheel', () => {
    test('deltaY>0 zoomt raus, deltaY<0 zoomt rein — und preventDefault() wird IMMER aufgerufen', () => {
        const out = makeState()
        out.scale = 2
        const wOut = fakeWheel({ deltaY: 100 })
        out.onWheel(wOut.event)
        expect(out.scale).toBeLessThan(2)
        expect(wOut.wasPrevented()).toBe(true)

        const inZoom = makeState()
        inZoom.scale = 2
        const wIn = fakeWheel({ deltaY: -100 })
        inZoom.onWheel(wIn.event)
        expect(inZoom.scale).toBeGreaterThan(2)
        expect(wIn.wasPrevented()).toBe(true)
    })

    test('deltaMode=1 (Zeilen-Modus) wird auf px normiert (Faktor 16)', () => {
        const lines = makeState()
        lines.scale = 2
        lines.onWheel(fakeWheel({ deltaY: 5, deltaMode: 1 }).event)

        const px = makeState()
        px.scale = 2
        px.onWheel(fakeWheel({ deltaY: 80, deltaMode: 0 }).event) // 5 Zeilen × 16 = 80px

        expect(lines.scale).toBeCloseTo(px.scale, 10)
    })

    test('ctrlKey (Trackpad-Pinch) zoomt kräftiger als das normale Mausrad', () => {
        const wheel = makeState()
        wheel.scale = 2
        wheel.onWheel(fakeWheel({ deltaY: -50, ctrlKey: false }).event)

        const pinch = makeState()
        pinch.scale = 2
        pinch.onWheel(fakeWheel({ deltaY: -50, ctrlKey: true }).event)

        // beide zoomen rein (deltaY negativ) — der Trackpad-Pinch stärker.
        expect(wheel.scale).toBeGreaterThan(2)
        expect(pinch.scale).toBeGreaterThan(wheel.scale)
    })
})

test('Pinch: Finger-Abstand verdoppelt sich ⇒ scale ≈ verdoppelt', () => {
    const s = makeState()
    s.onPointerDown(fakePointer(1, 480, 400))
    s.onPointerDown(fakePointer(2, 520, 400)) // Start-Abstand 40px, startScale=1
    s.onPointerMove(fakePointer(2, 560, 400)) // neuer Abstand 80px → Faktor 2
    expect(s.scale).toBeCloseTo(2, 5)
})

test('Pinch → Pan-Übergang: verbleibender Finger pannt weiter OHNE Sprung', () => {
    const s = makeState()
    s.onPointerDown(fakePointer(1, 480, 400))
    s.onPointerDown(fakePointer(2, 520, 400))
    s.onPointerMove(fakePointer(2, 560, 400)) // Pinch → scale ≈ 2, x/y gesetzt
    const xAfterPinch = s.x
    const yAfterPinch = s.y

    s.onPointerUp(fakePointer(1, 480, 400)) // ein Finger geht hoch
    // Das Loslassen selbst darf die Position NICHT verschieben (neuer Anker wird
    // exakt aus der aktuellen Übersetzung berechnet).
    expect(s.x).toBe(xAfterPinch)
    expect(s.y).toBe(yAfterPinch)

    s.onPointerMove(fakePointer(2, 570, 400)) // verbleibender Finger 10px weiter
    expect(s.x - xAfterPinch).toBeCloseTo(10, 5) // 1:1-Pan, kein Sprung
    expect(s.y).toBeCloseTo(yAfterPinch, 5)
})

test.describe('Doppeltipp', () => {
    test('zwei touch-pointerups < 300ms und < 30px lösen den Zoom aus', () => {
        const s = makeState()
        const tap = (x: number, y: number) => {
            s.onPointerDown(fakePointer(7, x, y, { pointerType: 'touch' }))
            s.onPointerUp(fakePointer(7, x, y, { pointerType: 'touch' }))
        }
        tap(500, 400)
        tap(505, 402) // knapp daneben, direkt danach (synchron, ≪300ms)
        expect(s.scale).toBe(2.5)
    })

    test('zu weit auseinander (≥30px) löst KEINEN Zoom aus', () => {
        const s = makeState()
        const tap = (x: number, y: number) => {
            s.onPointerDown(fakePointer(7, x, y, { pointerType: 'touch' }))
            s.onPointerUp(fakePointer(7, x, y, { pointerType: 'touch' }))
        }
        tap(500, 400)
        tap(600, 400) // 100px entfernt
        expect(s.scale).toBe(1)
    })

    test('zu langsam (≥300ms) löst KEINEN Zoom aus', async () => {
        const s = makeState()
        const tap = (x: number, y: number) => {
            s.onPointerDown(fakePointer(7, x, y, { pointerType: 'touch' }))
            s.onPointerUp(fakePointer(7, x, y, { pointerType: 'touch' }))
        }
        tap(500, 400)
        await new Promise((r) => setTimeout(r, 320)) // echte kurze Wartezeit statt Fake-Timer
        tap(505, 402)
        expect(s.scale).toBe(1)
    })

    test("pointerType 'mouse' löst KEINEN Doppeltipp aus (die Maus hat ihr eigenes dblclick)", () => {
        const s = makeState()
        const click = (x: number, y: number) => {
            s.onPointerDown(fakePointer(1, x, y, { pointerType: 'mouse' }))
            s.onPointerUp(fakePointer(1, x, y, { pointerType: 'mouse' }))
        }
        click(500, 400)
        click(502, 401)
        expect(s.scale).toBe(1)
    })
})

test('panned-Guard: echtes Ziehen (>10px) setzt panned=true, ein reiner Tipp lässt es false', () => {
    const dragger = makeState()
    dragger.onPointerDown(fakePointer(1, 100, 100))
    dragger.onPointerMove(fakePointer(1, 130, 100)) // 30px > TAP_SLOP(10)
    expect(dragger.panned).toBe(true)

    const tapper = makeState()
    tapper.onPointerDown(fakePointer(1, 100, 100))
    tapper.onPointerMove(fakePointer(1, 103, 100)) // 3px < TAP_SLOP(10)
    expect(tapper.panned).toBe(false)
})

test('reset(): setzt scale/x/y/smooth/panned zurück UND leert die Pointer-Map', () => {
    const s = makeState()
    s.onPointerDown(fakePointer(1, 100, 100))
    s.zoomTo(3, 100, 100, true)
    expect(s.scale).toBeGreaterThan(1)

    s.reset()
    expect(s.scale).toBe(1)
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
    expect(s.smooth).toBe(false)
    expect(s.panned).toBe(false)

    // Regressions-Guard: Finger 1 wurde nie per onPointerUp entfernt — läge er noch in
    // der Pointer-Map, würde ein zweiter Finger sofort einen Pinch (2 Punkte) auslösen.
    // Nach reset() ist die Map leer: der zweite Finger allein kann NICHT pinchen.
    s.onPointerDown(fakePointer(2, 300, 100))
    s.onPointerMove(fakePointer(2, 400, 100))
    expect(s.scale).toBe(1)
})
