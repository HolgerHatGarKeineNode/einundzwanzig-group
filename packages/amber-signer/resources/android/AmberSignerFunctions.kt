package com.einundzwanzig.ambersigner

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import com.nativephp.mobile.bridge.BridgeFunction

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
     * Einmaliger sichtbarer get_public_key-Intent (Login): öffnet Amber, damit der
     * Nutzer die App autorisiert und die `permissions` (alle unsere Kinds) als
     * „gemerkt" gewährt — DANACH beantwortet Amber sign/nip44 still per ContentResolver.
     *
     * Fire-and-forget via `startActivity` (FLAG_ACTIVITY_NEW_TASK) → callingPackage ist
     * null → Amber liefert das Ergebnis an `callbackUrl` (unser Custom-Scheme
     * einundzwanziggroup://…), das die WebView zurück in die App navigiert. Das ist der
     * EINZIGE navigations-basierte Schritt; alles Weitere läuft synchron über ContentResolver.
     *
     * Params: permissions (JSON-Array-String), callbackUrl (roh, NICHT url-kodiert),
     * appName (optional), amberPackage (optional).
     */
    class RequestPublicKey(private val context: Context) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val permissions = parameters["permissions"] as? String ?: "[]"
            val callbackUrl = parameters["callbackUrl"] as? String ?: ""
            val appName = parameters["appName"] as? String ?: "EINUNDZWANZIG"
            val pkg = amberPackage(parameters)
            return try {
                val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:")).apply {
                    setPackage(pkg)
                    putExtra("type", "get_public_key")
                    putExtra("permissions", permissions)
                    putExtra("appName", appName)
                    if (callbackUrl.isNotEmpty()) {
                        putExtra("callbackUrl", callbackUrl)
                    }
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                mapOf("launched" to true)
            } catch (e: Exception) {
                Log.e(TAG, "get_public_key-Intent fehlgeschlagen: ${e.message}", e)
                mapOf("launched" to false, "error" to (e.message ?: "unknown"))
            }
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

    /** get_public_key via ContentResolver — nur wenn die App bereits autorisiert ist. */
    class GetPublicKey(private val context: Context) : BridgeFunction {
        override fun execute(parameters: Map<String, Any>): Map<String, Any> {
            val currentUser = parameters["currentUser"] as? String ?: ""
            return query(context, amberPackage(parameters), "GET_PUBLIC_KEY", "", "", currentUser)
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
