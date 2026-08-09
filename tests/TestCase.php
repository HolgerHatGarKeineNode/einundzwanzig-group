<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    /**
     * Der Test-Client spricht Deutsch.
     *
     * Seit P2 verhandelt `SetLocale` die Oberflächensprache über `Accept-Language`,
     * wenn kein Sprach-Cookie gesetzt ist. Symfony stempelt in `Request::create()`
     * unabänderlich `HTTP_ACCEPT_LANGUAGE: en-us,en;q=0.5` in JEDEN Testrequest —
     * damit rendert die ganze Suite auf Englisch, und 16 Bestandstests, die
     * deutschen Text erwarten, wurden rot (gemessen 2026-08-09, u.a.
     * SettingsMergeTest, ThemeAndA11yTest, AppShellChassisTest).
     *
     * Das ist kein Testfehler, sondern ein fehlendes Testdatum: `APP_LOCALE=de`
     * in der phpunit.xml sagt „diese App spricht Deutsch", der Client sagte
     * bislang das Gegenteil. Hier steht die Client-Seite derselben Aussage.
     *
     * Ein Test, der eine ANDERE Sprache prüfen will, überschreibt das pro Fall:
     * `$this->withHeader('Accept-Language', 'es-ES,es;q=0.9')` oder
     * `$this->withUnencryptedCookie(SetLocale::COOKIE, 'es')` (das Cookie sticht
     * den Header, siehe SetLocale::resolve()).
     */
    protected function setUp(): void
    {
        parent::setUp();

        $this->withHeader('Accept-Language', 'de-DE,de;q=0.9');
    }
}
