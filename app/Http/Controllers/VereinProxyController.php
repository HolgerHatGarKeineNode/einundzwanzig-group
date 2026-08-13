<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\VereinNip98;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Response;

/**
 * P4 — Weiterleitung an die Mitglieds-API des Vereins, mit Aufrufer-Bindung.
 *
 * Der Proxy hält den `X-Api-Key`, den der Browser nie sehen darf. Ein Proxy, der
 * nur diesen Schlüssel anhängt, verleiht ihn an jeden im Internet: `POST
 * /applications` legt für jeden signierenden Pubkey eine Vereinsakte an, jede
 * Invoice ist ein BTCPay-Aufruf auf Vereinskosten. Die Bindung an den
 * angemeldeten Nutzer ist deshalb keine Härtung, sondern Voraussetzung — sie
 * besteht aus drei Teilen:
 *
 *   1. Session-Gate (EnsureNostrSessionPubkey) — für ALLE sechs Endpunkte.
 *   2. NIP-98-Prüfung gegen die selbst gebaute Ziel-URL — für fünf davon.
 *      `GET /config` verlangt beim Verein kein NIP-98 (routes/api.php:40-42
 *      dort), nur den Client-Schlüssel; deshalb hier auch nicht.
 *   3. `pubkey` des Events === Session-Pubkey, sonst 403 (in VereinNip98).
 *
 * Die Whitelist ist die Routentabelle selbst (routes/verein.php): sechs
 * `(Methode, Pfad)`-Paare, jedes auf genau eine Methode hier abgebildet, jede
 * mit fest verdrahtetem Zielpfad. `DELETE /api/verein/me` läuft dadurch in
 * Laravels 405, `export` existiert nicht — beides ohne eine Zeile Code, die
 * eine Verbotsliste pflegen müsste. Eine Verbotsliste wäre auch die falsche
 * Bauform: die beiden verbotenen Ziele unterscheiden sich von erlaubten allein
 * durch die HTTP-Methode bzw. ein Pfadsegment.
 */
class VereinProxyController
{
    /** Pfad-Präfix der versionierten Mitglieds-API des Vereins. */
    private const API_PREFIX = '/api/v1/membership';

    /**
     * Zeitgrenzen des ausgehenden Aufrufs. Bewusst endlich und bewusst ohne
     * `retry()`: ein NIP-98-Event ist nach dem ersten Versuch verbraucht (der
     * Verein brennt die Event-ID für 150 s), ein zweiter Versuch mit demselben
     * Ausweis ergäbe ein „Authentifizierung fehlgeschlagen", obwohl der erste
     * Versuch die Akte längst angelegt haben kann.
     */
    private const CONNECT_TIMEOUT_SECONDS = 5;

    private const TIMEOUT_SECONDS = 20;

    /**
     * Antwort-Header, die zurück an den Browser dürfen. Alles andere fällt weg —
     * insbesondere `Set-Cookie` (fremde Session in unserer Domain) und die
     * `X-RateLimit-*`-Zähler des Vereins, die nur seine Innensicht verraten.
     * `Retry-After` bleibt, weil ein 429 ohne diese Angabe den Client zum Raten
     * zwingt und Raten hier neue Signaturen kostet.
     */
    private const PASSED_RESPONSE_HEADERS = ['Content-Type', 'Retry-After'];

    /** Statuten, Beitrag, Version — ohne NIP-98, siehe Klassenkommentar. */
    public function config(Request $request): Response
    {
        return $this->forward($request, self::API_PREFIX.'/config', requiresNip98: false);
    }

    /** Beitrittsantrag; 201 bei Erstzustimmung, 200 bei Wiederholung. */
    public function storeApplication(Request $request): Response
    {
        return $this->forward($request, self::API_PREFIX.'/applications');
    }

    /** Eigener Mitgliedschafts-Status. */
    public function me(Request $request): Response
    {
        return $this->forward($request, self::API_PREFIX.'/me');
    }

    /** Eigene Zahlungen. */
    public function payments(Request $request): Response
    {
        return $this->forward($request, self::API_PREFIX.'/payments');
    }

    /** Rechnung für ein Jahr erzeugen (BTCPay, Kontingent 3/Tag beim Verein). */
    public function invoice(Request $request, string $year): Response
    {
        return $this->forward($request, $this->paymentsPath($year).'/invoice');
    }

    /** Zahlungsstand eines Jahres neu einlesen. */
    public function refresh(Request $request, string $year): Response
    {
        return $this->forward($request, $this->paymentsPath($year).'/refresh');
    }

    /**
     * Der einzige variable Anteil einer Ziel-URL im ganzen Proxy.
     *
     * Die Route beschränkt `{year}` bereits auf vier Ziffern
     * (`->where('year', '[0-9]{4}')`). Die Prüfung steht hier ein zweites Mal,
     * weil die Zusicherung „hier kann nichts aus dem Request in die URL
     * geraten" sonst an einer Datei hinge, die jemand später umbaut: ein
     * entferntes `where` wäre eine unsichtbare Änderung an dieser Stelle.
     *
     * `\z` statt `$`: PCRE lässt `$` auch VOR einem abschließenden `\n` matchen,
     * `"2026\n"` käme also durch — und dann stünde ein Zeilenumbruch in einer
     * URL, die gleich als Header-Ziel dient. Heute fängt das die Routen-Regex
     * ab (Laravel kompiliert sie mit `D`), aber genau für den Fall, dass die
     * eines Tages fehlt, steht dieser Riegel hier. Ein Anker, der nur solange
     * hält, wie der andere Riegel da ist, wäre kein zweiter Riegel.
     */
    private function paymentsPath(string $year): string
    {
        if (preg_match('/^[0-9]{4}\z/', $year) !== 1) {
            throw new HttpResponseException(response()->json([
                'message' => __('Unbekanntes Jahr.'),
            ], 404));
        }

        return self::API_PREFIX.'/payments/'.$year;
    }

    /**
     * Baut den ausgehenden Aufruf und gibt die Antwort des Vereins unverfälscht
     * zurück.
     *
     * Der Query-String des eingehenden Requests wird VERWORFEN, nicht angehängt.
     * Er wäre eine Aufrufer-Eingabe in der Ziel-URL, und der Verein vergleicht
     * den `u`-Tag byteweise inklusive Query — jeder mitgeschleppte Parameter
     * wäre also entweder wirkungslos oder ein 401. Keiner der sechs Endpunkte
     * kennt heute einen Query-Parameter; käme je einer dazu, gehört er als
     * eigener, fest verdrahteter Anteil hierher.
     *
     * @param  string  $path  fest verdrahtet, nie aus dem Request abgeleitet
     */
    private function forward(Request $request, string $path, bool $requiresNip98 = true): Response
    {
        $baseUrl = rtrim((string) config('verein.base_url'), '/');
        $apiKey = (string) config('verein.api_key');

        // Fail closed. Ohne Schlüssel wird NICHT aufgerufen — ein Aufruf ohne
        // Schlüssel wäre beim Verein ein 401 und sähe für den Nutzer wie ein
        // Problem seiner Anmeldung aus, obwohl der Server falsch steht.
        //
        // Der Satz ist DERSELBE wie im Client (`js/verein.ts`, fehlende
        // Basis-URL) und das mit Absicht: für den Nutzer ist beides ein
        // Zustand — diese Installation ist nicht eingerichtet, dauerhaft, und
        // kein Handgriff am Bildschirm hilft. Vorher standen dafür zwei
        // deutsche Formulierungen, die sich nicht unterschieden; in es/pt/pl
        // musste ein Unterschied erfunden werden, damit nicht zwei Schlüssel
        // denselben Wert tragen. Unterscheidbar bleibt „gerade nicht
        // verfügbar" (503 der Gegenseite, vorübergehend) — die Trennung, auf
        // die es ankommt, ist dauerhaft gegen vorübergehend, nicht Client
        // gegen Server. Woher der 503 kam, sagt der Ort, nicht der Text.
        if ($baseUrl === '' || $apiKey === '') {
            return response()->json([
                'message' => __('Die Vereins-Anbindung ist nicht eingerichtet.'),
            ], 503);
        }

        $target = $baseUrl.$path;

        // Rohe Bytes, ein einziges Mal gelesen. Kein json_decode/-encode auf dem
        // ganzen Weg: zwei verschiedene Byte-Folgen können zum selben Array
        // parsen, und der `payload`-Tag der Signatur hängt an den Bytes.
        $body = $request->getContent();

        $this->assertBodyIsJson($request, $body);

        /** @var string $sessionPubkey Format vom Gate garantiert. */
        $sessionPubkey = (string) $request->session()->get('nostr_pubkey');

        $headers = [
            // Der Verein hat kein `shouldRenderJsonWhen`; ohne diesen Header
            // können seine Fehlerantworten HTML sein, und aus einem 422 mit
            // `errors` würde eine Seite, die der Client nicht auswerten kann.
            'Accept' => 'application/json',
            'X-Api-Key' => $apiKey,
        ];

        if ($requiresNip98) {
            VereinNip98::verify($request, $target, $sessionPubkey, $body);

            // Nur ein SELBST GEPRÜFTER Ausweis wird weitergereicht. Für /config
            // fehlt diese Prüfung (der Endpunkt verlangt dort keinen), also geht
            // dort auch kein Authorization-Header raus — sonst wäre /config der
            // Weg, ein beliebiges Event ungeprüft an den Verein zu geben.
            $headers['Authorization'] = (string) $request->header('Authorization');
        }

        $pending = Http::withHeaders($headers)
            ->connectTimeout(self::CONNECT_TIMEOUT_SECONDS)
            ->timeout(self::TIMEOUT_SECONDS)
            /*
             * Umleitungen werden NICHT verfolgt.
             *
             * Guzzle entfernt beim Wechsel auf einen fremden Origin genau zwei
             * Header — `Authorization` und `Cookie`
             * (vendor/guzzlehttp/guzzle/src/RedirectMiddleware.php:219-222).
             * `X-Api-Key` steht auf dieser Liste nicht und würde mitwandern:
             * eine 302 vom Verein (oder eine falsch gesetzte `VEREIN_API_URL`)
             * lieferte den Schlüssel an einen fremden Server, ohne dass hier
             * irgendetwas auffällig aussähe. Der Schlüssel geht deshalb nur an
             * genau den Origin, der konfiguriert ist, und an keinen zweiten.
             *
             * Ein 3xx ist damit eine Antwort wie jede andere und wird nach
             * Vorgabe 9 unverfälscht durchgereicht — Status und Body. Der
             * `Location`-Header bleibt draußen (er steht nicht in
             * PASSED_RESPONSE_HEADERS): sonst schickte der Browser den Aufrufer
             * an ein Ziel, das der Verein bestimmt, und der Proxy wäre die
             * Weiterleitungsstelle dorthin.
             */
            ->withOptions(['allow_redirects' => false]);

        if ($body !== '') {
            $pending = $pending->withBody($body, (string) $request->header('Content-Type'));
        }

        try {
            $response = $pending->send($request->method(), $target);
        } catch (ConnectionException) {
            // Kein zweiter Versuch: der erste kann den Verein erreicht haben und
            // nur die Antwort verloren gegangen sein. Die Exception-Meldung
            // (enthält die Ziel-URL, keine Header) wird bewusst nicht ausgegeben
            // und nicht geloggt.
            return response()->json([
                'message' => __('Der Verein ist derzeit nicht erreichbar.'),
            ], 504);
        }

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
     * Ein Body, den der Proxy nicht byteweise sehen kann, wird nicht
     * weitergereicht.
     *
     * Unter einer echten SAPI hat PHP einen multipart-Body bereits in `$_POST`
     * geparst, bevor Anwendungscode läuft — `getContent()` ist dann LEER. Der
     * `payload`-Tag der Signatur wäre gegen sha256('') zu prüfen, und den kann
     * jeder signieren: die Signatur bände dann Nutzer, Methode und URL, aber
     * kein Byte der Daten. Der Verein weist denselben Fall mit 415 ab
     * (Nip98.php:291-314); hier fällt er eine Netzwerkstrecke früher, ohne
     * Ausweis und ohne Vereins-Kontingent zu verbrennen.
     */
    private function assertBodyIsJson(Request $request, string $body): void
    {
        $carriesInput = $body !== '' || $request->request->count() > 0 || $request->allFiles() !== [];

        if (! $carriesInput) {
            return;
        }

        $type = Str::lower(trim(Str::before((string) $request->header('Content-Type', ''), ';')));

        if ($type !== 'application/json' || $body === '') {
            throw new HttpResponseException(response()->json([
                'message' => __('Nur application/json wird angenommen.'),
            ], 415));
        }
    }
}
