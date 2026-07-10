package com.einundzwanzig.ambersigner

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.fragment.app.FragmentActivity
import com.nativephp.mobile.bridge.BridgeFunction
import com.nativephp.mobile.utils.NativeActionCoordinator
import org.json.JSONObject

/**
 * Amber NIP-55 Same-Device-Signer über den ContentResolver-Weg.
 *
 * Der ContentResolver ist SYNCHRON (query() blockiert bis zum Ergebnis) — deshalb
 * passt er in NativePHPs synchrone Bridge (execute() gibt direkt eine Map zurück)
 * und damit in welshmans synchronen `signer.sign()`-Vertrag, OHNE Activity/
 * Navigation. Kein Relay, kein Netz: App-zu-App auf demselben Gerät.
 *
 * Voraussetzung: die App-Berechtigungen sind in Amber „gemerkt" (per einmaligem
 * get_public_key-Intent mit permissions-Liste vorab gewährt). Ist ein Request NICHT
 * vorab gewährt, liefert Amber einen NULL-Cursor → wir geben `authorized:false`
 * zurück; die JS-Schicht fällt dann auf den sichtbaren Intent- bzw. Relay-Weg zurück.
 * Hat der Nutzer „immer ablehnen" gewählt, kommt eine `rejected`-Spalte → NICHT
 * auf Intent zurückfallen.
 *
 * ANDROID 11+ PACKAGE-VISIBILITY: Der Zugriff auf Ambers ContentProvider erfordert
 * einen <queries>-Eintrag im AndroidManifest (package com.greenart7c3.nostrsigner
 * bzw. provider-authority). Wird beim Build gepatcht (siehe Plugin-README/Manifest-
 * Patcher). Fehlt er, liefert query() immer null → authorized:false.
 */
object AmberSignerFunctions {

    private const val DEFAULT_AMBER_PACKAGE = "com.greenart7c3.nostrsigner"
    private const val TAG = "AmberSigner"

    private fun amberPackage(parameters: Map<String, Any>): String =
        (parameters["amberPackage"] as? String)?.takeIf { it.isNotBlank() } ?: DEFAULT_AMBER_PACKAGE

    /**
     * Generischer ContentResolver-Aufruf an Amber. `type` = SIGN_EVENT / NIP44_ENCRYPT /
     * NIP44_DECRYPT / GET_PUBLIC_KEY (Großbuchstaben, Teil der Provider-Authority).
     * projection trägt [payload, pubkey, current_user] (NIP-55). Rückgabe-Map:
     *   authorized:false            → nicht vorab gewährt / Provider unsichtbar
     *   rejected:true               → Nutzer hat „immer ablehnen" gewählt
     *   authorized:true, result, event → Erfolg (event nur bei sign_event)
     */
    private fun query(
        context: Context,
        pkg: String,
        type: String,
        payload: String,
        pubkey: String,
        currentUser: String,
    ): Map<String, Any> {
        val uri = Uri.parse("content://$pkg.$type")
        return try {
            context.contentResolver.query(
                uri,
                arrayOf(payload, pubkey, currentUser),
                null,
                null,
                null,
            ).use { cursor ->
                if (cursor == null || !cursor.moveToFirst()) {
                    return mapOf("authorized" to false)
                }

                val rejectedIdx = cursor.getColumnIndex("rejected")
                if (rejectedIdx >= 0 && cursor.getString(rejectedIdx)?.toBoolean() == true) {
                    return mapOf("rejected" to true)
                }

                val out = HashMap<String, Any>()
                out["authorized"] = true
                cursor.getColumnIndex("result").takeIf { it >= 0 }?.let { i ->
                    cursor.getString(i)?.let { out["result"] = it }
                }
                cursor.getColumnIndex("event").takeIf { it >= 0 }?.let { i ->
                    cursor.getString(i)?.let { out["event"] = it }
                }
                out
            }
        } catch (e: Exception) {
            Log.e(TAG, "ContentResolver $type fehlgeschlagen: ${e.message}", e)
            mapOf("authorized" to false, "error" to (e.message ?: "unknown"))
        }
    }

    /**
     * Einmaliger sichtbarer get_public_key-Login: öffnet Amber, damit der Nutzer die App
     * autorisiert und die `permissions` (alle unsere Kinds) als „gemerkt" gewährt — DANACH
     * beantwortet Amber sign/nip44 still per ContentResolver.
     *
     * Läuft über den `AmberSignerCoordinator` (startActivityForResult), damit Amber
     * `callingPackage` sieht und die App REGISTRIERT — nur dann funktioniert das
     * ContentResolver-Signieren. Das Ergebnis kommt async als `native-event`
     * `AmberSigner.PublicKeyReceived` zurück (in-page, keine Navigation).
     *
     * Params: permissions (JSON-Array-String), appName (optional), amberPackage (optional).
     */
    class RequestPublicKey(private val activity: FragmentActivity) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val permissions = parameters["permissions"] as? String ?: "[]"
            val appName = parameters["appName"] as? String ?: "EINUNDZWANZIG"
            val pkg = amberPackage(parameters)
            // Launch muss auf dem UI-Thread laufen (Fragment-Install + ActivityResultLauncher).
            Handler(Looper.getMainLooper()).post {
                try {
                    AmberSignerCoordinator.install(activity).requestPublicKey(permissions, appName, pkg)
                } catch (e: Exception) {
                    // Fehler ans JS melden — sonst hängt der Login-Promise ewig (dieser Pfad
                    // gibt synchron zurück, ein Fehler VOR launcher.launch() liefert sonst NIE
                    // ein native-event). Kann z. B. commitNow() werfen, wenn die App im Hintergrund ist.
                    Log.e(TAG, "get_public_key-Launch fehlgeschlagen: ${e.message}", e)
                    NativeActionCoordinator.dispatchEvent(
                        activity,
                        AmberSignerCoordinator.EVENT_PUBLIC_KEY,
                        JSONObject().put("rejected", true).put("error", e.message ?: "unknown").toString(),
                    )
                }
            }
            return emptyMap()
        }
    }

    /**
     * Sichtbare Signer-Op via startActivityForResult (interaktiver Amber-Prompt) — der
     * Fallback, wenn ContentResolver `authorized:false` liefert (Aktion nicht vorab gewährt,
     * z. B. Amber-Policy „manually approve"). `type` = sign_event | nip44_encrypt |
     * nip44_decrypt. Ergebnis async via native-event `AmberSigner.SignerResult` (mit `id`).
     * Params: type, payload, currentUser, pubkey (nur nip44), id, amberPackage.
     */
    class RequestSignerOp(private val activity: FragmentActivity) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val type = parameters["type"] as? String ?: return emptyMap()
            val payload = parameters["payload"] as? String ?: ""
            val currentUser = parameters["currentUser"] as? String ?: ""
            val counterparty = parameters["pubkey"] as? String
            val id = parameters["id"] as? String ?: ""
            val pkg = amberPackage(parameters)
            Handler(Looper.getMainLooper()).post {
                try {
                    AmberSignerCoordinator.install(activity).signerRequest(type, payload, currentUser, counterparty, id, pkg)
                } catch (e: Exception) {
                    // Fehler ans JS melden (mit id) — sonst wartet der Op-Promise ins Leere.
                    Log.e(TAG, "$type-Launch fehlgeschlagen: ${e.message}", e)
                    NativeActionCoordinator.dispatchEvent(
                        activity,
                        AmberSignerCoordinator.EVENT_SIGNER_RESULT,
                        JSONObject().put("id", id).put("rejected", true).put("error", e.message ?: "unknown").toString(),
                    )
                }
            }
            return emptyMap()
        }
    }

    /** True, wenn Amber (bzw. ein NIP-55-Signer) installiert ist. */
    class IsInstalled(private val context: Context) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val pkg = amberPackage(parameters)
            val installed = try {
                context.packageManager.getPackageInfo(pkg, 0)
                true
            } catch (e: Exception) {
                false
            }
            return mapOf("installed" to installed)
        }
    }

    /** sign_event via ContentResolver. payload = Event-JSON; Rückgabe „event" = signiertes JSON. */
    class SignEvent(private val context: Context) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val event = parameters["event"] as? String ?: ""
            val currentUser = parameters["currentUser"] as? String ?: ""
            return query(context, amberPackage(parameters), "SIGN_EVENT", event, "", currentUser)
        }
    }

    /** nip44_encrypt via ContentResolver. payload = Klartext, pubkey = Gegenpartei. */
    class Nip44Encrypt(private val context: Context) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val plaintext = parameters["plaintext"] as? String ?: ""
            val pubkey = parameters["pubkey"] as? String ?: ""
            val currentUser = parameters["currentUser"] as? String ?: ""
            return query(context, amberPackage(parameters), "NIP44_ENCRYPT", plaintext, pubkey, currentUser)
        }
    }

    /** nip44_decrypt via ContentResolver. payload = Ciphertext, pubkey = Gegenpartei. */
    class Nip44Decrypt(private val context: Context) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val ciphertext = parameters["ciphertext"] as? String ?: ""
            val pubkey = parameters["pubkey"] as? String ?: ""
            val currentUser = parameters["currentUser"] as? String ?: ""
            return query(context, amberPackage(parameters), "NIP44_DECRYPT", ciphertext, pubkey, currentUser)
        }
    }
}
