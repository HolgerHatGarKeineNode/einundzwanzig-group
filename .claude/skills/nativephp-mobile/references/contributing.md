# NativePHP Mobile v3 — Contributing

> Quelle: Deep-Scan der offiziellen Doku (nativephp.com, Stand 2026-06-11). 1 Seiten.

---

## Contributing (NativePHP Mobile v3)

<https://nativephp.com/docs/mobile/3/contributing/contributing>

Die Seite beschreibt ausschließlich den Beitrags-Workflow zum NativePHP-Mobile-Projekt (Repository: NativePHP/mobile-air auf GitHub) — sie enthält keine App-Implementierungs-APIs. Inhalt: (1) Einleitung: Beiträge sind willkommen — Bugfixes, neue Features, Doku-Verbesserungen und Bug-Reports. (2) "How to Contribute" in 7 Schritten: Repository auf GitHub forken; lokal klonen (git clone git@github.com:your-username/mobile-air.git); Feature-Branch anlegen (git checkout -b feature/my-new-feature); Änderungen machen und testen; mit beschreibenden Commit-Messages committen; in den eigenen Fork pushen (git push origin feature/my-new-feature); Pull Request gegen den main-Branch öffnen. (3) Pull-Request-Richtlinien: Änderungen fokussiert halten; klare, beschreibende Commit-Messages; Tests für neue Funktionalität schreiben; alle bestehenden Tests müssen weiterhin bestehen; bei API-Änderungen die Dokumentation aktualisieren. (4) Bug-Reports: als GitHub-Issue mit klarem, beschreibendem Titel, Reproduktionsschritten, erwartetem vs. tatsächlichem Verhalten sowie Umgebungsdetails (Betriebssystem, PHP-Version, Laravel-Version). (5) Sicherheitslücken: KEIN öffentliches Issue öffnen, sondern per E-Mail an das Sicherheitsteam melden (E-Mail-Adresse auf der Seite per Cloudflare-Schutz maskiert, Domain nativephp.com); das Projekt verspricht zeitnahe Behebung aller Sicherheitsprobleme. (6) Code of Conduct: einladende/inklusive Sprache, Respekt für abweichende Meinungen, Empathie; verboten sind sexualisierte Inhalte/Sprache, Trolling, Beleidigungen, Belästigung und das Veröffentlichen privater Informationen Dritter ohne Erlaubnis; Durchsetzungs-Kontakt ebenfalls per (maskierter) E-Mail. Randinformationen der Seite: Doku-Versionen 1.x/2.x/3.x (Mobile) bzw. 2.x (Desktop); Verweise auf Plugin Dev Kit (nativephp.com/products/plugin-dev-kit), NativePHP Ultra (nativephp.com/ultra) und The Masterclass (nativephp.com/course). Für den Implementierungsplan einer Laravel/Livewire/Flux-App ist diese Seite nur relevant, falls Upstream-Beiträge oder Bug-Reports an NativePHP Mobile geplant sind.

### Befehle

```bash
git clone git@github.com:your-username/mobile-air.git
cd mobile-air
git checkout -b feature/my-new-feature
git push origin feature/my-new-feature
```

### Stolperfallen

- Pull Requests müssen gegen den main-Branch des Repos NativePHP/mobile-air gestellt werden (vorher forken).
- PR-Anforderungen: fokussierte Änderungen, klare Commit-Messages, Tests für neue Funktionalität, alle bestehenden Tests müssen bestehen, Doku bei API-Änderungen aktualisieren.
- Bug-Reports als GitHub-Issue mit Titel, Reproduktionsschritten, erwartetem vs. tatsächlichem Verhalten und Umgebungsdetails (OS, PHP-Version, Laravel-Version).
- Sicherheitslücken NIEMALS als öffentliches Issue melden, sondern per E-Mail; die genauen E-Mail-Adressen (Security und Code-of-Conduct-Enforcement) sind auf der Seite durch Cloudflare-E-Mail-Schutz maskiert (Domain nativephp.com) und konnten nicht exakt extrahiert werden.
- Code of Conduct gilt: keine sexualisierten Inhalte, kein Trolling/Belästigung, keine Veröffentlichung privater Informationen ohne Erlaubnis.
- Die Seite enthält keine technischen APIs, Befehle zur App-Entwicklung, Konfiguration oder expliziten Lizenzhinweise — sie betrifft ausschließlich Beiträge zum Framework selbst; verwandte kommerzielle Angebote (Plugin Dev Kit, NativePHP Ultra, Masterclass) werden nur verlinkt.
