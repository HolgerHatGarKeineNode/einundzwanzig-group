<?php

declare(strict_types=1);

use Einundzwanzig\Group\Http\Middleware\SetLocale;
use Illuminate\Support\Js;
use Illuminate\Testing\TestResponse;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

/**
 * P5 — Vereins-Onboarding. Geprüft wird hier ausschliesslich, was der SERVER
 * entscheidet; der Rest der Strecke (Signieren, Zahlen, Warten) lebt in der
 * Alpine-Insel und gehört nach Playwright bzw. in die reinen `node --test`-Fälle
 * neben `js/vereinFlow.ts`.
 *
 * Server-Entscheidungen sind es genau vier:
 *   1. Führt das Vereins-Gate nach INNEN oder nach aussen? (`verein_api_url`)
 *   2. Setzt der Rücksprung aus dem Checkout im WARTEZUSTAND ab?
 *   3. Trägt das Dokument die Vereins-Basis-URL — und NICHT den `X-Api-Key`?
 *   4. Steht die Wartezeit als KONFIGURIERTER Wert im Dokument statt als Text
 *      im Markup?
 *
 * Dazu kommt ein Markup-Vertrag, der nicht in Playwright gehört, weil er ohne
 * Browser entscheidbar ist: **ein Lesefehler darf nicht als „kein Mitglied"
 * gemalt werden.** Die Aussage hat zwei Hälften. Die eine ist der
 * Schritt-Entscheid (`vereinView`, per `node --test` gegen ALLE Eingaben
 * geprüft, `js/vereinFlow.test.ts`); die andere ist, dass das Markup die
 * Aussage über die Mitgliedschaft auch wirklich nur an die Stufe hängt, die
 * eine gelesene Mitgliederliste voraussetzt. Genau das prüfen die Fälle unten —
 * eine Behauptung im falschen Zweig wäre sonst ein Fehler, den kein Typ und kein
 * Unit-Test sieht.
 */

/** Beliebiger 64-hex-Pubkey für eine „angemeldete" Session (Server-Gate, kein Signer). */
function vereinFakeSessionPubkey(): string
{
    return str_repeat('c', 64);
}

/**
 * @param  TestResponse<Response>  $res
 */
function vereinHtml(TestResponse $res): string
{
    $content = $res->getContent();

    if ($content === false) {
        throw new RuntimeException('Response::getContent() lieferte false — die Antwort hat keinen Body.');
    }

    return $content;
}

/**
 * Ein Aufruf als „angemeldeter" Nutzer.
 *
 * Der TestCase wird hereingereicht statt über Pests `test()` geholt: `test()`
 * ist als `TestCall|HigherOrderTapProxy` typisiert, und `withSession()` steht
 * auf keinem von beiden — PHPStan (Level 7, analysiert auch `tests/`) hat das
 * zu Recht beanstandet. `$this` in einer Pest-Closure IST der TestCase.
 *
 * @param  array<string, string>  $headers
 * @return TestResponse<Response>
 */
function vereinGet(TestCase $test, string $url, bool $follow = false, array $headers = [], ?string $locale = null): TestResponse
{
    $pending = $test->withSession(['nostr_pubkey' => vereinFakeSessionPubkey()]);

    // Die Sprache kommt ueber das `locale`-Cookie, nicht ueber `Accept-Language`:
    // seit dem 2026-08-13 entscheidet der Browser-Header NICHT mehr (Entscheidung
    // des Nutzers, siehe `SetLocale`). Das Cookie ist die ausdrueckliche Wahl und
    // der einzige Weg, im Test eine andere Oberflaechensprache zu erzwingen.
    // `app()->setLocale()` vorher zu setzen hilft nicht — `SetLocale` laeuft in
    // der `web`-Gruppe und ueberschreibt es bei jedem Request.
    if ($locale !== null) {
        $pending = $pending->withUnencryptedCookie(SetLocale::COOKIE, $locale);
    }

    return $follow ? $pending->followingRedirects()->get($url, $headers) : $pending->get($url, $headers);
}

/**
 * Der `window.__nostrVerein`-Block genau so, wie Blades `@js` ihn schreibt.
 *
 * `@js` liefert kein rohes JSON, sondern `JSON.parse('…')` mit `"` als `"`
 * — ein Vergleich gegen `"activationMinutes":1440` ginge deshalb IMMER daneben,
 * und zwar ohne dass am Markup etwas falsch wäre. Die Erwartung wird darum mit
 * demselben Werkzeug gebaut, das auch das Markup baut.
 *
 * @param  array<string, mixed>  $overrides
 */
function vereinIslandConfig(array $overrides = []): string
{
    return (string) Js::from(array_replace([
        'api' => 'https://verein.example.test',
        'proxy' => '',
        'activationMinutes' => 1440,
        'publicUrl' => 'https://verein.einundzwanzig.space/',
    ], $overrides));
}

beforeEach(function () {
    config()->set('group.verein_api_url', 'https://verein.example.test');
    config()->set('group.verein_activation_minutes', 1440);
});

// ── 1. Gate: Weg nach innen statt Link nach aussen ───────────────────────────

test('mit konfigurierter Vereins-API führt das Gate in den Flow, nicht nach draussen', function () {
    $html = vereinHtml(vereinGet($this, route('group.spaces'))->assertOk());

    expect($html)->toContain('data-testid="verein-gate-beitreten"')
        ->and($html)->toContain(route('group.verein.join'))
        ->and($html)->not->toContain('data-testid="verein-gate-extern"');
});

test('ohne konfigurierte Vereins-API bleibt der ehrliche Weg nach draussen', function () {
    // Ohne Basis-URL könnte die Insel den `u`-Tag nicht auf den Verein setzen —
    // jeder Aufruf endete im 503 des Proxys. Ein Knopf, der zuverlässig
    // scheitert, wäre schlechter als der Link, der funktioniert.
    config()->set('group.verein_api_url', '');

    $html = vereinHtml(vereinGet($this, route('group.spaces'))->assertOk());

    expect($html)->toContain('data-testid="verein-gate-extern"')
        ->and($html)->not->toContain('data-testid="verein-gate-beitreten"');
});

test('beide bestehenden Einbindungen des Gates tragen den neuen Weg', function () {
    // Das Gate steht auf `/spaces` UND `/directory`. Eine Änderung an der
    // Komponente, die nur eine der beiden bedient, wäre ein halber Umbau.
    foreach ([route('group.spaces'), route('group.directory')] as $url) {
        expect(vereinHtml(vereinGet($this, $url)->assertOk()))
            ->toContain('data-testid="verein-gate-beitreten"');
    }
});

// ── 2. Rücksprung aus dem Checkout ───────────────────────────────────────────

test('die Rücksprung-Route zeigt auf den Flow im Wartezustand', function () {
    vereinGet($this, '/verein/zurueck')->assertRedirect('/verein/beitritt?schritt=warten');
});

test('der Rücksprung setzt die Insel im Wartezustand ab, nicht am Anfang', function () {
    // `nostrVerein(true)` = die Insel startet im Wartezustand, ohne auf `/me` zu
    // warten. Ohne das sähe der Nutzer nach der Zahlung für einen Moment wieder
    // den Zahlschritt — mit einem Knopf, der eine zweite Rechnung aus einem
    // Kontingent von drei pro Tag zöge.
    $html = vereinHtml(vereinGet($this, '/verein/zurueck', follow: true)->assertOk());

    expect($html)->toContain('nostrVerein(true)');
});

test('der normale Einstieg startet NICHT im Wartezustand', function () {
    // Gegenprobe zum Fall darüber: ohne den Parameter darf die Insel nicht
    // behaupten, es sei bereits gezahlt worden.
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->toContain('nostrVerein(false)')
        ->and($html)->not->toContain('nostrVerein(true)');
});

test('Flow und Rücksprung liegen hinter dem Nostr-Gate', function () {
    // Ohne Session-Pubkey ist der Beitritt kein offener Pfad — beide Routen
    // liegen in derselben `nostr.auth`-Gruppe wie der Rest des Clients.
    $this->get(route('group.verein.join'))->assertRedirect();
    $this->get('/verein/zurueck')->assertRedirect();
});

// ── 3. Ein Lesefehler ist kein „kein Mitglied" ───────────────────────────────

test('die Aussage über die Mitgliedschaft hängt AUSSCHLIESSLICH an der Stufe mit gelesener Liste', function () {
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    $satz = 'Du bist noch nicht freigeschaltet.';

    // (a) Genau EIN Vorkommen — sonst könnte eine zweite Stelle dieselbe
    //     Behauptung unter einer anderen Bedingung aufstellen.
    expect(substr_count($html, $satz))->toBe(1);

    // (b) Dieses eine Vorkommen liegt INNERHALB des Zweigs `freischaltung` —
    //     vom Marker bis zum nächsten `</template>`.
    $start = mb_strpos($html, 'data-testid="verein-warten-freischaltung"');
    expect($start)->not->toBeFalse();

    $ende = mb_strpos($html, '</template>', (int) $start);
    expect($ende)->not->toBeFalse();

    $zweig = mb_substr($html, (int) $start, (int) $ende - (int) $start);
    expect($zweig)->toContain($satz);

    // (c) Und dieser Zweig hängt an der Bedingung `stage === 'freischaltung'` —
    //     die `vereinView` nur mit `dirReady === true` erreicht (per `node --test`
    //     gegen ALLE Eingaben belegt, js/vereinFlow.test.ts). Geprüft wird das
    //     unmittelbar öffnende `<template>` vor dem Marker.
    $davor = mb_substr($html, 0, (int) $start);
    $letztesTemplate = mb_strrpos($davor, '<template');
    expect($letztesTemplate)->not->toBeFalse();
    expect(mb_substr($davor, (int) $letztesTemplate))->toContain("stage === 'freischaltung'");
});

test('ein gescheiterter Lesevorgang bekommt einen eigenen Zweig — mit Ausweg statt Behauptung', function () {
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->toContain("stage === 'lesefehler'")
        ->and($html)->toContain('data-testid="verein-warten-lesefehler"')
        ->and($html)->toContain('Zugang konnte nicht geprüft werden')
        // Der Satz, der die Verwechslung ausdrücklich ausschliesst.
        ->and($html)->toContain('Das sagt nichts über deine Mitgliedschaft')
        // Der Ausweg: von Hand nachfassen (löst Reconnect + neuen Lesevorgang aus).
        ->and($html)->toContain('data-testid="verein-jetzt-pruefen"');
});

test('ein noch laufender Lesevorgang bekommt ebenfalls einen eigenen Zweig', function () {
    // Die dritte Möglichkeit neben „gelesen" und „gescheitert": noch unterwegs.
    // Ohne sie fiele „noch nicht gelesen" mit einer der beiden anderen zusammen.
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->toContain("stage === 'zugang-pruefen'")
        ->and($html)->toContain('data-testid="verein-warten-pruefen"')
        ->and($html)->toContain('Dein Zugang wird gerade geprüft.');
});

test('der Flow behauptet an keiner Stelle unbedingt „kein Vereinsmitglied"', function () {
    // Die Formulierung des GATES darf auf dem Flow-Screen nicht auftauchen: dort
    // ist sie an `isVereinGatedOut` gebunden (das `ready` verlangt), hier hätte
    // sie diese Bindung nicht.
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->not->toContain('Noch kein Vereinsmitglied');
});

// ── 4. Wartezeit: ein konfigurierter Wert, kein Text im Markup ───────────────

test('die Wartezeit steht als Zahl im Dokument und nirgends als Satz im Markup', function () {
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->toContain(vereinIslandConfig())
        // Kein literaler Zeitraum im Markup — sonst müsste nach P1 ein Text
        // umgeschrieben werden statt eines Wertes.
        ->and($html)->not->toContain('24 Stunden')
        ->and($html)->not->toContain('bis zu 24');
});

test('ein anderer konfigurierter Wert schlägt ohne Markup-Änderung durch', function () {
    // Das ist die eigentliche Zusicherung: nach P1 wird EIN Wert umgestellt.
    config()->set('group.verein_activation_minutes', 15);

    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->toContain(vereinIslandConfig(['activationMinutes' => 15]))
        ->and($html)->not->toContain(vereinIslandConfig(['activationMinutes' => 1440]));
});

test('der Wartezustand nennt bei jedem Übergang eine Dauer und die Zusage ohne offene App', function () {
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    // Der Dauer-Block liegt im Wartezustand ausserhalb der Stufen-Zweige und
    // gilt damit für jede Stufe.
    expect($html)->toContain('data-testid="verein-wartezeit"')
        ->and($html)->toContain('Du kannst die App schließen — der Zugang kommt auch dann.')
        // Fallback, wenn keine Dauer konfiguriert ist: „in Kürze" statt „0 Minuten".
        ->and($html)->toContain('Das dauert in der Regel nur kurz.');
});

// ── 5. Was in den Browser darf — und was nicht ───────────────────────────────

test('das Dokument trägt die Vereins-Basis-URL, aber niemals den Client-Schlüssel', function () {
    config()->set('verein.api_key', 'streng-geheimes-testsekret');

    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    expect($html)->toContain(vereinIslandConfig())
        ->and($html)->toContain('verein.example.test')
        ->and($html)->not->toContain('streng-geheimes-testsekret')
        ->and($html)->not->toContain('X-Api-Key');
});

// ── 6. Alle Texte über __() ──────────────────────────────────────────────────

test('die Texte des Flows laufen durch __() und nicht als Literale ins Markup', function () {
    // Belegt an zwei Schlüsseln, die im Katalog stehen: erschienen sie auf
    // Englisch nicht übersetzt, wären sie hartkodiert. Die übrigen Schlüssel
    // sind neu und lösen bewusst auf den deutschen Quelltext auf (kein `de.json`,
    // Nicht-de fällt auf den Key zurück) — das ist der vorgesehene Zustand für
    // Texte, die noch durch die Gestaltung gehen.
    //
    // Die Sprache kommt über das `locale`-Cookie — siehe Kopf von `vereinGet()`.
    $html = vereinHtml(vereinGet($this, route('group.verein.join'), locale: 'en')->assertOk());

    expect($html)->toContain('Cancel')
        ->and($html)->toContain('To the rooms')
        ->and($html)->not->toContain('>Abbrechen<');
});

test('die vier reaktiven Sätze stehen als GANZER Satz in der Insel, nicht als Fragment im Markup', function () {
    /*
     * Vier Sätze waren in Stücken gebaut, weil ein reaktives `<span x-text>`
     * mitten im Satz saß:
     *
     *     {{ __('Bitte noch') }} <span x-text="error.retryAfter"></span> {{ __('Sekunden warten.') }}
     *
     * Deutsch liest sich das richtig — für jede andere Sprache ist es unlösbar:
     * der Übersetzer bekommt zwei Einträge und kann weder die Wortstellung
     * ändern noch den Kasus wählen, weil beides von dem abhängt, was dazwischen
     * steht, und das sieht er nie. Belegt an den ausgelieferten Katalogen:
     * Polnisch braucht für 2/3/4 eine andere Form als für 5–21, Lettisch für
     * alles auf 1 (außer 11) eine andere als für den Rest.
     *
     * Dieser Fall prüft die BAUFORM, wie der Wallet/Checkout-Fall darunter: Die
     * Fläche fragt die Insel nach dem fertigen Satz, und sie setzt ihn nirgends
     * mehr selbst zusammen. Der Satz selbst und seine Füllung sind eine Ebene
     * tiefer geprüft (`js/vereinFlow.test.ts`), die Kataloge in
     * `GroupI18nTest.php`.
     */
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    // Die Fläche fragt nach dem fertigen Satz …
    foreach (['retryLine()', 'charCountLine()'] as $call) {
        expect(str_contains($html, 'x-text="'.$call.'"'))->toBeTrue("Der Haken {$call} fehlt im Markup");
    }

    /*
     * … zwei davon in Stücken, weil in ihnen ein Teilstück ausgezeichnet wird
     * (`font-medium` auf Fassung und Datum, `font-semibold` auf der Dauer).
     * Geteilt wird trotzdem nicht der KATALOG, sondern erst das Ergebnis von
     * `t()` — an den Platzhaltern, die in jeder Sprache dieselben sind. Der
     * Übersetzer sieht weiterhin einen ganzen Satz; darauf sehen die Fälle in
     * `GroupI18nTest.php` und `js/vereinFlow.test.ts`.
     */
    foreach (['statutesSegments()', 'waitSegments()'] as $call) {
        expect(str_contains($html, 'in '.$call.'"'))->toBeTrue("Der Haken {$call} fehlt im Markup");
    }

    /*
     * … und baut ihn nirgends mehr selbst zusammen. Geprüft wird der ROHE Wert
     * im `x-text` und nicht der deutsche Text drumherum: „Zeichen" und „Fassung"
     * kommen anderswo auf der Seite in gültiger Verwendung vor, diese fünf
     * Ausdrücke dagegen gab es NUR in den zerstückelten Sätzen.
     */
    foreach (['x-text="error.retryAfter"', 'x-text="applicationText.length"', 'x-text="applicationTextMax"', 'x-text="waitText"', 'statutesVersion ||'] as $split) {
        expect(str_contains($html, $split))->toBeFalse("Das Fragment {$split} ist zurück");
    }

    // Und im Markup steht kein Fragment-Schlüssel mehr.
    $blade = (string) file_get_contents(dirname(__DIR__, 2).'/packages/einundzwanzig-group/resources/views/⚡verein.blade.php');

    foreach (['Bitte noch', 'Sekunden warten.', 'Fassung', 'beschlossen am', 'Zeichen', 'Das dauert'] as $fragment) {
        expect(str_contains($blade, "__('".$fragment."')"))
            ->toBeFalse("Fragment-Schlüssel __('{$fragment}') steht wieder im Markup");
    }

    /*
     * Und der Preis für die zurückgeholten Auszeichnungen ist NICHT `x-html`.
     *
     * Das ist der eigentliche Riegel dieses Falls: `statutesSegments()` liefert
     * Stücke, in denen `version` und `date` stehen — beides Werte aus
     * `GET /config`, also Daten der Gegenseite. Als `x-html` gerendert wäre
     * jedes davon eine Injektionsfläche, und der Weg dorthin ist genau eine
     * bequeme Zeile weit. Deshalb steht die Zusicherung hier und nicht in einem
     * Kommentar: im gesamten Vereins-Markup kommt `x-html` nicht vor.
     *
     * Die Blade-Kommentare werden VORHER entfernt, und das ist keine Kosmetik:
     * die Begründung dieser Bauform steht als Kommentar in derselben Datei und
     * nennt `x-html` beim Namen. Ein Fall, der die Prosa mitmisst, wäre schon
     * beim ersten Lauf rot gewesen — er hätte die eigene Begründung als Befund
     * gemeldet und wäre danach entschärft worden statt geschärft.
     */
    $markup = (string) preg_replace('/\{\{--.*?--\}\}/s', '', $blade);

    expect(str_contains($markup, 'x-html'))->toBeFalse('x-html ist im Vereins-Markup zurück');
});

test('der ganze Satz kommt auch wirklich im Browser an — im Katalog der aktiven Sprache', function () {
    /*
     * Die Ersetzung passiert in der Insel, nicht in Blade (`__()` würde
     * serverseitig füllen und den reaktiven Wert einfrieren). Damit hängt der
     * Satz am ausgelieferten Katalog — fehlt er dort, fällt die Fläche STILL
     * auf Deutsch zurück, mitten in einer englischen Seite.
     *
     * Das `locale`-Cookie statt `app()->setLocale()`: `SetLocale` läuft in der
     * `web`-Gruppe und überschreibt die Locale bei jedem Request.
     */
    $html = vereinHtml(vereinGet($this, route('group.verein.join'), locale: 'en')->assertOk());

    /*
     * Der Zeichenzähler wird ohne seinen Schrägstrich geprüft: `@js` schreibt
     * den Katalog als `JSON.parse('…')` und escapt dabei ZWEIMAL — aus „/" wird
     * „\\\/". Diese Kodierung ist eine Eigenheit des Ausgabewerkzeugs und keine
     * Aussage über die Übersetzung; sie hier festzuschreiben hieße, den Test bei
     * jeder Änderung an `@js` rot zu machen, ohne dass am Katalog etwas fehlt.
     */
    foreach (['Please wait another :seconds sec.', 'Version :version, adopted on :date', ':max characters', 'This takes :duration.'] as $sentence) {
        expect(str_contains($html, $sentence))->toBeTrue("„{$sentence}\" fehlt im ausgelieferten en-Katalog");
    }
});

// ── 7. Eine Wahrheitsquelle für die Wallet/Checkout-Weiche ───────────────────

test('die Zahlweg-Weiche steht nur EINMAL — im geprüften Reduzierer, nicht im Markup', function () {
    /*
     * Die Regel „in der App zahlen braucht BOLT11 und Wallet" stand zweimal da:
     * in `canPayInApp` (`js/vereinFlow.ts`, über alle 2^10 Eingaben geprüft) und
     * als `bolt11 && hasWallet` direkt im Markup. Beide sagten dasselbe — bis
     * eine von beiden sich ändert.
     *
     * Geschützt war nur die eine: eine Mutation an `canPayInApp` traf keinen
     * einzigen Fall, weil die Fläche die Frage selbst beantwortete. Aufgefallen
     * ist das erst, als jemand genau diese Mutation als Kalibrierung setzen wollte.
     *
     * Dieser Fall ist der Riegel dagegen, dass die Doppelung zurückkommt: er
     * prüft die Bauform, nicht das Verhalten (das tun die E2E-Fälle). Ein
     * wieder eingesetztes `bolt11 && hasWallet` wäre sofort rot — und zwar hier,
     * in der billigsten Schicht, nicht erst im Browser.
     */
    $html = vereinHtml(vereinGet($this, route('group.verein.join'))->assertOk());

    // Die Fläche fragt die Insel …
    expect(substr_count($html, 'payInApp()'))->toBe(4);

    // … und beantwortet die Frage nirgends selbst.
    expect($html)->not->toContain('bolt11 && hasWallet')
        ->and($html)->not->toContain('bolt11 &amp;&amp; hasWallet')
        ->and($html)->not->toContain('!hasWallet');
});
