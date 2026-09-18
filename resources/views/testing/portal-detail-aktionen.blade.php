{{-- Test double for `config('group.portal_detail_actions')` — the host block at the end of
     a Portal detail page (web: the link out, app: its editor sheets). --}}
<div data-test-detail-aktionen>
    <a href="{{ $portalLink }}" rel="external noopener">{{ __('Im Portal bearbeiten') }}</a>
</div>
