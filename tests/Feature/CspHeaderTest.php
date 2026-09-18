<?php

/*
    CSP der Chat-Plattform (ContentSecurityPolicy-Middleware). Getestet wird der
    Header-Vertrag, den die Middleware auf jedes group.*-Dokument schreibt —
    nicht die Browser-Durchsetzung selbst.
*/

test('CSP erlaubt Blossom-Medien: media-src https, data und blob', function () {
    $response = $this->get(route('group.start'));

    $response->assertOk();
    $policy = $response->headers->get('Content-Security-Policy');

    expect($policy)->not->toBeNull()
        ->and($policy)->toContain('media-src https: data: blob:');
});

test('CSP-Grundhärtung bleibt unangetastet', function () {
    $policy = $this->get(route('group.start'))->headers->get('Content-Security-Policy');

    expect($policy)
        ->toContain("default-src 'self'")
        ->toContain("object-src 'none'")
        ->toContain("frame-ancestors 'none'")
        ->toContain('img-src * data: blob:');
});
