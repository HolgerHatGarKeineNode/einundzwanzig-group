<?php

declare(strict_types=1);

/**
 * **The three `type="file"` inputs of the package, and which of them may take a PDF.**
 *
 * P5 opened exactly one of them: the chat composer's. The space icon and the room
 * picture keep `accept="image/*"`, and that is not an oversight to be tidied up later —
 * an icon is not one option among several there, it is the thing itself.
 *
 * ── Why this is a rendered test and not a look at the diff ─────────────────────
 *
 * Because a diff is an argument about one moment and this is a promise about every
 * later one. The measurement that made it necessary is blunter: the P5 mutation probe
 * put `accept="image/*"` back on the composer input, rebuilt, and ran the full Buzz E2E
 * spec — **all three cases stayed green** (2026-09-05). Playwright's `setInputFiles`
 * assigns the files programmatically and never consults `accept`, so no browser test can
 * see this attribute at all. Without the cases below the central change of the phase
 * would have carried no assertion whatsoever.
 *
 * The first case therefore also asserts that the input EXISTS. A "does not contain
 * `accept`" over a page that lost its file field would be true and would mean nothing.
 */
test('the chat composer takes any file: its input carries no accept filter', function () {
    $res = $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.room', ['h' => 'welcome']))
        ->assertOk();

    // Calibration: both composers (room and thread) render their hidden field.
    $res->assertSee('<input type="file" x-ref="imageInput"', false);
    $res->assertSee('<input type="file" x-ref="threadImageInput"', false);

    // And neither of them — nor anything else on this page — narrows the picker.
    $res->assertDontSee('accept="image/*"', false);
    $res->assertDontSee('accept=', false);
});

test('the space icon input stays restricted to images', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.directory'))
        ->assertOk()
        ->assertSee('<input type="file" accept="image/*" class="hidden" x-ref="spaceIcon"', false);
});

test('the room picture input stays restricted to images', function () {
    $this->withSession(['nostr_pubkey' => str_repeat('a', 64)])
        ->get(route('group.spaces'))
        ->assertOk()
        ->assertSee('<input type="file" accept="image/*" class="hidden" x-ref="roomPic"', false);
});
