import { execFileSync } from 'node:child_process'

/**
 * Seedet den Test-zooid (:3335) SYNCHRON vor allen E2E-Tests — bewusst hier statt im
 * `webServer`: der webServer-Probe genügt schon der gebundene Port, das Seeding liefe
 * dann noch (Bind-vor-Seed-Race → Composer „nicht beigetreten"). `globalSetup` blockiert
 * die Tests dagegen, bis das Skript durch UND verifiziert ist.
 *
 * Das Skript hat einen Reuse-Guard (schnell, wenn schon sauber geseedet) und setzt den
 * Relay sonst frisch auf (kill/wipe/seed) — das hält die SQLite über viele Läufe klein
 * (kein Bloat mehr). Der Relay läuft danach detached weiter; der nächste Lauf verwendet
 * ihn wieder. Der Mitschau-zooid auf :3334 bleibt IMMER unberührt.
 */
export default function globalSetup(): void {
    execFileSync('bash', ['tests/e2e/support/zooid-testserver.sh'], { stdio: 'inherit' })
}
