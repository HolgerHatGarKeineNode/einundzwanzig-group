<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use swentel\nostr\Event\Event;
use Throwable;

/**
 * Prüft den `Authorization: Nostr <base64>`-Ausweis (NIP-98, kind 27235), BEVOR
 * der Proxy den `X-Api-Key` des Vereins dafür ausgibt.
 *
 * Warum überhaupt hier, wo der Verein dasselbe noch einmal prüft: Ein Proxy, der
 * den Ausweis ungeprüft weiterreicht, verleiht den Vereins-Schlüssel an jeden,
 * der einen Session-Cookie hat — `POST /applications` legt für JEDEN
 * signierenden Pubkey eine Vereinsakte an. Die eine Prüfung, die der Verein
 * NICHT führen kann, ist die Bindung an den hier angemeldeten Nutzer: er sieht
 * nur den signierenden Pubkey, nicht unsere Session. Genau das ist Schritt 8
 * unten — und der einzige, der 403 statt 401 gibt.
 *
 * Die Replay-Sperre bleibt beim Verein (`nip98:consumed:<id>`, TTL 150 s,
 * einundzwanzig-verein app/Support/Nip98.php). Sie wird hier bewusst NICHT
 * nachgebaut: ein Verbrauch in unserem Cache verbraucht sie dort nicht, und ein
 * zweiter Zähler auf demselben Ereignis erzeugt nur eine zweite Wahrheit.
 * Daraus folgt die Regel im Controller: das Event wird genau EINMAL
 * weitergereicht, ohne Retry.
 *
 * Die Meldungen benennen das verletzte Feld, nie den erwarteten Wert. Wer sie
 * sieht, ist bereits angemeldet (das Session-Gate lief davor) — für ihn ist die
 * Diagnose in P5 mehr wert als die Ununterscheidbarkeit, die der Verein an
 * seiner offenen Kante zu Recht führt.
 *
 * @phpstan-type Nip98Event array{id: string, pubkey: string, created_at: int, kind: int, tags: array<int, array<int, string>>, content: string, sig: string}
 */
final class VereinNip98
{
    /** NIP-98 HTTP Auth. */
    public const EVENT_KIND = 27235;

    /**
     * Frischefenster, symmetrisch. Deckungsgleich mit dem Verein
     * (`Nip98::MAX_CLOCK_SKEW_SECONDS = 60`) — NICHT die 300 s aus
     * NostrAuthController: was dieser Proxy durchlässt, muss dort noch gültig
     * sein, sonst tauschen wir ein sofortiges „abgelaufen" gegen eines nach dem
     * Netzwerk-Roundtrip, und der Client hat sein Event umsonst verbraucht.
     */
    public const MAX_CLOCK_SKEW_SECONDS = 60;

    /**
     * Verifiziert den Ausweis gegen genau die Ziel-URL, die der Proxy gleich
     * aufruft, und bindet ihn an den Session-Pubkey.
     *
     * @param  string  $targetUrl  absolute Vereins-URL, serverseitig gebaut
     * @param  string  $sessionPubkey  hex(64) aus der Laravel-Session
     * @param  string  $rawBody  rohe Bytes des eingehenden Bodys
     *
     * @throws HttpResponseException 401 (Ausweis untauglich) | 403 (fremder Pubkey)
     */
    public static function verify(Request $request, string $targetUrl, string $sessionPubkey, string $rawBody): void
    {
        $event = self::decode($request);

        // 1. Kind.
        if ($event['kind'] !== self::EVENT_KIND) {
            self::deny(__('Falscher Event-Typ.'));
        }

        // 2. Methode — ein für GET signiertes Event darf keinen POST auslösen.
        if (Str::upper(self::tag($event, 'method') ?? '') !== Str::upper($request->method())) {
            self::deny(__('Methode stimmt nicht.'));
        }

        // 3. `u` gegen die ZIEL-URL beim Verein, nicht gegen unsere Proxy-Route.
        // Der Verein vergleicht byteweise gegen seinen eigenen Origin plus
        // Request-URI; signierte der Client unsere Adresse, käme er dort nie
        // durch. Wir prüfen deshalb gegen dieselbe Zeichenkette, die wir gleich
        // aufrufen — dadurch ist ein für `/me` signiertes Event auf
        // `/payments/2026/invoice` wertlos, hier wie dort.
        $url = self::tag($event, 'u');
        if ($url === null || ! hash_equals($targetUrl, $url)) {
            self::deny(__('Die signierte Adresse passt nicht zum Ziel.'));
        }

        // 4. Frische.
        if (abs(now()->getTimestamp() - $event['created_at']) > self::MAX_CLOCK_SKEW_SECONDS) {
            self::deny(__('Ausweis abgelaufen.'));
        }

        // 5. `payload` über die ROHEN Bytes. Re-Serialisierung bricht ihn — der
        // Grund, warum der Body im Controller nie durch json_decode läuft.
        if ($rawBody !== '') {
            $payload = self::tag($event, 'payload');
            if ($payload === null || ! hash_equals(hash('sha256', $rawBody), Str::lower($payload))) {
                self::deny(__('Der Ausweis passt nicht zum Inhalt.'));
            }
        }

        // 6. Erst jetzt die teure Krypto: Event-ID + Schnorr-Signatur. Kein
        // eigenes Krypto — dieselbe Grenze wie NostrAuthController.
        $json = json_encode($event, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false || ! (new Event)->verify($json)) {
            self::deny(__('Ungültige Signatur.'));
        }

        // 7. Die Bindung an den angemeldeten Nutzer. Ohne sie ist die Whitelist
        // nur eine Auswahl der missbrauchbaren Endpunkte: jeder mit einer Session
        // könnte ein fremdes (z.B. abgefangenes) Event einlösen und auf fremde
        // Vereinsakten zugreifen.
        if (! hash_equals($sessionPubkey, $event['pubkey'])) {
            throw new HttpResponseException(response()->json([
                'message' => __('Der Ausweis gehört zu einem anderen Konto.'),
            ], 403));
        }
    }

    /**
     * Liest den Header und gibt das Event streng typisiert zurück. Alles, woran
     * die Signaturprüfung später ohnehin scheitern würde, fällt hier durch.
     *
     * @return Nip98Event
     *
     * @throws HttpResponseException
     */
    private static function decode(Request $request): array
    {
        $header = (string) $request->header('Authorization', '');

        if ($header === '' || ! Str::startsWith(Str::lower($header), 'nostr ')) {
            self::deny(__('Kein Nostr-Ausweis mitgeschickt.'));
        }

        $json = base64_decode(trim(Str::after($header, ' ')), true);

        if ($json === false) {
            self::deny(__('Ausweis unlesbar.'));
        }

        try {
            /** @var mixed $decoded */
            $decoded = json_decode((string) $json, true, flags: JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            self::deny(__('Ausweis unlesbar.'));
        }

        if (! is_array($decoded)) {
            self::deny(__('Ausweis unlesbar.'));
        }

        foreach (['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'] as $field) {
            if (! array_key_exists($field, $decoded)) {
                self::deny(__('Ausweis unvollständig.'));
            }
        }

        if (! is_string($decoded['id'])
            || ! is_string($decoded['pubkey'])
            || ! is_string($decoded['content'])
            || ! is_string($decoded['sig'])
            || ! is_int($decoded['created_at'])
            || ! is_int($decoded['kind'])
            || ! is_array($decoded['tags'])
        ) {
            self::deny(__('Ausweis unvollständig.'));
        }

        // NIP-01 kennt genau eine Schreibweise: Kleinbuchstaben-Hex. Der Verein
        // weist Großbuchstaben ab, weil dieselbe Identität sonst beliebig viele
        // Rate-Limit-Eimer hätte; hier kommt der zweite Grund dazu: der Vergleich
        // gegen den Session-Pubkey ist ein hash_equals über Zeichenketten, und
        // `A…` ist nicht `a…`. Ein großgeschriebener Pubkey fiele dort als
        // „fremdes Konto" durch, obwohl es dasselbe ist — hier fällt er als das
        // durch, was er ist: falsch geschrieben. Anker `\z`, nicht `$` — sonst
        // käme ein Wert mit abschließendem Zeilenumbruch durch, denn PCRE lässt
        // `$` genau davor matchen.
        if (preg_match('/^[0-9a-f]{64}\z/', $decoded['id']) !== 1
            || preg_match('/^[0-9a-f]{64}\z/', $decoded['pubkey']) !== 1
            || preg_match('/^[0-9a-f]{128}\z/', $decoded['sig']) !== 1
        ) {
            self::deny(__('Ausweis unvollständig.'));
        }

        $tags = [];
        foreach ($decoded['tags'] as $tag) {
            if (! is_array($tag)) {
                self::deny(__('Ausweis unvollständig.'));
            }

            $values = [];
            foreach ($tag as $value) {
                if (! is_string($value)) {
                    self::deny(__('Ausweis unvollständig.'));
                }
                $values[] = $value;
            }

            $tags[] = $values;
        }

        return [
            'id' => $decoded['id'],
            'pubkey' => $decoded['pubkey'],
            'created_at' => $decoded['created_at'],
            'kind' => $decoded['kind'],
            'tags' => $tags,
            'content' => $decoded['content'],
            'sig' => $decoded['sig'],
        ];
    }

    /**
     * Erster Wert des ersten Tags mit diesem Namen.
     *
     * @param  Nip98Event  $event
     */
    private static function tag(array $event, string $name): ?string
    {
        foreach ($event['tags'] as $tag) {
            if (($tag[0] ?? null) === $name) {
                return $tag[1] ?? null;
            }
        }

        return null;
    }

    /**
     * @throws HttpResponseException
     */
    private static function deny(string $message): never
    {
        throw new HttpResponseException(response()->json(['message' => $message], 401));
    }
}
