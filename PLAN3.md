# PLAN3.md — Design-Vervollständigung (AAA) & Chat-UX-Politur

> Zielgruppe: die nächste Claude-Instanz, die im Web-Client `/home/user/Code/flotilla-einundzwanzig` die Design- und UX-Reife auf AAA-Niveau hebt.
> **Vorgänger:** `PLAN.md` (M0–M7, Web-Kern fertig) + `PLAN2.md` (M8/Mobile-Package). Dieses Dokument ist die dritte Ausbaustufe.

### Rahmen (Auftraggeber, 2026-07-08)

- **Scope = reine UX-/Design-Politur.** Nur der **bestehende kind-9 Text-Chat** wird perfektioniert. **KEINE neuen Nostr-Kinds/-Features** — kein Reactions (kind 7), kein Media-Upload (Blossom), keine Threads, keine Zaps, keine DMs. Diese bleiben wie in PLAN.md §1 ausgeschlossen.
- **Design-Umfang = ganze App inkl. Web-Landing.** Community-Kern (Chat/Directory/Spaces/Settings/Login/Join) **plus** Web-Landing (`/`), Fehlerseiten und globale Flows.
- **Mobile-Release bleibt außen vor.** Das Chat-Package läuft plattformblind (PLAN2); Design-Fixes hier gelten für Web **und** WebView, aber der NativePHP-Release-Pfad (PLAN2 P4) wird in diesem Plan **nicht** angefasst. Wo ein Fix mobil besonders greift (Safe-Area, `h-dvh`, Touch-Ziele, Tastatur), ist das vermerkt — es ist Design-Korrektheit, kein Release-Schritt.
- **Design-System ist gesetzt (PLAN §12).** Inconsolata, Bitcoin-Brand-Ramp, Token/Utilities in `packages/nostr-chat/resources/css/theme.css`. **Farben/Fonts NICHT neu erfinden** — die Arbeit ist konsistente Anwendung, echte Zustände, Motion, A11y.
- **Flux-Pflicht (PLAN §1)** bleibt bindend: kein rohes `<button>/<input>/<select>`, wo ein Flux-Pendant existiert.
- **Web UND Native-Mobile aus denselben Views** — bindendes Grundprinzip, gilt für jede Design-Änderung in diesem Plan: eine Blade-Datei, plattform-spezifische Teile per Seam getrennt, **nicht** per Datei-Fork. Siehe **§Web+Mobile** unten; der Absatz „Konsequenz für die D-Phasen" markiert, welche Fixes Web-only, Mobile-besonders oder plattformneutral sind.

### Fortschritt (Stand 2026-07-08)

| Phase | Fokus | Status | Kern-Inhalt |
|---|---|---|---|
| **D0** — Audit | Ist-Analyse | ✅ **fertig** | 5-Dimensionen-Multi-Agent-Audit (chat-scroll, composer, design-states, a11y, landing/nav) → **48 verifizierte Gaps**, je gegen den echten Code belegt. Grundlage dieses Plans. |
| **D1** — Chat-Bühne: Scroll & Message-Handling | **Priorität** | ✅ **fertig** | Auto-Scroll robust, korrekter Unread-Zähler (Fremd-Append, kein Prepend/eigene), generischer Jump-to-Bottom, `h-dvh`+`visualViewport`+Composer-Focus, First-Paint-Gate, Auto-Load-Older, `role="log"`/`aria-live`, Last-Read-Divider (localStorage). Virtualisierung bewusst ausgelassen (Beobachtung, nicht dringend). E2E: Unread-Zählung + Jump + Auto-Load-Older grün (8 room-Tests). |
| **D2** — Composer & Interaktion | **Priorität** | ✅ **fertig** | Shift+Enter-Fix, Auto-Grow, Send-Retry-Zeile + Relay-Fehler-Mapping (optimistische Nachricht bei Reject zurückgenommen → kein Doppel), Fokus-Rückgabe, `fullTime`-Tooltip + Hover-HH:MM, Heute/Gestern-Trenner, klickbares Zitat (Sprung + Brand-Ring), Touch-Aktionen via Tap-to-toggle (`activeId`), Löschen-Confirm (Flux-Modal) + Busy, Sende-Spinner, aria-label. Per-Nachricht-Failed-Rendering (L) bewusst durch Composer-Retry-Zeile ersetzt. Signer-Banner-Reflow (Sev niedrig) → D4 verschoben. E2E: Shift+Enter + Zitat-Sprung + Fehler-Retry (WS-Reject) grün (11 room-Tests). |
| **D3** — Zustände & System-Konsistenz | | ✅ **fertig** | Spaces-First-Paint-Skeleton + Räume-Empty-State, Settings-`ready`-Guard (nostrSpaceSettings), Raum-Inline-Fehler-Callout (`error`+`retry()`, `.catch` auf `loadRoomMessages`) + `aria-busy`/sr-only, Directory-`list-stagger`-`--i`, Login-Busy-Labels + QR-Skeleton, `verein-gate` auf `surface-card`, reply/delete/clearReply → `flux:button` (Komposit-Buttons bleiben roh mit §6-Kommentar). Pest deckt `ready`-Guards + Empty/Error-Rendering (5 Tests), Room/Directory/Spaces/Login/Verein-E2E grün (28). |
| **D4** — A11y & Responsive | | ⬜ offen | Sichtbarer Keyboard-Focus, Kontrast (zinc-500→400), 44px-Tap-Ziele, `reduced-motion`-Lücken, Modal-Fokus-Rückgabe, **Desktop-Split-Layout**. |
| **D5** — Navigation, Landing & globale Flows | | ⬜ offen | Logout auf Settings-Tab, Bottom-Nav-Konsistenz, Marken-Fehlerseiten, OG-Share-Bild, `nostr-smoke` schützen, Empty-Space-CTA. |

> **Test-Grundsatz (wie PLAN):** Jede D-Phase wird programmatisch getestet, bevor sie ✅ gilt. Chat-UX-Verhalten (Scroll/Unread/Composer) → **Playwright-E2E** (Host-Chromium, hermetischer In-Process-zooid). Reine Blade-/Route-/A11y-Attribut-Änderungen → **Pest**. `vendor/bin/pint --dirty` + `npm run build` vor jedem Commit. `code-simplifier` vor JEDEM Commit, dann sofort `git push`.

---

## Kritisch zuerst (Severity „hoch" — 9 Punkte, tiefhängend)

Diese neun bringen den größten Sprung und sind bis auf zwei billig. Reihenfolge = empfohlene Umsetzung:

| # | Gap | Datei | Aufwand | Phase |
|---|---|---|---|---|
| 1 | **Shift+Enter verschluckt den Zeilenumbruch** (`.prevent` feuert immer) → mehrzeilige Nachrichten unmöglich | `⚡room.blade.php:171` | S | D2 |
| 2 | **Unread-Pill zählt Emits statt Nachrichten** + false-positive beim „Ältere laden" + eigene Nachrichten | `bridge.ts:691-712` | M | D1 |
| 3 | **Kein generischer Jump-to-Bottom** (nur an `unread>0` gekoppelt) | `⚡room.blade.php:139` | S | D1 |
| 4 | **Reply/Löschen hover-only** → auf Touch komplett unerreichbar | `⚡room.blade.php:123` | M | D2 |
| 5 | **Kein sichtbarer Keyboard-Focus** auf `.pressable` (Nav-Links, Roh-Buttons) | `theme.css:202-206` | S | D4 |
| 6 | **Sekundärtext `text-zinc-500` reißt Kontrast** (~3.5:1 auf `zinc-900` dark; AAA-nah verfehlt in light) — Fix für **beide** Themes | 18 Stellen | M | D4 |
| 7 | **Chat-Log ohne `role="log"`/`aria-live`** → Screenreader stumm | `⚡room.blade.php:56` | S | D1 |
| 8 | **Logout fehlt auf dem Einstellungen-Tab** → Flow Settings→Logout bricht | `settings/⚡space.blade.php:12` | S | D5 |
| 9 | **Kein Theme-Switch** (Layout fest `class="dark"`) — Light+Dark sollen gleichrangig gepflegt werden | `einundzwanzig.blade.php:10` | M | D4 |

---

## D1 — Chat-Bühne: Scroll & Message-Handling

Der vom Auftraggeber betonte Kern („Auto-Scroll runter zur letzten Nachricht usw."). Alle Fixes sind reine Insel-/Blade-Politur (`bridge.ts` `nostrRoomChat`, `feeds.ts`, `⚡room.blade.php`), kein Nostr-Kind.

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Unread-Zähler falsch** (`bridge.ts:691-712`) | `grew = msgs.length > this.messages.length` + `unread++` pro Emit — Batch = 1, `loadOlder`-Prepend triggert false-positive, eigene optimistische Nachricht zählt mit. | Am **Ende** angehängte Fremd-Events zählen: `created_at > lastSeen && pubkey !== me`. `_prepending`-Flag während `loadOlder` setzen → im Callback überspringen. Eigene nie zählen. | hoch | M |
| **Kein generischer Jump-to-Bottom** (`⚡room.blade.php:139`) | Pill nur bei `unread>0`. Hochgescrollt ohne neue Msg = keine Affordanz zurück. | Sichtbarkeit an `!atBottom` koppeln; bei `unread>0` zusätzlich Zähler zeigen, sonst nur Pfeil. Klick → `scrollToBottom()`. | hoch | S |
| **Chat-Log ohne `role="log"`/`aria-live`** (`⚡room.blade.php:56`) | Scroll-Container trägt nur `x-on:scroll` + Layout. Neue Nachrichten für AT lautlos. | `role="log" aria-live="polite" aria-relevant="additions" aria-label="Chat-Verlauf"`. Deklarativ, keine Logik. | hoch | S |
| **Mobile-Tastatur/Resize unbehandelt** (`⚡room.blade.php:42`) | `h-screen` (100vh) ignoriert Tastatur; kein `visualViewport`-Listener; Composer-Fokus scrollt nicht ans Ende. | `h-screen`→`h-dvh`. `visualViewport`-resize → bei `atBottom` erneut `scrollToBottom()`. Beim Composer-`focus` einmal ans Ende. | mittel | M |
| **Kein „Neue Nachrichten ab hier"-Divider** (`feeds.ts:82-118`) | Nur Datums-Divider; keine persistente Last-Read-Position. Rückkehr in den Raum landet wortlos am Ende. | Last-Read-Timestamp pro Raum in localStorage (bei `atBottom`/Verlassen). In `deriveRoomChat` beim ersten Event `> lastRead` ein `unreadDivider`-Flag; Blade rendert Trennlinie. Reine Client-UX. | mittel | L |
| **Initiales Springen möglich** (`bridge.ts:705-712`) | `scrollToBottom()` läuft in `$nextTick` (setTimeout-Makrotask) nach x-for-Render bei `scrollTop=0` → Verlauf kann kurz oben starten und sichtbar runterspringen. | `firstPaintDone`-Flag: Scroll-Container bis zum ersten `scrollToBottom()` `opacity-0`, dann einblenden. | niedrig | S |
| **„Ältere laden" nur per Button** (`⚡room.blade.php:60`) | `onScroll()` prüft Nähe zum oberen Rand nicht; einziger Trigger ist der Button. | In `onScroll()` bei `scrollTop < 120 && hasMore && !loadingMore` automatisch `loadOlder()`. Button als Fallback behalten. Anchoring (`bridge.ts:732-736`) bleibt. | niedrig | S |
| **Keine Virtualisierung/DOM-Cap** (`⚡room.blade.php:90`) | `x-for` rendert jede Nachricht dauerhaft; DOM wächst monoton. | *Beobachtung* — volle Virtualisierung wahrscheinlich Overkill für den erwarteten Umfang. Pragmatisch: DOM-Cap (nur letzte N bei `atBottom`) **oder** `content-visibility:auto`. Nicht dringend. | niedrig | L |

**DoD D1:** Verlauf startet unsichtbar-am-Ende (kein Springen); neue Fremd-Nachrichten scrollen nur bei `atBottom` mit, sonst korrekt gezählte Pill; Jump-Button immer verfügbar wenn hochgescrollt; Tastatur verdeckt den Composer nicht; Screenreader kündigt neue Nachrichten an. E2E deckt Unread-Zählung + Jump + Auto-Load-Older ab.

---

## D2 — Composer & Interaktion

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Shift+Enter verschluckt Umbruch** (`⚡room.blade.php:171`) | `x-on:keydown.enter.prevent="!$event.shiftKey && send()"` — `.prevent` ruft `preventDefault()` bei JEDEM Enter. Shift+Enter überspringt `send()`, aber der Umbruch geht verloren. | `.prevent` weg, bedingt selbst: `x-on:keydown.enter="if(!$event.shiftKey){ $event.preventDefault(); send() }"`. | hoch | S |
| **Reply/Löschen hover-only** (`⚡room.blade.php:123`) | Aktionsleiste `opacity-0 group-hover:opacity-100` — auf Touch nie sichtbar; kein Tap/Long-Press. | Auf `@media (hover:none)` dauerhaft (gedämpft) sichtbar **oder** Tap-to-toggle einer `activeId`. | hoch | M |
| **Textarea wächst nicht mit** (`⚡room.blade.php:169`) | `rows="1" resize="none"` ohne Auto-Grow → längerer/mehrzeiliger Text scrollt unsichtbar. | `x-on:input`: `el.style.height='auto'; el.style.height=Math.min(scrollHeight, MAX)+'px'` (Max ~9rem/5-6 Z.), nach Senden auf 1 Zeile. | mittel | S |
| **Zitat nicht klickbar** (`⚡room.blade.php:114-119`) | Reply-Vorschau ist reines Markup; `m.reply.id` ist da, aber kein Sprung zum Original. | Message-Row `:id="m.id"`; Quote-`x-on:click="scrollToMessage(m.reply.id)"` → `scrollIntoView({block:'center'})` + kurzer Brand-Ring-Highlight. | mittel | M |
| **Kein Per-Nachricht-Sende-/Fehler-State** (`bridge.ts:776-797`) | Optimistische Nachricht liegt im Repository; bei Fehler nur flüchtiger Toast + Draft zurück → sieht doppelt aus, kein Retry. | Pending/Failed-Set in der Insel; im Verlauf abbilden (gedämpft = pending, rotes „!" + Retry = failed). Bei Fehler die optimistische Nachricht als failed markieren statt Draft zu duplizieren. | mittel | L |
| **Gruppierte Nachrichten ohne Zeit** (`⚡room.blade.php:110`) | `m.time` nur im Autor-Kopf; Folgezeilen tragen keine Zeit, nirgends voller Datums-Tooltip. | `feeds.ts` volles `m.fullTime` (Datum+Uhrzeit) → `:title` an Row; bei Nicht-Autor-Zeilen dezente `group-hover`-HH:MM-Spalte links. | mittel | S |
| **Publish-Fehler nicht aktionabel** (`bridge.ts:787-790`) | Roher Relay-String (`waitForThunkError`) ungemappt in `toast()`, kein Retry. | Composer-Hinweiszeile „Konnte nicht gesendet werden — Erneut senden" (Brand-Link ruft `send()`, Draft ist gefüllt). Gängige Relay-Fehler (rate-limit/auth/restricted) auf deutsche Kurztexte mappen. | mittel | M |
| **Composer-Textarea ohne Accessible Name** (`⚡room.blade.php:169`) | Nur `placeholder`, kein `label`/`aria-label` (Sende-Button hat eins). | `aria-label="Nachricht schreiben"` (visuell unverändert). | mittel | S |
| **Löschen ohne Bestätigung/Busy** (`⚡room.blade.php:128`) | Ein Klick löscht (NIP-09) ohne Rückfrage; `remove()` setzt kein Busy-Flag. | Kurzer Confirm (Flux-Modal) **oder** Undo-Toast; Trash-Button während Publish `::disabled`. | mittel | S |
| **Kein Fokus-Rückgabe nach Senden per Button** (`bridge.ts:776-797`) | Nur Enter hält den Fokus; nach Button-Klick liegt er auf dem Button. `setReply` macht es korrekt vor. | Nach erfolgreichem Publish denselben `$nextTick`-Refokus auf `$refs.composer`. | niedrig | S |
| **Sende-Button ohne Lade-Indikator** (`⚡room.blade.php:172`) | Nur `::disabled="sending"`, Icon bleibt statisch — bei langsamem Relay kein Feedback. | Flux-`loading` an `sending` koppeln bzw. Icon gegen Spinner tauschen. | niedrig | S |
| **Datums-Trenner nie Heute/Gestern** (`feeds.ts:48-49`) | `dayLabel` immer volles Datum, auch für heute. | Tagesdifferenz zu `now`: 0→„Heute", 1→„Gestern", sonst Datum. | niedrig | S |
| **Signer-Banner überlagert Header, gated Senden nicht** (`einundzwanzig.blade.php:19`) | Banner `fixed top-0 z-50` verdeckt den Raum-Header; Composer bleibt bei „Signer offline" voll bedienbar → stiller Fehlschlag. | Banner als `shrink-0`-Streifen im Flow (push statt overlay); bei `disconnected` Composer mit Hinweis „Signer offline" deaktivieren. Bestehende `signerHealthLabel`-Texte nutzen. | niedrig | M |

**DoD D2:** Shift+Enter macht Umbruch, Enter sendet; Textarea wächst; Reply/Löschen auf Touch erreichbar mit Bestätigung; Zitat springt zum Original; Sende-Zustände (busy/failed/retry) sichtbar; Fokus bleibt im Composer. E2E deckt Shift+Enter + Zitat-Sprung + Fehler-Retry ab.

---

## D3 — Zustände & Design-System-Konsistenz

„Zustände sind Design" (PLAN §12). Empty/Loading/Error konsequent, Token-Drift raus.

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Spaces: leerer First-Paint** (`⚡spaces.blade.php:31`) | Wrapper `x-show="space"`; internes Skeleton verlangt schon `space` → im `space===null`-Erstladefenster nackte Fläche. | Skeleton-`surface-card` solange `!space` (Titel + 2-3 Raumzeilen), echten Block bei `space` zeigen. | mittel | S |
| **Settings-Space: Empty-State flackert** (`settings/⚡space.blade.php:21`) | `x-if="spaces.length===0"` ohne `ready`-Guard → „leer"-Meldung blitzt vor der ersten Emission auf (genau das Fix-A-Anti-Pattern). | `ready`-Flag in `nostrSpaceSettings` (wie `nostrDirectory`); Empty auf `ready && length===0`, sonst Skeleton-navlist. | mittel | S |
| **Room: kein Inline-Error/AUTH-Callout** (`⚡room.blade.php:67-87`) | Nur Skeleton/Empty; Load-Fehler → Dauer-Skeleton oder irreführendes „Noch keine Nachrichten". | `error`-State (`.catch` in `loadRoomMessages`/`loadSpaceRooms`) als `flux:callout variant="danger"` inline über dem Verlauf + Retry. | mittel | M |
| **`list-stagger` wirkungslos** (`⚡directory.blade.php:68`) | `--i` wird nie gesetzt → alle Karten Delay 0, kein Stagger. | `x-for="(m, idx) in filtered()"` + `:style="`--i:${idx}`"`. | mittel | S |
| **Roh-`<button>` trotz Flux-Pflicht** (`⚡room.blade.php:124,128,163`) | Antworten/Löschen/Abbrechen als rohe Buttons (auch `⚡directory:170`). | Icon-only auf `flux:button variant="ghost" size="xs" icon=…`; aria-labels behalten. Directory-Toggle (Icon+Badge-Komposit) mit Kommentar vertretbar; `<input type=range>` bleibt erlaubt (§6). | niedrig | M |
| **Login: kein Lade-Feedback, QR ohne Skeleton** (`⚡nostr-login.blade.php:40,64,69,92`) | Buttons nur `::disabled`; QR-Wartebereich Plain-Text. | Buttons mit Lade-Label/Spinner (analog „Trete bei…"); QR-Platzhalter `skeleton size-56 rounded-tile`. | niedrig | S |
| **`verein-gate` baut `surface-card` ad-hoc nach** (`components/verein-gate.blade.php:11`) | Manuelles `rounded-card border bg-white shadow-card dark:…` — einzige Card abseits der Utility (Token-Drift). | `class="surface-card !border-brand-500/30 …"`, dupliziertes bg/shadow raus. | niedrig | S |
| **Spaces: „keine Räume" ist nur graue Textzeile** (`⚡spaces.blade.php:48`) | `<flux:text>` ohne Icon/`.empty-state`/CTA — inkonsistent zu Room/Directory/Settings. | Nicht-gateten Fall in `surface-card empty-state p-6 text-center` mit `flux:icon.hashtag` heben. | niedrig | S |
| **Skeletons ohne `aria-busy`/Status** (`⚡room.blade.php:66`, `⚡directory.blade.php:42`) | Reines Shimmer, kein `aria-busy`, kein sr-only-Status. | `::aria-busy="loading"`/`!ready` am Wrapper + sr-only „Lädt…" mit `aria-live="polite"`. Additiv. | niedrig | S |

**DoD D3:** Kein Screen zeigt beim Laden nackte Fläche oder falsches „leer"; Load-Fehler haben einen persistenten Inline-Callout mit Klartext; alle Cards laufen über `surface-card`; `list-stagger` staffelt real. Pest deckt `ready`-Guards + Empty/Error-Rendering ab.

---

## D4 — A11y & Responsive

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Kein sichtbarer Keyboard-Focus** (`theme.css:202-206`) | `ring-accent` nur an Flux-Inputs; `.pressable` (Nav-Links, Brand-Link, Roh-Buttons) hat nur `:active`, kein `:focus-visible`. | `.pressable:focus-visible { outline-hidden; ring-2 ring-accent ring-offset-2 … }`; Icon-Buttons `rounded-tile`. | hoch | S |
| **Sekundärtext reißt Kontrast** (18 Stellen) | `text-zinc-500` (#737373): dark auf `zinc-900` ≈ 3.5:1 (reißt AA 4.5:1), light auf weiß ≈ 4.7:1 (verfehlt AAA 7:1). Gilt in **beiden** Themes. | `.text-muted`-Utility mit theme-tauglichen Werten (`zinc-600` light / `zinc-400` dark) und die 18 Stellen darauf umstellen — **beide** Themes ≥ AA/AAA-nah. | hoch | M |
| **Kein Theme-Switch, Light+Dark nicht gleichrangig gepflegt, Store nicht mit Portal in sync** (`einundzwanzig.blade.php:10`) | Chat-Layout fest `class="dark" data-theme="dark"` — überschreibt den bereits eingebundenen `@fluxAppearance` (`partials/head.blade.php:21`). Der Light-Pfad ist damit toter Code, obwohl `theme.css` volle `light:`+`dark:`-Styles trägt. **Portal (`einundzwanzig-mobile-app`) hat exakt denselben Bug** (`mobile.blade.php:26 class="dark"`) und dieselbe Flux-Appearance-Settings-Seite. | **Flux' Appearance-Store IST der geteilte Store** (`$flux.appearance` → localStorage-Key `flux.appearance`, im `<head>` von `@fluxAppearance` flackerfrei angewandt, `system`=`prefers-color-scheme`). (1) Hartes `class="dark"` aus `einundzwanzig.blade.php:10` **entfernen** → `@fluxAppearance` wählt Theme aus dem Store → Light lebt sofort. (2) **Theme-Switch** = `flux:radio.group variant="segmented" x-model="$flux.appearance"` (Hell·Auto·Dunkel) — dieselbe Bindung wie die Fortify-Appearance-Seite; platzieren im `app-header`-`actions`-Slot / auf dem Einstellungen-Tab neben Logout. (3) **Sync mit Portal geschenkt:** im WebView läuft der Chat **same-origin** zum Portal → dasselbe `flux.appearance`-localStorage → automatisch in sync. Voraussetzung: Portal-`mobile.blade.php:26` ebenfalls enthärten (kein `class="dark"`), sonst überschreibt das Portal-Shell den Store. (4) Beide Themes je Screen verifizieren (E2E-Screenshot Light+Dark). **Kein eigener/custom Theme-Store — würde den Sync brechen.** | hoch | M |
| **Handy-Spalte auf Desktop zu schmal** (mehrere) | Alle Screens `mx-auto max-w-md`, **0** Breakpoints → auf Desktop eine ~28rem-Spalte. | **Vorerst nur verbreitern**: `max-w-md` → großzügiger (z.B. `md:max-w-lg`/`lg:max-w-2xl`), zentriert. **Volles Desktop-Split-Layout (Liste+Chat nebeneinander) bewusst VIEL SPÄTER** (Auftraggeber, 2026-07-08) — nicht in PLAN3. | mittel | S |
| **Icon-Buttons < 44px Tap-Fläche** (`⚡room.blade.php:124-131`) | `p-1` um `variant="micro"`-Icon ≈ 24px; zusätzlich hover-only. | `min-h-11 min-w-11` (`p-2.5`) oder `.icon-btn`-Utility; Coarse-Pointer-Sichtbarkeit (siehe D2 #4). | mittel | S |
| **Event-Modals ohne Fokus-Rückgabe** (`⚡directory.blade.php:30,89`) | `role-form`/`member-roles` per `dispatchModal`-CustomEvent geöffnet → Fokus kehrt nach Schließen nicht zum Trigger zurück (Flux-`modal.trigger`-Modals machen es korrekt). | Entweder über `flux:modal.trigger` öffnen, oder `activeElement` merken/zurücksetzen im Close-Pfad. | mittel | M |
| **`reduced-motion` deckt `.nav-pill` nicht** (`theme.css:126,184`) | Reduced-Motion-Block listet `.nav-pill` (scaleX, 0.35s) nicht → animiert trotzdem bei jedem `wire:navigate`. | `.nav-pill` zur `animation:none`-Selektorliste. Ein-Zeiler. | niedrig | S |

**DoD D4:** Jedes interaktive Element hat sichtbaren Focus-Ring; Sekundärtext ≥ AA in **beiden** Themes; **Theme-Switch (Hell·Auto·Dunkel) an guter UX-Stelle, Präferenz persistent, flackerfrei, System-Default respektiert, Light+Dark je Screen verifiziert**; Handy-Spalte auf Desktop angenehm breit (kein volles Split); Tap-Ziele ≥ 44px; Modals geben Fokus zurück; `reduced-motion` schaltet alle Transform-Animationen ab. Pest/Attribut-Checks + E2E-Screenshots Light+Dark.

---

## D5 — Navigation, Landing & globale Flows

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| **Logout fehlt auf Settings-Tab** (`settings/⚡space.blade.php:12`) | Header hat nur `subtitle`, kein `nostrAuth`/Abmelden. Flow Home→Login→Space→Settings→Logout bricht; Logout nur im Räume-Header. | `x-data="nostrAuth"` + `actions`-Slot mit Abmelden-Button (analog `⚡spaces:22`). `doLogout()` existiert. | hoch | S |
| **Bottom-Nav-Tabs mit Zurück-Pfeil aufeinander** (`⚡directory.blade.php:13`, `settings/⚡space.blade.php:12`) | `:back="route('chat.spaces')"` auf gleichrangigen Tabs signalisiert falsche Hierarchie (nur `⚡spaces` nutzt Brand-Header). | `:back` weglassen, Brand-Mark-Header wie `⚡spaces`. Bottom-Nav ist das Modell. | mittel | S |
| **Keine Marken-Fehlerseiten** (`resources/views/errors` fehlt) | Kein `errors/`-Verzeichnis → 404/500/503 landen auf Laravels hell-weißer Default-Seite (App ist dark-only), ohne Rückweg. | `errors/{404,500,503}.blade.php` mit `chat::einundzwanzig`-Layout + `<x-chat::app-brand-mark>` + „Zurück zur Startseite" (`route('home')`, `wire:navigate`). | mittel | M |
| **Login-Buttons ohne Lade-Feedback** (`⚡nostr-login.blade.php:40-69`) | `::disabled="busy"` mit statischem Text; NIP-46/Bunker dauert Sekunden → toter Button. | `busy` an Label/Spinner koppeln (`x-text="busy ? 'Verbinde…' : …"`), konsistent zu Composer/Amber-Tab. | mittel | S |
| **`nostr-smoke` öffentlich & off-brand** (`routes/web.php:8`) | Debug-Screen ohne Auth öffentlich/indexierbar, technische Copy. | Route entfernen **oder** hinter `auth`/`app()->environment('local')`. Kommentar markiert sie bereits als „temporär". | niedrig | S |
| **Empty-Space-Liste ist Sackgasse** (`settings/⚡space.blade.php:21`) | Nur Icon+Text „Du bist noch keinem Space beigetreten." — keine CTA. | Primär-Aktion zum Vereinsbeitritt (`verein.einundzwanzig.space`) bzw. `route('home')`, analog `verein-gate`. | niedrig | S |
| **OG-Share-Bild ist nur das App-Icon** (`partials/head.blade.php:19`) | `og:image`/`twitter:image` = `apple-touch-icon.png`, `twitter:card=summary` → Mini-Icon statt Preview-Karte. | `public/og.png` (~1200×630), Meta darauf, `twitter:card=summary_large_image`. Titel/Description pro Route sind bereits sauber. | niedrig | S |

**DoD D5:** Voller Klickpfad Home→Login→Space→Räume/Mitglieder/Einstellungen→Logout ohne Tab-Umweg; Fehlerseiten im Marken-Design mit Rückweg; kein öffentlicher Debug-Screen; Share-Previews zeigen Marken-Karte. Pest deckt Logout-Präsenz + Fehlerseiten-Render + `nostr-smoke`-Gate ab.

---

## §Web+Mobile — eine View, zwei Laufzeiten (bindende Konvention)

> Ausgangsfrage (Auftraggeber): Das Projekt bedient **gleichzeitig** eine Web-App **und** native Mobile-Funktionen (NativePHP). Können native-mobile Anteile in denselben Blade-Views für beide Varianten gepflegt werden — oder müssen wir Views trennen?

**Beurteilung:** Dieselben Views sind der **richtige Default** — und NativePHP unterstützt das first-class. Getrennt wird nur an den echten Bruchlinien (Shell/Layout + Auth-Guard), die PLAN.md §11 / PLAN2 bereits abgespalten haben. Keine Datei-Duplizierung des Kerns.

**Warum das trägt (belegt):**
- NativePHP Mobile v3 liefert offizielle Blade-Direktiven **`@mobile / @web / @ios / @android`** (+ `\Native\Mobile\Facades\System::isIos()`). Genau der saubere Inline-Seam — eine Datei, plattform-spezifischer Block bedingt. Quelle: NativePHP-Doku/Blog (unten).
- **EDGE-Komponenten (`<native:top-bar>`/`<native:bottom-nav>`/`<native:side-nav>`) rendern NICHT im WebView**, sondern werden serverseitig zu JSON transformiert und **plattform-nativ** gerendert (nicht per Tailwind/Flux stylebar). Im Web sind sie bedeutungslos → **immer in `@mobile` kapseln**, mit HTML/Flux-Gegenstück in `@web`.
- Der teure Teil (welshman-Insel + Content-Views) ist **plattformblind** — reine `wire:ignore`-Mount-Points, in Web-Browser **und** WebView identisch. Ihn zu forken wäre Wartungshölle (PLAN §11).

**Die Entscheidungsleiter (erste Stufe, die hält, gewinnt):**

| Unterschied ist… | Vorgehen | Beispiel |
|---|---|---|
| ein kleiner Block/Attribut | **Inline-Seam** `@mobile`/`@web` in **derselben** Datei | Safe-Area-Extra, native Share-Button vs. Web-Link |
| native-gerenderte Chrome (`<native:*>`) | **dieselbe** Datei, `<native:*>` in `@mobile` + HTML/Flux in `@web` | native Bottom-Nav vs. `x-chat::bottom-nav` |
| ganze Shell/Layout **+** Guard | **getrennte Dateien** (bereits erledigt) | `layouts/web` vs. Portal-`layouts/mobile`; NIP-98-Gate vs. lokales Präsenz-Gate |
| PHP-Logik mit nativen Facades | **guarden**, nicht forken | `config('nativephp-internal.running')` (Server) · `function_exists('nativephp_call')` (Facade-Call) · `window.__nostrMobile` (JS) |

**Regeln (dauerhaft):**
1. **Ein Flag, einmal gekapselt.** View-Ebene → `@mobile`/`@web` (idiomatisch). Server-Logik → `config('nativephp-internal.running')`. Facade-Aufruf → `function_exists('nativephp_call')`. Client-JS → `window.__nostrMobile`. **Nie** rohe `config()`-Checks in Views streuen.
2. **`<native:*>` niemals ungeguarded** in einer geteilten View — immer `@mobile`, weil im Web inert und nicht Flux-stylebar; das `@web`-Gegenstück ist ohnehin Pflicht.
3. **Content-Views bleiben plattformblind** (Chat-Feed, Directory, Composer). Keine Plattform-Logik dort einstreuen.
4. **Split erst, wenn der Seam kippt:** überschreitet der plattform-geforkte Anteil einer View grob **~30 %** (oder teilen die Varianten fast nichts), den geforkten Teil in ein `@mobile`-/`@web`-Partial auslagern und das passende includen — geteiltes Skelett bleibt EINE Datei. Ganze Datei-Trennung nur für Shell+Guard.
5. **Native Ergebnisse sind Events** (`#[OnNative]`), keine Rückgabewerte → Mobile-only-Interaktionen (Share/Biometrics/SecureStorage/Deep-Link) leben in der Livewire-Komponente hinter `function_exists`-Guards; die View zeigt den Trigger nur per `@mobile`.
6. **Beide Renderings testen:** ein Pest-Test rendert jede geteilte View einmal mit `config(['nativephp-internal.running' => true])` und einmal Web und prüft, dass der richtige Zweig greift (kein `<native:*>`-Leak ins Web, kein Web-`<a>` auf Mobile).

**Konsequenz für die D-Phasen dieses Plans:** Die meisten Fixes sind plattformneutral (gut für beide). Web-only sind: OG-Share-Bild + Marken-Fehlerseiten + `nostr-smoke`-Gate (D5) und das Verbreitern der Spalte auf Desktop (D4). Mobile-besonders-relevant: `h-dvh`+`visualViewport`+Safe-Area+44 px-Ziele (D1/D2/D4) — dort in beiden Kontexten korrekt. **Plattformübergreifend/geteilt: das Theme (D4)** — Chat und Portal teilen im WebView same-origin denselben Flux-`appearance`-Store, daher darf keiner der beiden ein Theme hart verdrahten (Regel: geteilter Store, kein Fork). Kein D-Fix darf eine geteilte View so ändern, dass sie in der jeweils anderen Laufzeit bricht — Regel 6 fängt das ab.

---

## Entschieden (Auftraggeber, 2026-07-08)

- ✅ **Light UND Dark bleiben dauerhaft gleichrangig gepflegt** (kein Dark-Only). Theme-Switch (Hell·Auto·Dunkel) wird ergänzt → **D4**.
- ✅ **Theme-Store = Flux' Appearance-Store** (`$flux.appearance` / localStorage `flux.appearance`), **kein** custom Store. Im Portal-WebView same-origin → automatisch in sync mit `einundzwanzig-mobile-app`; dafür muss das harte `class="dark"` **in beiden** Layouts weg (`einundzwanzig.blade.php:10` **und** Portal-`mobile.blade.php:26`). Details → D4-Theme-Zeile.
- ✅ **Kein Desktop-Split-Layout in PLAN3** — vorerst nur die Handy-Spalte verbreitern (D4); volle Zwei-Spalten-Desktop-Variante „viel später".

## Offene Entscheidungen (vor dem Bauen klären)

- **Last-Read-Divider-Persistenz (D1):** localStorage pro Raum reicht für Single-Device. Multi-Device-Sync via Nostr-App-Data (kind 30078) wäre ein neuer Kind → **ausgeschlossen** durch den Scope; also localStorage, dokumentiert als Single-Device.
- **Per-Nachricht-Failed-State (D2, L):** hängt daran, ob `publishThunk` die optimistische Nachricht bei Fehler selbst zurückrollt oder ob wir sie manuell als failed markieren. Vor dem Bau `waitForThunkError`/Thunk-Verhalten in `@welshman/app` gegen den echten Fehlerfall prüfen (Referenz-Client, PLAN §Referenz-Repos).
- **Portal-Enthärtung koordinieren:** `mobile.blade.php:26 class="dark"` liegt im **Portal-Repo** (`einundzwanzig-mobile-app`), nicht hier. Änderung dort einplanen, damit der Theme-Sync greift (sonst überschreibt das Portal-Shell den geteilten Store).

---

## Umsetzungsreihenfolge (empfohlen)

1. **Quick-Win-Sprint (½ Tag):** Kritisch-zuerst-Punkte 1,3,5,7,8 + D2/D3/D5-„S"-Fixes (Shift+Enter, Jump-Button, Focus-Ring, `role=log`, Logout-Tab, `list-stagger`, Heute/Gestern, aria-labels, Login-Spinner). Viel AAA-Gewinn, kaum Risiko.
2. **D1 Chat-Scroll (1 Tag):** Unread-Zähler, `h-dvh`+Tastatur, First-Paint-Gate, Auto-Load-Older, Last-Read-Divider. E2E.
3. **D2 Composer (1 Tag):** Auto-Grow, Touch-Aktionen, klickbares Zitat, Failed/Retry, Löschen-Confirm. E2E.
4. **D4 Theme-Switch + Light/Dark-Pflege + Kontrast (beide Themes) + Tap-Ziele + Modal-Fokus (1 Tag):** `class="dark"` enthärten (hier **+** Portal), `$flux.appearance`-Switch, `.text-muted`-Kontrast, Focus-Ring, Spalte verbreitern. E2E-Screenshots Light+Dark je Screen.
5. **D3 Rest + D5 Fehlerseiten/OG (½ Tag).**
