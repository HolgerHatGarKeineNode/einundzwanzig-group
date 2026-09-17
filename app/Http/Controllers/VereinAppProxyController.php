<?php

namespace App\Http\Controllers;

use App\Support\VereinNip98;
use App\Support\VereinUpstreamBudget;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response as ClientResponse;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response as SymfonyResponse;

/**
 * P8 — App-Proxy: die drei App-Endpunkte des Vereins, weitergereicht an
 * `api/v1/app/membership` der Vereins-Instanz.
 *
 * Das ist der kleine Bruder von {@see VereinProxyController}, und die
 * Unterschiede sind das Design:
 *
 *   1. KEINE Session. Der Aufrufer ist die native App auf einem fremden
 *      Gerät, nicht ein Browser unserer Instanz. Es gibt kein
 *      `nostr_pubkey` in einer Session und nichts, woran der Proxy den
 *      Aufrufer binden könnte — die Bindung übernimmt der Verein über
 *      Client-Key-Kontingente pro Body-Pubkey.
 *   2. KEIN NIP-98. Der App-Zweig des Vereins verzichtet bewusst auf die
 *      Signatur (Entscheid des Auftraggebers); ein Authorization-Header
 *      würde gar nicht erst erzeugt. Der Proxy leitet deshalb auch keinen
 *      weiter — ein gesendeter Header wird verworfen, nicht durchgereicht.
 *   3. KEIN CSRF. Die Routen hängen nicht in der `web`-Gruppe; es gibt
 *      keine Session, gegen die ein Cross-Site-Post etwas richten könnte.
 *
 * Was BLEIBT, ist die Whitelist-Bauform: drei `(Methode, Pfad)`-Paare, fest
 * verdrahtet, kein Anteil des Requests erreicht die Ziel-URL. Und der
 * `X-Api-Key` — er bleibt serverseitig und ist der Grund, warum dieser
 * Proxy existiert statt eines Direktrufs aus der App.
 *
 * Bedrohungslage, offen benannt: jeder Internet-Teilnehmer kann diese drei
 * Routen treffen. Er kann einen Antrag und eine Rechnung für einen Pubkey
 * seiner Wahl erzeugen — auf Kontingent des Vereins, ohne je Zugang zu
 * bekommen (die Zahlung ist die Mitgliedschaft, und eine fremde Gebühr ist
 * ein Geschenk). Die Kontingente hier (pro IP und pro Body-Pubkey) decken
 * Versehentliches ab; ein Entschlossener mit dem Client-Key-Wissen hätte
 * den Key ohnehin. Lesen kann er nichts: die drei Routen geben keine
 * Mitgliedsdaten heraus.
 *
 * D11 — two READ routes were added later, and they are the exception to point
 * 2: `GET /me` and `GET /payments` do return member data, so they go to the
 * SIGNED branch of the Verein (`api/v1/membership/me|payments`, group
 * `api.v1` with VerifyNip98), not to the unsigned app branch. The app signs a
 * NIP-98 event for the Verein URL itself; the proxy pre-checks it
 * ({@see VereinNip98::verifyWithoutSession()}) and forwards the header byte
 * for byte. Without a valid event nothing leaves this server. An unsigned
 * app `/me` would be exactly the status oracle the Verein refuses to offer.
 *
 * What the signature does NOT do: bind the event to whoever presents it.
 * There is no session and no client secret on this branch, so the event is a
 * bearer credential for its short lifetime (60 s window, single use at the
 * Verein). Accepted residual risk: anyone who obtains a member's fresh,
 * unspent read event can redeem it here once and read that member's status
 * and payments — inherent to a keyless app client.
 */
class VereinAppProxyController
{
    /** Pfad-Präfix des App-Zweigs der Vereins-API. */
    private const API_PREFIX = '/api/v1/app/membership';

    /** Path prefix of the SIGNED membership branch (NIP-98 required there). */
    private const SIGNED_API_PREFIX = '/api/v1/membership';

    /** Signed reads per verified signer; checked only after the signature passed. */
    private const SIGNER_READS_PER_MINUTE = 6;

    /**
     * Gleiche Grenzen wie der Web-Proxy: endlich, ohne retry — der Verein
     * verbucht Application und Invoice idempotent, ein blindes Wiederholen
     * einer gescheiterten Anfrage erzeugt aber trotzdem BTCPay-Last.
     */
    private const CONNECT_TIMEOUT_SECONDS = 5;

    private const TIMEOUT_SECONDS = 20;

    /** @var list<string> */
    private const PASSED_RESPONSE_HEADERS = ['Content-Type', 'Retry-After'];

    /** Beitrag, Statuten, Konfiguration — der eine GET. */
    public function config(): SymfonyResponse
    {
        return $this->forward('/config');
    }

    /** Antrag + Statuten-Zustimmung; das Subjekt (Pubkey) steht im Body. */
    public function storeApplication(Request $request): SymfonyResponse
    {
        return $this->forward('/applications');
    }

    /** BTCPay-Checkout für ein Jahr; Subjekt und Rückkehradresse im Body. */
    public function invoice(string $year): SymfonyResponse
    {
        if (preg_match('/^[0-9]{4}\z/', $year) !== 1) {
            throw new HttpResponseException(response()->json([
                'message' => __('Unbekanntes Jahr.'),
            ], 404));
        }

        return $this->forward('/payments/'.$year.'/invoice');
    }

    /** Own membership status; the subject is the pubkey that signed the event. */
    public function me(Request $request): SymfonyResponse
    {
        return $this->noStore($this->forwardSigned($request, '/me'));
    }

    /** Own payments; the subject is the pubkey that signed the event. */
    public function payments(Request $request): SymfonyResponse
    {
        return $this->noStore($this->forwardSigned($request, '/payments'));
    }

    /**
     * Fest verdrahteter Pfad, roher Body, ein Aufruf, Antwort unverfälscht.
     *
     * @param  string  $path  aus keinerlei Request-Anteil abgeleitet
     */
    private function forward(string $path): SymfonyResponse
    {
        $baseUrl = rtrim((string) config('verein.base_url'), '/');
        $apiKey = (string) config('verein.api_key');

        // Fail closed, gleicher Satz wie überall: eine nicht eingerichtete
        // Anbindung ist ein dauerhafter Zustand, kein Handgriff am Bildschirm
        // hilft, und ein Aufruf ohne Schlüssel sähe wie ein 401 des Vereins
        // aus, obwohl der eigene Server falsch steht.
        if ($baseUrl === '' || $apiKey === '') {
            return response()->json([
                'message' => __('Die Vereins-Anbindung ist nicht eingerichtet.'),
            ], 503);
        }

        $request = request();
        $body = $request->getContent();

        $this->assertBodyIsJson($body);

        $pending = Http::withHeaders([
            'Accept' => 'application/json',
            'X-Api-Key' => $apiKey,
        ])
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->timeout(self::TIMEOUT_SECONDS)
            // Kein Redirect-Follow aus demselben Grund wie im Web-Proxy: der
            // Schlüssel wandert nicht an einen zweiten Origin, und ein 3xx
            // ist eine Antwort wie jede andere — Status und Body durch, der
            // `Location`-Header bleibt draußen.
            ->withOptions(['allow_redirects' => false]);

        if ($body !== '') {
            $pending = $pending->withBody($body, 'application/json');
        }

        // Unsigned route: anonymous sub-budget on top of the shared one.
        if (($exhausted = VereinUpstreamBudget::reserveAnonymous()) !== null) {
            return $exhausted;
        }

        try {
            $response = $pending->send(Str::upper($request->method()), $baseUrl.self::API_PREFIX.$path);
        } catch (ConnectionException) {
            // Kein zweiter Versuch, gleiche Begründung wie im Web-Proxy — der
            // erste Versuch kann den Verein erreicht und nur die Antwort
            // verloren haben.
            return response()->json([
                'message' => __('Der Verein ist derzeit nicht erreichbar.'),
            ], 504);
        }

        return $this->passThrough($response);
    }

    /**
     * GET to a signed Verein endpoint: pre-check, one call, answer unchanged.
     *
     * Nothing from the request reaches the target URL (the query string is
     * dropped, like in the web proxy — the Verein compares `u` including the
     * query, so a forwarded one could only turn a valid event into a 401).
     * No retry: the Verein burns the event id on first sight, a second
     * attempt with the same header is a guaranteed 401. A new attempt needs a
     * new signature, which only the client can make.
     *
     * @param  string  $path  hard-wired, never derived from the request
     */
    private function forwardSigned(Request $request, string $path): SymfonyResponse
    {
        $baseUrl = rtrim((string) config('verein.base_url'), '/');
        $apiKey = (string) config('verein.api_key');

        if ($baseUrl === '' || $apiKey === '') {
            return response()->json([
                'message' => __('Die Vereins-Anbindung ist nicht eingerichtet.'),
            ], 503);
        }

        $target = $baseUrl.self::SIGNED_API_PREFIX.$path;

        try {
            $signer = VereinNip98::verifyWithoutSession($request, $target);
        } catch (HttpResponseException $denied) {
            return $denied->getResponse();
        }

        // Per-signer bucket, counted only for VERIFIED signatures: a forged
        // claim never reaches this line, so nobody can fill a chosen member's
        // bucket without that member's key. Checked before the shared budget
        // and hit only after it was granted, so a refusal by either costs the
        // other nothing.
        $signerKey = 'verein-app-read:signer:'.$signer;

        if (RateLimiter::tooManyAttempts($signerKey, self::SIGNER_READS_PER_MINUTE)) {
            return VereinUpstreamBudget::tooManyAttempts($signerKey);
        }

        if (($exhausted = VereinUpstreamBudget::reserve()) !== null) {
            return $exhausted;
        }

        RateLimiter::hit($signerKey, 60);

        try {
            $response = Http::withHeaders([
                'Accept' => 'application/json',
                'X-Api-Key' => $apiKey,
                'Authorization' => (string) $request->header('Authorization'),
            ])
                ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
                ->timeout(self::TIMEOUT_SECONDS)
                ->withOptions(['allow_redirects' => false])
                ->send('GET', $target);
        } catch (ConnectionException) {
            return response()->json([
                'message' => __('Der Verein ist derzeit nicht erreichbar.'),
            ], 504);
        }

        return $this->passThrough($response);
    }

    /** Status and body unchanged; only the allow-listed headers come along. */
    private function passThrough(ClientResponse $response): SymfonyResponse
    {
        $out = response($response->body(), $response->status());

        foreach (self::PASSED_RESPONSE_HEADERS as $header) {
            $value = $response->header($header);

            if ($value !== '') {
                $out->header($header, $value);
            }
        }

        return $out;
    }

    /**
     * Member data must not sit in any cache between app and proxy — on every
     * outcome, including the refusals, so no status code is left to a
     * cache's default.
     */
    private function noStore(SymfonyResponse $response): SymfonyResponse
    {
        $response->headers->set('Cache-Control', 'no-store');

        return $response;
    }

    /**
     * 415 VOR dem Netz: ein Body, der kein JSON ist, würde beim Verein als
     * Validierungsfehler durchgehen — aber erst nach einem Netzwerk-Roundtrip,
     * der nichts klärt, und mit einer Fehlermeldung, die von einem anderen
     * Server stammt als der, den der Nutzer sieht.
     */
    private function assertBodyIsJson(string $body): void
    {
        if ($body === '') {
            return;
        }

        json_decode($body);

        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new HttpResponseException(response()->json([
                'message' => __('Ungültiger Anfragekörper.'),
            ], 415));
        }
    }
}
