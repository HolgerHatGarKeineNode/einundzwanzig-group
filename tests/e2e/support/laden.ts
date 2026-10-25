import { type Page } from '@playwright/test'

/**
 * Wait for a condition on DATA the page loads from the relay — and when it does not come, load
 * the page again, the way a reader would.
 *
 * Why this exists: the Forge islands load in rounds through `load()` with welshman's 3 s bound
 * (`welshmanNet.ts`: `timeout: 3000`) and a live subscription that only carries NEW events
 * afterwards. A round that overruns its 3 s on a busy machine ends the load with what it has —
 * `loading` flips to false, the list shows the repos but not their issues (or the issues but
 * not the maintainers) and nothing ever asks again. Waiting longer cannot help: the data is on
 * the relay (the specs read it back before the page opens) and the page has stopped asking.
 * Reproduced 2026-10-25 with 14 CPU hogs on the machine: `overview.repos[].issueCount` stayed
 * `{ viel: 0, wenig: 0 }` for the full 30 s (desktop-forge-feinschliff :246, :358, :506).
 * Reloading starts a fresh round, which is also the only recovery the product offers.
 *
 * This is the load-dependent step and it is bounded: `versuche` attempts of `fenster` ms each,
 * and the LAST attempt's failure is thrown unchanged. A condition that is wrong — not late —
 * therefore still fails, only after `versuche` windows instead of one.
 *
 * @param was          what is being waited for, for the log line
 * @param bedingung    awaits the condition with the given window in ms; throws when it is not met
 * @param nachNeuladen what to await after the reload so that `bedingung` is asked of a loaded page
 * @param diagnose     optional: what the page looked like when the attempt gave up, logged before the
 *                     reload — a retry that leaves no trace of WHY it was needed hides the cause
 */
export async function bisDaOderNeuLaden(
    page: Page,
    was: string,
    bedingung: (fenster: number) => Promise<void>,
    nachNeuladen: () => Promise<void>,
    {
        versuche = 3,
        fenster = 15_000,
        diagnose,
    }: { versuche?: number; fenster?: number; diagnose?: () => Promise<string> } = {},
): Promise<void> {
    for (let versuch = 1; ; versuch++) {
        try {
            await bedingung(fenster)

            return
        } catch (fehler) {
            if (versuch >= versuche) {
                throw fehler
            }
            const befund = diagnose ? await diagnose().catch((e: unknown) => `(diagnose scheiterte: ${String(e)})`) : ''
            console.log(
                `[laden] ${was}: nach ${fenster} ms nicht da (Versuch ${versuch}/${versuche}) — Seite neu laden${befund ? ` | ${befund}` : ''}`,
            )
            await page.reload()
            await nachNeuladen()
        }
    }
}
