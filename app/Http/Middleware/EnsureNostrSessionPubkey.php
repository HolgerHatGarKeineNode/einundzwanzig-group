<?php

declare(strict_types=1);

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gate des Vereins-Proxys: verlangt einen beglaubigten Pubkey in der Session.
 *
 * Bewusst NICHT `nostr.auth` (Einundzwanzig\Group\Http\Middleware\EnsureNostrAuth):
 * die winkt im NativePHP-Lauf bedingungslos durch (`EnsureNostrAuth.php:24-26`) —
 * ein vorgefundener, bewusster Zustand für die lokale Single-User-Instanz, aber
 * als Gate vor einem Server-Geheimnis untauglich. Hier gibt es keinen solchen
 * Zweig; der Proxy ist im Mobile-Build ohnehin nicht registriert
 * (siehe bootstrap/app.php), und wäre er es, würde er hier trotzdem prüfen.
 *
 * Zweiter Unterschied: Antwort ist 401 JSON statt eines Redirects auf die
 * Login-Seite. Der Aufrufer ist `fetch()` aus der Nostr-Insel, kein Browser-
 * Navigationsschritt — ein 302 auf HTML sähe für ihn wie eine erfolgreiche
 * Antwort mit unlesbarem Inhalt aus.
 *
 * Der Pubkey wird gegen die NIP-01-Schreibweise geprüft: hex(64), klein —
 * mit `\z` als Anker, weil PCRE bei `$` auch einen abschließenden `\n`
 * durchließe. Er
 * geht anschließend als Vergleichswert in die NIP-98-Bindung
 * (VereinNip98::verify) und als Schlüssel in den Rate-Limiter — beides sind
 * Zeichenketten-Vergleiche, in denen eine abweichende Schreibweise eine andere
 * Identität wäre.
 */
class EnsureNostrSessionPubkey
{
    public function handle(Request $request, Closure $next): Response
    {
        $pubkey = $request->session()->get('nostr_pubkey');

        if (! is_string($pubkey) || preg_match('/^[0-9a-f]{64}\z/', $pubkey) !== 1) {
            return response()->json(['message' => __('Nicht angemeldet.')], 401);
        }

        return $next($request);
    }
}
