import { type Page } from '@playwright/test'

/**
 * Prüft, ob ein Element vollständig im Viewport steht — und um wie viel Pixel es an
 * welcher der vier Kanten hinausragt, statt nur ob.
 *
 * Anlass (Teambesprechung 2026-08-06, `design-lead`-Fund nach einem ACCEPT): das
 * Emoji-Panel öffnete beim ERSTEN Klick 98 px unterhalb des Viewport-Randes
 * abgeschnitten (`emoji-panel-position.spec.ts`). Die Rechnung dafür stand bis dahin
 * nur als lokale `panelGeometry()`-Funktion in genau dieser einen Spec und war aus
 * keiner anderen aufrufbar — eine Werkzeuglücke, keine Sorgfaltslücke: jeder hätte
 * den Überstand gefunden, hätte er nur eine Zeile gekostet.
 *
 * Liefert die Zahl statt eines Booleans, damit eine Fehlermeldung „98 px unter dem
 * Rand" sagen kann statt nur „false". Positiv = Überstand über die jeweilige Kante
 * hinaus, 0 oder negativ = im Rahmen.
 */
export type ViewportOverflow = {
    top: number
    bottom: number
    left: number
    right: number
    width: number
    height: number
    viewportWidth: number
    viewportHeight: number
    ueberlaufOben: number
    ueberlaufUnten: number
    ueberlaufLinks: number
    ueberlaufRechts: number
}

/**
 * Geometrie eines Elements relativ zum Viewport. `null`, wenn der Selektor kein
 * Element trifft — ein Aufrufer, der das ignoriert, bekäme sonst `undefined`-Zugriffe
 * statt eines klaren Signals „nicht gefunden" (fail-closed, nicht fail-open).
 */
export const viewportOverflow = (page: Page, selector: string): Promise<ViewportOverflow | null> =>
    page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null
        if (!el) {
            return null
        }
        const r = el.getBoundingClientRect()
        return {
            top: Math.round(r.top),
            bottom: Math.round(r.bottom),
            left: Math.round(r.left),
            right: Math.round(r.right),
            width: Math.round(r.width),
            height: Math.round(r.height),
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
            ueberlaufOben: Math.round(0 - r.top),
            ueberlaufUnten: Math.round(r.bottom - window.innerHeight),
            ueberlaufLinks: Math.round(0 - r.left),
            ueberlaufRechts: Math.round(r.right - window.innerWidth),
        }
    }, selector)
