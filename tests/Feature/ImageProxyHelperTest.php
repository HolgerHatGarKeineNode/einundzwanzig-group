<?php

use Einundzwanzig\Group\ImageProxy;

test('web-Zweig baut eine relative Proxy-URL', function () {
    config(['nativephp-internal.running' => false]);

    expect(ImageProxy::url('https://img/w.png'))
        ->toBe('/img/avatar?src='.rawurlencode('https://img/w.png'));
});

test('mobile-Zweig baut eine absolute Proxy-URL gegen den Web-Host', function () {
    config(['nativephp-internal.running' => true]);

    expect(ImageProxy::url('https://img/w.png'))
        ->toStartWith('https://group.einundzwanzig.space/img/avatar?src=');
});

test('nicht-http bleibt unangetastet (data:/leer)', function () {
    expect(ImageProxy::url('data:image/png;base64,AAAA'))->toBe('data:image/png;base64,AAAA')
        ->and(ImageProxy::url(null))->toBe('')
        ->and(ImageProxy::url(''))->toBe('');
});
