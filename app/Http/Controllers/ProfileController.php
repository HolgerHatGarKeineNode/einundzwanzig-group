<?php

namespace App\Http\Controllers;

use Einundzwanzig\Group\Nostr\ProfileCache;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Geteilter Profil-Cache-Endpunkt (PLAN4): liefert gecachte kind-0-Events für die
 * angefragten pubkeys, damit die Insel Namen/Avatare beim First-Paint sofort seedet
 * (welshman überschreibt live). Öffentlich, GET, kein AUTH — kind 0 ist public.
 * Mobile ruft (wie beim Bild-Proxy) den gehosteten Endpunkt → geteilter Cache.
 */
class ProfileController extends Controller
{
    public function __invoke(Request $request, ProfileCache $cache): JsonResponse
    {
        $pubkeys = array_slice(
            array_filter(explode(',', (string) $request->query('pubkeys', ''))),
            0,
            100,
        );

        // CORS: die Native-WebView-Insel ruft diesen Endpunkt cross-origin von
        // `http://127.0.0.1` (bzw. capacitor/ionic) aus. kind-0 ist öffentlich und
        // ohne Credentials → Wildcard genügt; ein simpler GET (nur Accept-Header)
        // löst keinen Preflight aus, der Response-Header reicht. Ohne ihn fielen
        // Namen/Avatare in der App auf npub zurück.
        return response()
            ->json(['events' => $cache->get($pubkeys)])
            ->header('Cache-Control', 'public, max-age=300')
            ->header('Access-Control-Allow-Origin', '*');
    }
}
