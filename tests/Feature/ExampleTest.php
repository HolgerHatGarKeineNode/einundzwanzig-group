<?php

test('returns a successful response', function () {
    $this->get(route('group.start'))->assertOk();
});
