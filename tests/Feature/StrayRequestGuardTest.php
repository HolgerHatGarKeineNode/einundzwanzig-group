<?php

use Illuminate\Http\Client\StrayRequestException;
use Illuminate\Support\Facades\Http;

/**
 * The control for the rule "no test leaves the machine" (the `beforeEach` of the Feature
 * group in `tests/Pest.php`). A guard that never fires looks exactly like a clean suite.
 */
it('stops an HTTP request that has no fake', function () {
    Http::get('https://portal.einundzwanzig.space/api/mobile/meetups');
})->throws(StrayRequestException::class);

it('lets a faked request through', function () {
    Http::fake(['portal.test/*' => Http::response(['ok' => true])]);

    expect(Http::get('https://portal.test/api/x')->json('ok'))->toBeTrue();
});
