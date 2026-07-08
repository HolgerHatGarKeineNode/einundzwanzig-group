# PLAN5.md — Schreibende Chat-Interaktionen (Reply zuerst, dann Reactions/Delete/Edit/Report/… gestaffelt)

> Zielgruppe: die nächste Claude-Instanz, die die **schreibenden** Chat-Funktionen baut, die flotilla hat und die Members im EINUNDZWANZIG-Raum-Chat erwarten. **REPLY (Antworten) ist der erste, blockierende Meilenstein** — Members erwarten es zuerst. Danach die weiteren Nostr-möglichen Chat-Features (Reactions, Delete, Edit, Quote, Report, …) gestaffelt.
> **Vorgänger:** `PLAN.md` (M0–M7, Web-Kern) · `PLAN2.md` (M8/Mobile-Package) · `PLAN3.md` (D0–D5, Design/UX-AAA) · `PLAN4.md` (P1/B1–B6, Package-Öffnung & Branding aus Nostr). Dieses Dokument ist die **fünfte Ausbaustufe**.

> **Begriffe (fix):**
> - **Publish-Kind** = ein neues Nostr-Event-`kind`, das der Client erstmals *schreibt* (signiert + an das Space-Relay sendet). PLAN5 öffnet gezielt einige, die bis PLAN4 „Out of Scope" waren.
> - **welshman-Publish-Layer** = `makeEvent`/`makeReaction`/`makeDelete`/`makeReport`/… (`@welshman/util`, `@welshman/app`) + `publishThunk`/`waitForThunkError` + die `tagEventFor*`-Helfer. **Wird wiederverwendet, nicht neu erfunden.**
> - **Reply** = im NIP-29-Raum **kein NIP-10-`e`-Reply**, sondern ein **NIP-18/NIP-21-Quote**: Parent als `nostr:nevent…`-Präfix im `content` + `["q",…]` + `["p",…]`-Tag. (Genau so macht es flotilla; genau so ist es im Ziel-Projekt bereits verdrahtet.)
> - **Insel** = die client-seitige welshman/Alpine-Komponente (`nostrRoomChat` in `js/bridge.ts`), in der Signing & Publish leben. Der Server ist NIE im Signaturpfad.

### Rahmen (Auftraggeber, 2026-07-09)

- **SCOPE-WECHSEL — erstmals schreibend über den Text-Chat hinaus.** PLAN3/PLAN4 waren ausdrücklich Anzeige/Lesen. Wörtlich, dagegen grenzt PLAN5 sich ab:
  - `PLAN3.md:8`: „**Scope = reine UX-/Design-Politur.** … **KEINE neuen Nostr-Kinds/-Features** — kein Reactions (kind 7), kein Media-Upload (Blossom), keine Threads, keine Zaps, keine DMs."
  - `PLAN4.md:10`: „**Scope = nur Anzeige/Lesen.** … **keine neuen publish-Kinds**, keine Zaps/Reactions/Media."
  Dieser Rahmen wird **bewusst gebrochen.** PLAN5 öffnet die schreibenden Chat-Interaktionen, die flotilla an einer kind-9-Nachricht bietet.
- **Nuance (wichtig):** „Read-only" war nie total — **kind-9-Senden, kind-5-Löschen und NIP-29-Join/Leave (9021/9022) sind seit M5/M6 produktiv** und im Ziel-Projekt bereits verdrahtet (`js/feeds.ts` `sendRoomMessage`/`deleteRoomMessage`, `js/groups.ts` `joinRoom`/`leaveRoom`). Der eigentliche Bruch von PLAN5 ist präzise: **neue publish-Kinds jenseits des reinen Text-Chats** (Reactions kind 7, ggf. Media-`imeta`, Poll-Response, Report). Was nicht in diesem Dokument geöffnet wird, bleibt ausgeschlossen (siehe unten).
- **Reply ist bereits im Ziel-Projekt end-to-end vorhanden** (`sendRoomMessage(url,h,content,reply?)`, `setReply`/`clearReply`, Zitat-Box im Composer, `q`-Tag-Auflösung, Scroll-to-Parent). **C0 ist daher primär Verifikation, Härtung & Testabdeckung** dieses vorhandenen Reply-Pfads plus das Anlegen des generischen **Interaktions-Menüs** (Popover/Modal pro Nachricht), an dem alle folgenden Aktionen hängen. Falls die Prüfung Lücken findet (z.B. PROTECTED/`["-"]`-Tag fehlt), werden sie hier geschlossen. **Blockierend, zuerst.**
- **Signing bleibt IMMER im Browser.** Der private Key verlässt nie Browser/WebView; der Server ist nie im Signaturpfad und kennt nur den NIP-98-verifizierten Pubkey (`PLAN.md:47`, `PLAN.md:127`, `PLAN2.md:47`). **Kernsatz PLAN5:** jede neue Publish-Aktion wird client-seitig via `@welshman/signer` signiert und über `publishThunk({relays:[url], event})` optimistisch verteilt — **kein neuer Server-Endpoint für Event-Erzeugung.**
- **Grundprinzip — flotillas welshman-Publish-Layer wiederverwenden, nicht neu schreiben.** Alle Event-Bau-Funktionen aus flotilla (`reactions.ts`, `deletes.ts`, `reports.ts`, `comments.ts`, `polls.ts`, `groups.ts:prependParent`) sind reine welshman-`makeEvent`+Tag-Logik ohne Svelte-Abhängigkeit → **1:1 in die Insel übernehmen** (`js/interactions.ts` o.ä.). Vor dem Schreiben die reale API unter `/home/user/Code/flotilla/node_modules/@welshman/*/dist` bzw. in Flotillas Nutzung nachschlagen, nicht raten.
- **h-Tag / PROTECTED / AUTH — die NIP-29-Regeln aus flotilla exakt übernehmen:**
  - **`["h", h]`** (NIP-29 Group-Tag) ist Pflicht für jede Aktion, die ans Space-Relay geht (Message, Reply, Reaction, Delete). Reaction/Delete übernehmen `h` vom Parent via `getTag("h", event.tags)`.
  - **`["-"]` (PROTECTED, NIP-70)** wird nur gesetzt, wenn `canEnforceNip70(url)` für das Space-Relay true liefert.
  - **NIP-42 AUTH** ist für member-only Spaces nötig (zooid ist member-only, `public_read=false`) — welshman handhabt AUTH automatisch (`js/core.ts` `makeSocketPolicyAuth`), sobald ein Signer da ist.
- **Auftraggeber-Entscheidungen (2026-07-09):** **Poll-Vote (NIP-88)** wird in die **Kern-Staffel** hochgezogen (C5); **Reactions** nutzen **Standard-Set + Space-Custom-Emoji (NIP-30)**; **Attachments** laufen über **Blossom** (nicht NIP-96); **Zaps (NIP-57)** und **Admin-Moderation (NIP-86 BanEvent-Delete/Pin)** sind **keine harten Ausschlüsse mehr**, sondern eigene **Kür/Backlog-Phasen** (C7 bzw. C8, erst nach Freigabe).
- **Hart AUSGESCHLOSSEN** (nicht in PLAN5): **DMs/NIP-17**, **LiveKit/Voice**, **Poll-Erstellen** (nur Vote). `lud16` bleibt bis zur Zap-Phase (C7) reiner Anzeige-⚡-Chip (`PLAN4.md:22`).
- **Bindende Konventionen bleiben** (aus PLAN/PLAN2/PLAN3/PLAN4): Web+Mobile **eine View, Seam statt Fork**; Design-System (`theme.css`, Bitcoin-Brand-Ramp `#f7931a`, `surface-card`/`rounded-tile`, Flux-Pflicht) nicht neu erfinden; UI deutsch **„Raum"/„Räume"** (Code englisch); Marke **EINUNDZWANZIG** (groß); Wort „flotilla" nie in UI/Code; Single-Space-Fokus; Package-Cross-Repo-Kopplung (`einundzwanzig/group`, eigenes Repo, `dev-master`).

### Fortschritt (Stand 2026-07-09)

| Phase | Fokus | Status | Kern-Inhalt |
|---|---|---|---|
| **C0** — Schreib-Fundament + Reply härten + Interaktions-Menü | **blockierend, zuerst** | ✅ erledigt | `js/interactions.ts` (`PROTECTED`/`canEnforceNip70`/`roomTags`) + pures `hasNip70` in `relayCaps.ts`; `sendRoomMessage`/`deleteRoomMessage` hängen PROTECTED via `roomTags(h,url)` an (zooid meldet NIP-70). Interaktions-Menü als „…"-Andockpunkt: Web = `flux:dropdown`-Popover, native App = `flux:modal` (Seam auf `isMobile`/`__nostrMobile`, test-überschreibbar). E2E grün: Reply trägt am Relay `q`+`p`+`h`+`["-"]`+`nostr:nevent`-Präfix; Menü öffnet Web (Popover) + Mobile (Modal); `hasNip70`-Unit. |
| **C1** — Emoji-Reactions (NIP-25 kind 7, Custom-Emoji NIP-30) + Toggle-Delete | nach C0, hoch | ⬜ offen | `makeReaction`→`publishReaction`; Reaction-Picker (Standard + Custom-Emoji, Render-Pfad steht seit B6); Toggle = eigene kind-7 per NIP-09 kind-5 löschen; Reaction-Summary (aggregiert `#e`) mit Toggle-Zustand. |
| **C2** — Delete eigene Nachricht (NIP-09 kind 5) + Report (NIP-56 kind 1984) | nach C0, mittel | ⬜ offen | Delete existiert (`deleteRoomMessage`) → in Menü einhängen + Bestätigungs-Modal; Report `makeReport` (Grund-Auswahl), `["p",pk]`+`["e",id,reason]`. |
| **C3** — Edit (eigene, <5 min) + Quote/Share | nach C1, mittel | ⬜ offen | Edit = Delete-des-Alten + Re-Publish mit gleichem `created_at` (`canEditEvent` = eigener pk & ≤5 min alt); Quote/Share = `prependParent`-Pfad ohne Reply-Ziel (Event in Chat teilen), inkl. Quote-Only-Render. |
| **C4** — Mentions (NIP-08/NIP-27) + Copy nevent/npub/JSON + Nachricht-Info | nach C0, klein | ⬜ offen | `@`-Mention-Autocomplete im Composer → `nostr:npub…` + `["p",…]`; Kontextmenü Copy `neventEncode`/`npubEncode`/Roh-JSON + Seen-On-Relays (`tracker.getRelays`). |
| **C5** — Poll-Vote (NIP-88 kind 1018) | Kern-Staffel, mittel | ⬜ offen | Vote auf eine als kind-9 geteilte Poll: `makePollResponse` → `["e",pollId]`+`["response",optId]`, `publishThunk`. Ergebnis-Balken + eigener Vote-Zustand. Poll-**Erstellen** bleibt raus. |
| **C6** (Kür/Backlog) — Attachments (Blossom + NIP-92 `imeta`) + Thread-Ansicht (NIP-22 kind 1111) | Kür, groß | ⬜ offen | **Blossom**-Upload (BUD-Spec) im Composer + `imeta`-Tags am kind-9 (Render steht seit B6); tiefe/cross-room Thread-/Kommentar-Ansicht (heute bewusst nicht nachladend). Erst nach Freigabe. |
| **C7** (Kür/Backlog) — Zaps (NIP-57) | Kür, groß | ⬜ offen | Zap auf Nachricht/Autor: WebLN/Wallet-Anbindung, `zap request` kind 9734, Zap-Receipt kind 9735 aggregieren. `lud16` wird bis dahin nur angezeigt. Erst nach Freigabe. |
| **C8** (Kür/Backlog) — Admin-Moderation (NIP-86 BanEvent-Delete / Pin) | Kür, groß | ⬜ offen | Space-Admins moderieren fremde Nachrichten via **relay-signevent** (NIP-86) gegen zooid — **kein User-Publish**, eigener Signatur-/Auth-Pfad. Erst nach Freigabe. |
| **X** — Hart ausgeschlossen | — | 🚫 ausgeschlossen | DMs (NIP-17), LiveKit/Voice, Poll-**Erstellen**. Nicht Teil von PLAN5. |

> **Test-Grundsatz (wie PLAN4):** Jede Phase wird programmatisch getestet, bevor sie ✅ gilt. **Jede neue Publish-Aktion ist ein Browser-Pfad** (Signieren + Relay-Roundtrip) → **Playwright-E2E** (Host-Chromium `/bin/chromium`, hermetischer In-Process-zooid via `window.__nostrRelays`): Aktion auslösen → korrektes Event am Relay (kind + Tags) → optimistisches UI → Reject-Rollback. Reine Blade-/Route-/Parser-/Logik-Änderungen (Tag-Bau, Content-Präfix) → **Pest** (Functional-Style, Laravel 13). Reine Tag-Erzeugung als welshman-freie JS-Unit testbar. Vor jedem Commit: `vendor/bin/pint --dirty` + `npm run build` + `code-simplifier`, dann sofort `git push` (auch im Package-Repo `master`).

---

## C0 — Schreib-Fundament + Reply härten + Interaktions-Menü — **blockierend, zuerst**

**Ziel:** (1) Den vorhandenen Reply-Pfad gegen flotillas exakte Tag-Semantik verifizieren und Lücken schließen (v.a. PROTECTED). (2) Ein **generisches Interaktions-Menü pro Nachricht** anlegen (Desktop-Popover, Mobile-Modal) — der eine Andockpunkt, an dem C1–C4 nur noch Einträge ergänzen. (3) Die welshman-Publish-Helfer zentral in `js/interactions.ts` bündeln (aus flotilla portiert), damit die Folgephasen nur noch `makeReaction`/`makeDelete`/… aufrufen.

### C0.1 Ist-Stand (bereits vorhanden — nicht neu bauen)

Reply ist im Ziel-Projekt end-to-end verdrahtet:
- **Publish:** `sendRoomMessage(url, h, content, reply?)` (`js/feeds.ts:272`). Bei gesetztem `reply`: `nip19.neventEncode` als Content-Präfix `nostr:nevent…\n\n` + Tags `['q', id, url, pubkey]` und `['p', pubkey, url]` (`js/feeds.ts:280-283`). Kein NIP-10 `e`-Reply — korrekt für NIP-29.
- **UI-State:** `replyTo`, `setReply(m)`, `clearReply()` (`js/bridge.ts:286,1009,1016`); `send()` reicht `{id, pubkey}` durch und stellt bei Fehler den Reply-Kontext wieder her (`js/bridge.ts:1029-1040`).
- **Composer-Kontext:** Zitat-Box mit Abbrechen (`resources/views/⚡room.blade.php:219-226`); Antworten-Trigger pro Zeile (`⚡room.blade.php:182` `x-on:click.stop="setReply(m)"`).
- **Parent-Render:** `deriveRoomChat` löst das `q`-Tag im selben Raum auf → `ReplyPreview {id,name,text}` (`js/feeds.ts:205-209`); Klick springt via `scrollToMessage` + Flash-Highlight (`js/bridge.ts:965`).

### C0.2 Verifizieren & härten (der eigentliche C0-Arbeitsanteil)

| Gap | Ist-Zustand | Fix | Sev | Aufw |
|---|---|---|---|---|
| PROTECTED `["-"]` fehlt evtl. | `sendRoomMessage` setzt nur `['h',h]` (`js/feeds.ts`), flotilla setzt zusätzlich `["-"]` wenn `canEnforceNip70(url)` (`+page.svelte:180`) | `canEnforceNip70(url)` aus welshman prüfen; wenn true, `["-"]` an **alle** Room-Publishes (Message, Reply, künftig Reaction/Delete) anhängen. Zentral in `js/interactions.ts` kapseln (`roomTags(h, url)` → `[['h',h], …protected]`). | hoch | S |
| Reply-Tags vs. flotilla | Ziel setzt `['q',id,url,pk]`+`['p',pk,url]`; flotilla setzt zusätzlich Display-Name im p-Tag (`tagPubkey`→`["p",pk,hint,name]`) | Abgleichen: Name im p-Tag ist optional (nur Hint) — dokumentieren, ob übernommen. Relay-Hint konsistent zu `url`. | niedrig | S |
| Kein Interaktions-Menü | Nur „Antworten" pro Zeile; kein gemeinsamer Andockpunkt für Reactions/Delete/Report/Copy | Generisches Menü bauen (C0.3). | hoch | M |

### C0.3 Interaktions-Menü (neuer Andockpunkt)

flotilla trennt Desktop-Popover (`RoomItemMenu.svelte`) und Mobile-Modal (`RoomItemMenuMobile.svelte`). Hier **eine View, Seam statt Fork** (bindende Konvention `PLAN3.md:141`):

- **Trigger:** Hover-/Longpress-Aktionsleiste an der Nachrichtenzeile in `⚡room.blade.php`. Desktop: `flux:dropdown`/Popover; Mobile: `flux:modal` (Custom-Event-Steuerung `dispatchModal`, `js/bridge.ts:103`). Entscheidungsleiter: kleiner Block → Inline-`@mobile`/`@web`-Seam; native Chrome → `<native:*>` in `@mobile`.
- **Einträge (C0 liefert nur die Struktur + „Antworten"):** „Antworten" (vorhanden), Platzhalter-Slots für die folgenden Phasen. Jeder Eintrag ist ein Alpine-`x-on:click`, der eine Insel-Methode ruft.
- **Alpine-State:** neue Methoden an `nostrRoomChat` (`js/bridge.ts`): `openMessageMenu(m)`, `closeMessageMenu()`. Menü-Zustand als `this.menuFor = m.id`.
- **Design:** Brand-Ramp, `surface-card`, `rounded-tile`, `pressable`, `text-muted`. Kein rohes `<button>` — Flux-Pflicht.

### C0.4 `js/interactions.ts` (Publish-Helfer, aus flotilla portiert)

Neues Modul im Package (`packages/einundzwanzig-group/js/interactions.ts`), aus flotillas `reactions.ts`/`deletes.ts`/`reports.ts`/`groups.ts` portiert. C0 legt Gerüst + `roomTags`; die konkreten `make*`-Funktionen kommen mit ihrer Phase.

```ts
import { makeEvent, MESSAGE } from '@welshman/util'
import { publishThunk, waitForThunkError } from '@welshman/app'
// import { canEnforceNip70 } from '<welshman relays helper>'  // API im Quellcode verifizieren

// Zentrale NIP-29/NIP-70-Tags für JEDE Room-Aktion:
export const roomTags = (h: string, url: string): string[][] => {
  const tags = [['h', h]]
  if (canEnforceNip70(url)) tags.push(['-'])   // PROTECTED, NIP-70
  return tags
}

// Reply/Quote = NIP-18/21 (Parent als nostr:nevent-Präfix + q + p), NICHT NIP-10 e-reply.
// Bereits in feeds.ts:sendRoomMessage umgesetzt — hier ggf. konsolidieren.
```

**Signing/Publish-Muster (für alle Folgephasen identisch):** `const thunk = publishThunk({relays:[url], event: makeXxx(...)}); const err = await waitForThunkError(thunk); if (err) { repository.removeEvent(thunk.event.id); /* Toast + Retry */ }` — optimistisch, Reject-Rollback, deutscher Fehlertext via `mapRelayError` (`js/feeds.ts:249`).

**Dateien C0:** `js/interactions.ts` (neu), `js/feeds.ts` (PROTECTED nachrüsten), `js/bridge.ts` (`openMessageMenu`/`closeMessageMenu`), `resources/views/⚡room.blade.php` (Aktionsleiste + Menü, Web/Mobile-Seam).

**Testplan C0:**
- **E2E (Playwright/zooid):** Reply-Roundtrip: Nachricht A senden → auf A „Antworten" → Text senden → am Relay landet kind-9 mit `content` `nostr:nevent…\n\n<text>`, Tags `q`+`p`+`h` (und `["-"]` wenn zooid NIP-70 meldet). UI: Zitat-Box vor Absenden, Parent-Vorschau im Reply, Klick springt zum Parent (Flash). Reject-Fall: Relay lehnt ab → optimistische Nachricht verschwindet + Retry-Zeile.
- **Pest/JS-Unit:** `roomTags(h,url)` setzt `["-"]` nur bei `canEnforceNip70`=true; Reply-Content-Präfix + Tag-Shape (welshman-frei prüfbar).
- **Beide Laufzeiten:** Menü öffnet Web (Popover) und Mobile (Modal).

**DoD C0:** Reply produziert exakt flotillas Tag-/Content-Form inkl. PROTECTED; das Interaktions-Menü ist als gemeinsamer Andockpunkt live (Web+Mobile); `js/interactions.ts` + `roomTags` stehen; E2E Reply-Roundtrip grün; `pint`+`build`+`code-simplifier`+`push`.

---

## C1 — Emoji-Reactions (NIP-25 kind 7, Custom-Emoji NIP-30) + Toggle-Delete

**Ziel:** Members reagieren mit Emoji auf eine kind-9-Nachricht; erneuter Klick entfernt die eigene Reaction (NIP-09-Delete der kind-7). Aggregierte Reaction-Summary mit Zähler + eigenem Toggle-Zustand.

- **kind / Tags:** kind 7. `tagEventForReaction(event)` → `["p", pk, hint]?`, `["k","9"]`, `["e", id, hint]`, dazu `roomTags(h, url)` (`h` vom Parent via `getTag("h", event.tags)`). Custom-Emoji NIP-30: `content=":shortcode:"` + `["emoji", shortcode, url]`. Standard-Reaction `content="+"`.
- **welshman-API:** `makeReaction` (flotilla `@app/reactions.ts:14` → `tagEventForReaction`), `publishReaction`→`publishThunk`. Toggle-Löschen: `makeDelete` mit `["k","7"]`+`tagEvent(reaction)`+`h` (flotilla `@app/deletes.ts:12`), `publishDelete`.
- **Anzeige:** aggregiert kinds 7 per `#e` — in `js/feeds.ts` einen `deriveReactions(url, messageId)`-Store analog `deriveRoomMessages` bauen; in `ChatMessage` ein `reactions: {emoji, count, mine}[]`-Feld. **Render-Pfad für Custom-Emoji steht bereits** (B6: `renderEmojiImg`, Inline-`<img class="chat-emoji">` über Bild-Proxy, nur https).
- **UI:** Reaction-Picker als Menü-Eintrag (C0-Menü) → kleine Emoji-Auswahl (Standard-Set + Space-Custom-Emoji aus NIP-30-Definition). Summary als Chip-Reihe unter der Nachricht (`surface-card`/`rounded-tile`), Chip toggelt. Flux-Komponenten, Brand-Ramp.
- **Dateien:** `js/interactions.ts` (`makeReaction`/`makeDelete`-Reaction-Variante), `js/feeds.ts` (`deriveReactions`, `ChatMessage.reactions`), `js/bridge.ts` (`react(m, emoji)`, `unreact(m, emoji)`), `⚡room.blade.php` (Picker + Summary-Chips).
- **Signing/PROTECTED/h/AUTH:** ja / `["-"]` cond. / `h` vom Parent / AUTH automatisch.
- **Aufwand:** klein (Reaction) + klein (Toggle) + mittel (Summary-Store) = **M**.

**Testplan C1:** E2E: Reaction klicken → kind-7 am Relay mit `["e",id]`,`["k","9"]`,`["h",h]` (+`["-"]`); Chip erscheint mit count=1/mine=true; erneut klicken → kind-5-Delete am Relay, Chip verschwindet; Custom-Emoji → Chip zeigt Inline-`<img>`. JS-Unit: `makeReaction`-Tag-Shape, Emoji-Tag. Pest: Summary-Aggregation-Logik falls server-nah.

**DoD C1:** Reagieren + Toggle-Entfernen laufen als Relay-Roundtrip; Summary zeigt korrekten Zähler + eigenen Zustand; Custom-Emoji rendert; E2E grün; Vor-Commit-Ritual.

---

## C2 — Delete eigene Nachricht (NIP-09 kind 5) + Report (NIP-56 kind 1984)

**Ziel:** Eigene Nachricht löschen (im Menü, mit Bestätigung); fremde Nachricht melden.

- **Delete (vorhanden, nur einhängen):** `deleteRoomMessage` (`js/feeds.ts:302`) existiert (kind 5, `["k","9"]`+`tagEvent`+`h`, `created_at=max(now,createdAt+1)`). C2 = Menü-Eintrag „Löschen" (nur bei eigener Nachricht `m.mine`) + Bestätigungs-Modal (`flux:modal`, analog flotilla `EventDeleteConfirm.svelte`). Optimistisches Entfernen aus dem Feed.
- **Report:** kind 1984. Tags `["p", pk]`, `["e", id, reason]`, `content` = Detailtext. `makeReport` (flotilla `@app/reports.ts:11`), `publishReport`→`publishThunk`. UI: Grund-Auswahl (`flux:select`, NIP-56-reasons: spam/illegal/…) + optionaler Freitext. **Kein `h`-Tag / kein PROTECTED** (Report geht nicht als Group-Message).
- **Dateien:** `js/interactions.ts` (`makeReport`), `js/bridge.ts` (`confirmDelete(m)`, `report(m, reason, text)`), `⚡room.blade.php` (Delete-Confirm-Modal existiert bereits — Report-Modal ergänzen).
- **Signing/PROTECTED/h/AUTH:** Delete: ja / cond. / `h` / AUTH. Report: ja / — / — / AUTH.
- **Aufwand:** klein + klein = **S/M**.

**Testplan C2:** E2E: eigene Nachricht → „Löschen" → Confirm → kind-5 am Relay, Zeile weg; Report → kind-1984 mit `["p"]`+`["e",id,reason]`. Pest: „Löschen" nur bei `m.mine` sichtbar (Blade-Guard, beide Laufzeiten).

**DoD C2:** Delete-Menüeintrag + Confirm live; Report end-to-end; E2E grün; Ritual.

---

## C3 — Edit (eigene, <5 min) + Quote/Share

**Ziel:** Kurz nach dem Senden die eigene Nachricht korrigieren; beliebiges Event als Zitat in den Chat teilen.

- **Edit:** Kein NIP-Edit-Event — **Delete + Re-Publish mit gleichem `created_at`** (flotilla `+page.svelte:187-214`). Guard `canEditEvent` = eigener pk **und** `created_at >= ago(5, MINUTE)`. Ablauf: `publishDelete` des Alten + `makeEvent(MESSAGE, {content, tags, created_at})` (ursprüngliches `created_at` beibehalten). Composer wird mit altem Text vorbefüllt; Menü-Eintrag „Bearbeiten" nur wenn `canEditEvent`.
- **Quote/Share:** `prependParent(event, template, url)`-Pfad ohne Reply-Ziel — Event in den Chat teilen. Reiner Share (leerer Text) = **Quote-Only**: `content` nur `nostr:nevent…`, `["q",…]`. Render: `RoomItem`-Quote-Only-Sonderfall → inneres Event direkt rendern + Kommentar-Zähler (flotilla `RoomItem.svelte:65-72,124`). Im Ziel-Projekt teilt sich das den Reply-Compose-Kontext (`RoomComposeParent` mit `verb="Sharing"` in flotilla) — hier Zitat-Box mit „Teilen"-Label.
- **Dateien:** `js/interactions.ts`/`js/feeds.ts` (`editRoomMessage`, `shareToRoom`), `js/bridge.ts` (`startEdit(m)`, `share(m)`), `⚡room.blade.php` (Edit-Mode im Composer, Share-Kontext-Box, Quote-Only-Render).
- **Signing/PROTECTED/h/AUTH:** beide: ja / cond. / `h` / AUTH.
- **Aufwand:** mittel + mittel = **M**.

**Testplan C3:** E2E: eigene Nachricht (frisch) → „Bearbeiten" → Text ändern → altes kind-5-Delete + neues kind-9 mit gleichem `created_at`; Nachricht >5 min alt → kein „Bearbeiten". Share: Event teilen → Quote-Only-kind-9 mit `["q"]`, Render zeigt inneres Event. JS-Unit: `canEditEvent`-Grenze (5 min), `prependParent`-Content/Tags.

**DoD C3:** Edit (delete+republish, 5-min-Guard) + Quote/Share (inkl. Quote-Only-Render) live; E2E grün; Ritual.

---

## C4 — Mentions (NIP-08/NIP-27) + Copy nevent/npub/JSON + Nachricht-Info

**Ziel:** `@`-Erwähnungen im Composer; Kopier-/Debug-Aktionen im Menü.

- **Mentions:** `@`-Autocomplete im Composer über Space-Mitglieder (Directory-Daten, bereits geladen). Eingefügt als `nostr:npub…` im Text + `["p", pk, hint]`-Tag. `nip19.npubEncode`, `tagPubkey`. Render-Pfad (npub→Name) läuft über welshmans Content-Parser (bereits aktiv).
- **Copy nevent/npub/JSON (nur lesen, kein Publish):** Menü-Einträge. `nip19.neventEncode({...event, relays})` (Seen-On via `tracker.getRelays(event.id)`), `npubEncode(pubkey)`, Roh-JSON. `clip()`→Toast (flotilla `EventInfo.svelte`). Mobile: nativer Share-Sheet-Fallback hinter `function_exists('nativephp_call')`-Guard.
- **Nachricht-Info:** kleines Modal mit Roh-Event, `created_at`, Seen-On-Relays (`tracker.getRelays`).
- **Dateien:** `js/bridge.ts` (`copyNevent(m)`, `copyNpub(m)`, `copyJson(m)`, `mention()`-Composer-Logik), `⚡room.blade.php` (Autocomplete-Popover, Info-Modal, Copy-Einträge).
- **Signing/PROTECTED/h/AUTH:** Mention-Message: ja / cond. / `h` / AUTH. Copy/Info: nein (nur lesen).
- **Aufwand:** klein.

**Testplan C4:** E2E: `@` → Vorschlagsliste → Auswahl → Nachricht enthält `nostr:npub…` + `["p"]`. Copy: Menü → Klick → Clipboard enthält `nevent1…`/`npub1…`/JSON (Playwright Clipboard-Read). Pest: Info-Modal-Render.

**DoD C4:** Mention-Autocomplete + p-Tag; Copy-nevent/npub/JSON + Info live (Web+Mobile-Share-Guard); E2E grün; Ritual.

---

## C5 — Poll-Vote (NIP-88 kind 1018) — Kern-Staffel

**Ziel:** Members stimmen über eine als kind-9 geteilte Poll ab; Ergebnis-Balken + eigener Vote-Zustand. Poll-**Erstellen** bleibt ausgeschlossen (nur abstimmen).

- **kind / Tags:** kind 1018 Poll-Response. `["e", pollId, hint]` + je gewählter Option `["response", optionId]`, dazu `roomTags(h, url)`. `makePollResponse` (flotilla `@app/polls.ts:84`) → `publishThunk`.
- **Anzeige:** Poll-Optionen aus dem geteilten Poll-Event (kind 1068), Stimmen aggregiert per `#e` über kind-1018 (analog `deriveReactions` aus C1) → Balken pro Option, eigener Vote hervorgehoben, Einfach-/Mehrfachwahl aus dem Poll-Tag respektieren.
- **Dateien:** `js/interactions.ts` (`makePollResponse`), `js/feeds.ts` (`derivePollTally(url, pollId)`), `js/bridge.ts` (`votePoll(m, optionIds)`), `⚡room.blade.php` (Poll-Render mit Balken/Buttons).
- **Signing/PROTECTED/h/AUTH:** ja / `["-"]` cond. / `h` / AUTH automatisch.
- **Aufwand:** mittel (M).

**Testplan C5:** E2E: geteilte Poll → Option wählen → kind-1018 am Relay mit `["e",pollId]`+`["response",optId]` (+`["-"]`); Balken aktualisiert, eigener Vote markiert; erneute Wahl ändert Stimme. JS-Unit: `makePollResponse`-Tag-Shape, Einfach-/Mehrfachwahl-Regel. Pest: Tally-Aggregation falls server-nah.

**DoD C5:** Abstimmen läuft als Relay-Roundtrip; Tally + eigener Zustand korrekt; E2E grün; Vor-Commit-Ritual.

---

## C6–C8 — Kür/Backlog (erst nach ausdrücklicher Auftraggeber-Freigabe)

> Groß, eigene Design-/Infra-Fragen. Je Sub-Feature einzeln getestet (E2E-Roundtrip) und abgenommen.

### C6 — Attachments (Blossom) + Thread-Ansicht (NIP-22)

- **Attachments / Bild senden — Upload-Weg: Blossom (entschieden).** Blossom-Client (BUD-Spec, hash-basiert, `Authorization`-Event kind 24242) lädt die Datei hoch; Ergebnis-URL + `imeta`-Tags (`["imeta","url …","m …","x …"]`) am kind-9. Composer ist heute eine simple `flux:textarea` → Upload-Button + Vorschau separat bauen. Render (Bild-URLs → `<img class="chat-image">` über Bild-Proxy) steht bereits (`renderMessageLink`). **groß (L).**
- **Thread-Ansicht (NIP-22 kind 1111 COMMENT):** tiefe/cross-room Ansicht. Heute lädt `scrollToMessage` bewusst nicht nach, wenn das Zitat älter als der geladene Verlauf ist (`js/bridge.ts:963-964`). Kommentar-Anzeige an Quote-Only-Nachrichten (`deriveEventsForUrl(url,[{kinds:[COMMENT],"#e":[qId]}])`), Kommentieren via `makeComment`→`tagEventForComment`. **mittel (M).**

### C7 — Zaps (NIP-57)

- Zap auf Nachricht/Autor. WebLN- bzw. Wallet-Anbindung im Browser (Server nie im Zahlungspfad), `zap request` kind 9734 an LNURL-Callback des Autors (`lud16`), Zap-Receipt kind 9735 aggregieren und als ⚡-Chip/Betrag an der Nachricht anzeigen. `lud16` wird bis dahin nur angezeigt (`PLAN4.md:22`). flotilla-Referenz: `src/app/lightning.ts`. **groß (L).**

### C8 — Admin-Moderation (NIP-86 BanEvent-Delete / Pin)

- Space-Admins moderieren **fremde** Nachrichten. **Kein User-Publish**, sondern **NIP-86 relay-signevent** (JSON-RPC über HTTP an zooid, eigener NIP-98-Auth-Pfad) — anderer Signatur-/Transport-Weg als alle C0–C7-Aktionen. Nur für Admins (Rollen-Check gegen NIP-29-Members/39001). Referenz: zooid NIP-86-Weiche (`[[zooid-nginx-nip86-weiche]]`). **groß (L).**

**DoD C6–C8:** pro Sub-Feature einzeln, nach Freigabe.

---

## Reihenfolge & Abhängigkeiten

1. **C0 zuerst und blockierend** — Reply härten (PROTECTED!) + Interaktions-Menü + `js/interactions.ts`/`roomTags`. Alles Folgende dockt am C0-Menü und an `roomTags` an.
2. **C1** (Reactions) direkt danach — höchster Member-Nutzen, Render-Infrastruktur (Custom-Emoji) steht.
3. **C2** (Delete-Einhängen + Report) und **C4** (Mentions/Copy) sind klein, parallelisierbar nach C0.
4. **C3** (Edit/Quote) nach C1 (teilt Compose-Kontext-Muster).
5. **C5** (Poll-Vote) nach C1 (teilt den `#e`-Aggregations-Store `deriveReactions`/`derivePollTally`).
6. **C6–C8** (Attachments/Thread, Zaps, Admin-Moderation) nur nach Auftraggeber-Freigabe.

**Package-Kopplung (bindend):** Aller Publish-Code entsteht im Package `einundzwanzig/group` (`packages/einundzwanzig-group`, Namespace `Einundzwanzig\Group\`), NIE im Portal-`vendor` editieren. Schnittstellen-Rename = 3 Repos + `composer update` + `view:clear`; `require` immer `dev-master`. Nach jedem Commit sofort `git push` auf `master` des Package-Repos.

## Entschieden (Auftraggeber, 2026-07-09)

1. **Zaps (NIP-57):** nicht hart ausgeschlossen → eigene **Kür-Phase C7** (nach Freigabe). Bis dahin `lud16` reiner Anzeige-Chip.
2. **Attachments (C6):** Upload über **Blossom** (nicht NIP-96).
3. **Poll-Vote (NIP-88):** relevant → **in die Kern-Staffel hochgezogen (C5)**. Poll-Erstellen bleibt raus.
4. **Admin-Moderation (NIP-86 BanEvent/Pin):** gewünscht → eigene **Kür-Phase C8** (Relay-Management-Pfad, nicht User-Publish; nach Freigabe).
5. **Reaction-Emoji-Set (C1):** **Standard-Set + Space-Custom-Emoji (NIP-30)** als Picker-Quelle.
