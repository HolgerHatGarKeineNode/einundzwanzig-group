# Mitentwickeln

Das Chat-Package `einundzwanzig/group` (Spaces/Räume/Directory/Login) lebt in einem
**eigenen Repo**: <https://github.com/HolgerHatGarKeineNode/einundzwanzig-group-package>
(Branch `master`). Der Ordner `packages/einundzwanzig-group/` ist **gitignored** — Composer wählt
die Quelle automatisch (Weiche):

| Situation | Was Composer nimmt |
|---|---|
| `packages/einundzwanzig-group/` liegt als Clone vor | **Symlink** auf den lokalen Ordner (schnelles Dev) |
| Ordner fehlt (frischer Clone / CI) | Package als `dev-master` von GitHub |

## Nur an der App arbeiten

Nichts weiter nötig — `composer install` zieht das Package von GitHub:

```bash
git clone git@github.com:HolgerHatGarKeineNode/einundzwanzig-group.git
cd einundzwanzig-group
composer install
```

## Am Chat-Package mitentwickeln (Symlink-Dev)

Das Package-Repo in `packages/einundzwanzig-group/` klonen — dann greift der Symlink:

```bash
git clone git@github.com:HolgerHatGarKeineNode/einundzwanzig-group-package.git packages/einundzwanzig-group
composer update einundzwanzig/group   # bindet den lokalen Ordner als Symlink ein
```

Änderungen am Package sind sofort live (Symlink). Committen/pushen läuft **im Package-Ordner**
gegen das Package-Repo, App-Git-Operationen laufen im Projekt-Root:

```bash
cd packages/einundzwanzig-group && git add -A && git commit -m "…" && git push   # → Package-Repo (master)
```

> `git push` im Package-Ordner aktualisiert `dev-master` — damit sehen auch Fremd-Clones
> und CI die Änderung. Lokal reicht der Symlink, kein Tag/Release nötig.
