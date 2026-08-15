<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Support\I18nScanner;
use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;

/**
 * CLI-Zugang zum Vollständigkeits-Scanner (siehe {@see I18nScanner}).
 *
 * Der Nachweis „0 fehlende Schlüssel" hängt NICHT an diesem Befehl — er hängt
 * am Test `tests/Feature/I18nCatalogGateTest.php`, der denselben Scanner fährt.
 * Der Befehl ist das Werkzeug für die Hand: er sagt, WELCHE Schlüssel fehlen
 * und WO sie gerufen werden, wenn das Gate rot ist.
 */
#[Signature('i18n:scan {--list : Nur die fehlenden Schlüssel, einer je Zeile} {--detail : Fehlende Schlüssel samt Fundstellen}')]
#[Description('Prüft, welche gerufenen __()-Schlüssel in den sieben Sprachkatalogen fehlen.')]
class I18nScan extends Command
{
    public function handle(I18nScanner $scanner): int
    {
        $result = $scanner->scan();

        if ($this->option('list')) {
            foreach (array_keys($result['missing']) as $key) {
                $this->line($key);
            }

            return $result['missing'] === [] ? self::SUCCESS : self::FAILURE;
        }

        if ($this->option('detail')) {
            foreach ($result['missing'] as $key => $locales) {
                $this->line(json_encode($key, JSON_UNESCAPED_UNICODE).'  fehlt in: '.implode(',', $locales));
                foreach (array_unique($result['calls'][$key]) as $site) {
                    $this->line('    '.$site);
                }
            }
            $this->newLine();
        }

        // Die Insel separat beziffert (P10): „0 fehlend" allein über beide
        // Welten könnte einen blinden TS-Pfad nicht von einem vollen
        // unterscheiden — hier stehen die beiden Zahlen nebeneinander.
        $tsSites = function (array $sites): bool {
            foreach ($sites as $site) {
                if (str_ends_with((string) preg_replace('/:\d+$/', '', $site), '.ts')) {
                    return true;
                }
            }

            return false;
        };
        $tsFiles = array_filter($result['files'], fn (string $f): bool => str_ends_with($f, '.ts'));
        $tsKeys = array_filter($result['calls'], $tsSites);
        $tsMissing = array_intersect_key($result['missing'], $tsKeys);

        $this->line('Dateien gescannt:        '.count($result['files']).' (davon TypeScript: '.count($tsFiles).')');
        $this->line('Verschiedene __()-Keys:  '.count($result['keys']));
        $this->line('t()-Keys (TS-Insel):     '.count($tsKeys));
        $this->line('FEHLENDE Keys:           '.count($result['missing']).' (davon t(): '.count($tsMissing).')');
        $this->line('Verkettete Fragmente:    '.count($result['chained']));
        foreach (array_unique($result['chained']) as $entry) {
            $this->line('    '.$entry);
        }
        $this->line('Nicht messbar (dynamisch): '.count($result['dynamic']));
        foreach (array_unique($result['dynamic']) as $entry) {
            $this->line('    '.$entry);
        }

        return $result['missing'] === [] && $result['chained'] === [] ? self::SUCCESS : self::FAILURE;
    }
}
