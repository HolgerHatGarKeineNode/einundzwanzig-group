<?php

use Einundzwanzig\Group\Nostr\ProfileCache;
use Illuminate\Support\Facades\Cache;

// `\stdClass` statt `object`: ein `(object)`-Cast IST ein stdClass, und `ProfileCache`
// verspricht diesen Typ. Als `object` deklariert war der Rückgabewert unschärfer als
// der Wert selbst — das fiel erst auf, als ihn ein typisierter Parameter entgegennahm.
function fakeProfileEvent(string $pubkey): stdClass
{
    return (object) [
        'id' => str_repeat('a', 64),
        'pubkey' => $pubkey,
        'created_at' => 1_700_000_000,
        'kind' => 0,
        'tags' => [],
        'content' => '{"name":"Test"}',
        'sig' => str_repeat('b', 128),
    ];
}

it('returns cached profiles without fetching', function () {
    $pk = str_repeat('1', 64);
    Cache::put(ProfileCache::cacheKey($pk), fakeProfileEvent($pk), 60);

    $events = (new ProfileCache)->get([$pk]);

    expect($events)->toHaveCount(1)
        ->and($events[0]->pubkey)->toBe($pk);
});

it('skips known-absent profiles (false sentinel) without refetching', function () {
    $pk = str_repeat('2', 64);
    Cache::put(ProfileCache::cacheKey($pk), false, 60);

    expect((new ProfileCache)->get([$pk]))->toBe([]);
});

it('ignores malformed pubkeys (no fetch, no crash)', function () {
    expect((new ProfileCache)->get(['nothex', 'ABC', str_repeat('z', 64)]))->toBe([]);
});

it('rejects a non-canonical uppercase pubkey (NIP-01 requires lowercase hex)', function () {
    // Eigener Block statt Erweiterung der malformed-Liste oben: die Absicht ist eine
    // andere ("kanonische Kleinschreibung erzwungen" statt "Muell wird ignoriert") und
    // war bislang ungetestet — die vorhandenen Negativfaelle scheitern alle aus einem
    // ANDEREN Grund (zu kurz / kein Hex-Zeichen), keiner davon ist 64-stellig UND nur
    // groszgeschrieben. Ohne diese Bedingung im Regex entstuenden fuer denselben
    // Schluessel zwei Cache-Eintraege (Grosz-/Kleinschreibung) und Relay-Anfragen fuer
    // nicht-kanonische Keys.
    //
    // Ein Event unter dem GROSZGESCHRIEBENEN Schluessel vorzucachen ist Absicht, nicht
    // Zufall: nur so unterscheidet die Assertion "Filter laesst durch" von "Filter
    // blockiert" — ohne Vorbelegung waere das Ergebnis in BEIDEN Faellen [], weil der
    // Fetch-Pfad fuer einen unbekannten Pubkey ohnehin nichts liefert (kein Relay kennt
    // ihn) und die Assertion nie sensitiv fuer die Mutation waere.
    $upper = str_repeat('A', 64);
    Cache::put(ProfileCache::cacheKey($upper), fakeProfileEvent($upper), 60);

    expect((new ProfileCache)->get([$upper]))->toBe([]);
});

it('endpoint returns cached events as json', function () {
    $pk = str_repeat('3', 64);
    Cache::put(ProfileCache::cacheKey($pk), fakeProfileEvent($pk), 60);

    $this->getJson('/nostr/profiles?pubkeys='.$pk)
        ->assertOk()
        ->assertJsonPath('events.0.pubkey', $pk);
});

it('endpoint handles empty pubkeys', function () {
    $this->getJson('/nostr/profiles?pubkeys=')
        ->assertOk()
        ->assertExactJson(['events' => []]);
});

it('namespaces the cache per relay source set (absence is source-dependent)', function () {
    $pk = str_repeat('4', 64);

    // „Bei DIESEN Relays nicht gefunden" ist keine Aussage ueber eine andere
    // Relay-Menge. Der Store ist geteilt (E2E-Worker + Dev-App schreiben hinein),
    // deshalb muss die Quelle im Schluessel stehen.
    config()->set('group.profile_indexer', 'wss://indexer-a.test/');
    $keyA = ProfileCache::cacheKey($pk);

    config()->set('group.profile_indexer', 'wss://indexer-b.test/');
    $keyB = ProfileCache::cacheKey($pk);

    expect($keyA)->not->toBe($keyB)
        ->and($keyA)->toStartWith('nostr:profile:')
        ->and($keyA)->toEndWith(':'.$pk);
});

it('does not consult the public indexer when it is configured empty', function () {
    config()->set('group.profile_indexer', '');
    $pk = str_repeat('5', 64);

    // Abwesenheit unter dem LEEREN-Indexer-Schluessel vorbelegen: `get()` darf
    // damit auskommen und keinen Relay anfassen (waere sonst ein Netzzugriff im Test).
    Cache::put(ProfileCache::cacheKey($pk), false, 60);

    expect((new ProfileCache)->get([$pk]))->toBe([]);
});

// ── Abwesenheit: kurze, wachsende Frist statt 24 h ohne Invalidierung ──────────────
//
// Ein einzelner Fehlversuch — ein Indexer, der gerade nicht antwortet — blendete einen
// Pubkey bis hierher für einen ganzen Tag aus dem First Paint aus. Gemessen genau das
// beim Eigentümer des Vereins, dessen kind 0 `purplepag.es` durchgehend ausliefert.
//
// `fetchProfiles` ist die Testnaht (siehe dort): kein Relay im Testlauf, und der
// gesamte Kreislauf — lesen, Frist prüfen, erneut versuchen, Treffer schreiben — läuft
// trotzdem durch den echten Code.

/**
 * ProfileCache mit gestelltem Relay-Ergebnis; zählt, WANN überhaupt gefragt wird.
 *
 * Benannte Klasse statt einer anonymen: eine anonyme ist für den Analysator nur ein
 * `object`, und jeder Zugriff auf `abfragen`/`get()` wäre ein Fehler in `types:check`.
 */
class FakeProfileCache extends ProfileCache
{
    /** @var array<int, array<int, string>> Die pubkey-Listen, mit denen gefragt wurde. */
    public array $abfragen = [];

    /** @param  array<string, stdClass>  $antwort Was die Relays angeblich liefern. */
    public function __construct(private array $antwort = []) {}

    /**
     * @param  array<int, string>  $pubkeys
     * @return array<string, stdClass>
     */
    protected function fetchProfiles(array $pubkeys): array
    {
        $this->abfragen[] = $pubkeys;

        return array_intersect_key($this->antwort, array_flip($pubkeys));
    }
}

/**
 * Ein Fehlversuchs-Protokoll, wie `get()` es schreibt.
 *
 * @return array{attempts: int, retry_after: int}
 */
function missRecordAt(int $attempts, int $retryAfter): array
{
    return ['attempts' => $attempts, 'retry_after' => $retryAfter];
}

it('wartet nach dem ersten Fehlversuch 60 s und verdoppelt danach, gedeckelt bei 24 h', function () {
    // Die Frist ist die eigentliche Entscheidung — deshalb direkt geprüft und nicht
    // nur über ihre Wirkung.
    expect(ProfileCache::missBackoffSeconds(1))->toBe(60)
        ->and(ProfileCache::missBackoffSeconds(2))->toBe(120)
        ->and(ProfileCache::missBackoffSeconds(3))->toBe(240)
        // 60·2^10 = 61440 s — der letzte Wert UNTER dem Deckel. Diese Zeile stand
        // zuerst auf 86400, weil ich mich um einen Schritt verzählt hatte; die
        // Begründung in `ProfileCache` nennt jetzt dieselbe Zahl wie der Test.
        ->and(ProfileCache::missBackoffSeconds(11))->toBe(61440)
        ->and(ProfileCache::missBackoffSeconds(12))->toBe(86400)
        ->and(ProfileCache::missBackoffSeconds(13))->toBe(86400)
        // Kein Float-Überlauf bei absurd vielen Versuchen (2**($n-1) verlässt sonst int).
        ->and(ProfileCache::missBackoffSeconds(200))->toBe(86400);
});

it('erzeugt aus einem nie auflösbaren Pubkey KEINEN Dauer-Poll auf die Indexer', function () {
    // Der Normalfall, den `sources()` erzwingt: ein Pubkey mit Profil nur im Workspace
    // ist hier IMMER ein Fehlversuch. Für ihn zählt die Obergrenze der Abfragen.
    $verstrichen = 0;
    $versuche = 0;
    while ($verstrichen < 86400) {
        $versuche++;
        $verstrichen += ProfileCache::missBackoffSeconds($versuche);
    }

    // Elf Abfragen am ersten Tag, danach eine pro Tag wie bisher — nie mehr
    // Dauerlast als vor dieser Änderung. Die Zahl steht so auch in der Begründung
    // in `ProfileCache`; hier ist sie nachgerechnet statt behauptet.
    expect($versuche)->toBe(11);
});

it('blendet einen Pubkey nach EINEM Fehlversuch nicht dauerhaft aus', function () {
    $pk = str_repeat('6', 64);
    // Ein Fehlversuch, seine Frist ist abgelaufen (im Betrieb: 60 s später).
    Cache::put(ProfileCache::cacheKey($pk), missRecordAt(1, time() - 1), 600);

    $cache = new FakeProfileCache;
    $cache->get([$pk]);

    // Der Kern: es wird ÜBERHAUPT wieder gefragt. Vorher lag hier `false` und der
    // Pubkey war für 24 h unsichtbar, egal was die Relays inzwischen ausliefern.
    expect($cache->abfragen)->toBe([[$pk]]);

    // Und der zweite Fehlversuch wartet länger als der erste.
    $record = Cache::get(ProfileCache::cacheKey($pk));
    expect($record['attempts'])->toBe(2)
        ->and($record['retry_after'])->toBeGreaterThanOrEqual(time() + 119);
});

it('fragt INNERHALB der Frist nicht erneut (kein Sturm auf die Indexer)', function () {
    $pk = str_repeat('7', 64);
    Cache::put(ProfileCache::cacheKey($pk), missRecordAt(1, time() + 30), 600);

    $cache = new FakeProfileCache;

    expect($cache->get([$pk]))->toBe([])
        ->and($cache->abfragen)->toBe([]);
});

it('ersetzt das Fehlversuchs-Protokoll durch den Treffer, sobald das Profil auftaucht', function () {
    $pk = str_repeat('8', 64);
    // Drei Fehlversuche liegen hinter uns, die Frist ist um.
    Cache::put(ProfileCache::cacheKey($pk), missRecordAt(3, time() - 1), 600);

    $cache = new FakeProfileCache([$pk => fakeProfileEvent($pk)]);
    $events = $cache->get([$pk]);

    expect($events)->toHaveCount(1)
        ->and($events[0]->pubkey)->toBe($pk);

    // Die Invalidierung ist keine eigene Operation, die man vergessen kann: der
    // Treffer überschreibt den Eintrag. Ein zweiter Aufruf fasst kein Relay mehr an.
    $zweiter = new FakeProfileCache;
    expect($zweiter->get([$pk]))->toHaveCount(1)
        ->and($zweiter->abfragen)->toBe([]);
});

it('behandelt Alt-Einträge (`false`) weiter als abwesend, statt sie alle auf einmal nachzufassen', function () {
    // Beim Ausrollen liegen bis zu 24 h lang Einträge der alten Form im geteilten
    // Store. Sie sofort zu ignorieren hieße: ein Deploy löst einen Ansturm auf die
    // Indexer aus. Sie laufen von selbst aus, danach gilt die neue Frist.
    $pk = str_repeat('9', 64);
    Cache::put(ProfileCache::cacheKey($pk), false, 600);

    $cache = new FakeProfileCache([$pk => fakeProfileEvent($pk)]);

    expect($cache->get([$pk]))->toBe([])
        ->and($cache->abfragen)->toBe([]);
});
