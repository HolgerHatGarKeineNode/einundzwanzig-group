<?php

namespace Einundzwanzig\AmberSigner;

use Illuminate\Support\ServiceProvider;

/**
 * Vom NativePHP-Plugin-System verlangter Provider-Einstiegspunkt. Der Amber-Signer
 * ist zustandslos — die Bridge-Funktionen (AmberSigner.*) werden client-seitig aus
 * der welshman-Insel per `nativeCall` über `/_native/api/call` aufgerufen; hier ist
 * kein Binding nötig.
 */
class AmberSignerServiceProvider extends ServiceProvider {}
