{{-- Test double for `config('group.meetup_map_view')` — a host view that the package
     includes with `$meetups` in scope. It exists so the SEAM is measured (does the package
     hand the list over, does it stop offering its Portal link-out?) without this repo
     shipping Leaflet, which only the app binds. --}}
<div data-test-karte="{{ count($meetups) }}"></div>
