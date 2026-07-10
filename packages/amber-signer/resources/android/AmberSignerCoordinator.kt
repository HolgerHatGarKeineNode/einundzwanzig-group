package com.einundzwanzig.ambersigner

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.fragment.app.Fragment
import androidx.fragment.app.FragmentActivity
import com.nativephp.mobile.utils.NativeActionCoordinator
import org.json.JSONObject

/**
 * Headless-Fragment für die sichtbaren Amber-Intents via `startActivityForResult`.
 *
 * WARUM (statt fire-and-forget `startActivity`): Ambers ContentResolver-Signieren
 * funktioniert NUR für eine in Amber REGISTRIERTE App. Amber registriert sie nur, wenn
 * es `callingPackage` sieht — und das ist ausschließlich bei `startActivityForResult`
 * gesetzt (bei Browser-`startActivity` null → Amber behandelt es als Web-Request).
 *
 * Zwei Wege laufen hierüber:
 *  - get_public_key (Login): registriert die App + merkt die Perms → danach beantwortet
 *    Amber sign/nip44 still per ContentResolver. Ergebnis: EVENT_PUBLIC_KEY.
 *  - generische Signer-Op (Fallback): wenn eine Aktion NICHT vorab gewährt ist
 *    (ContentResolver liefert authorized:false, z. B. Amber-Policy „manually approve"),
 *    fragt Amber hier SICHTBAR mit interaktivem Prompt (sign_event, nip44_encrypt,
 *    nip44_decrypt). Ergebnis: EVENT_SIGNER_RESULT (mit `id` zur Zuordnung).
 *
 * Muster 1:1 aus NativePHPs `CameraCoordinator`. Ein Launcher, `pendingType`/`pendingId`
 * routen das Ergebnis auf das passende Event.
 */
class AmberSignerCoordinator : Fragment() {

    companion object {
        private const val TAG = "AmberSignerCoordinator"
        private const val FRAGMENT_TAG = "AmberSignerCoordinator"
        const val EVENT_PUBLIC_KEY = "AmberSigner.PublicKeyReceived"
        const val EVENT_SIGNER_RESULT = "AmberSigner.SignerResult"

        fun install(activity: FragmentActivity): AmberSignerCoordinator {
            val fm = activity.supportFragmentManager
            return (fm.findFragmentByTag(FRAGMENT_TAG) as? AmberSignerCoordinator)
                ?: AmberSignerCoordinator().also {
                    fm.beginTransaction().add(it, FRAGMENT_TAG).commitNow()
                }
        }
    }

    private var pendingType: String? = null
    private var pendingId: String? = null
    private lateinit var launcher: ActivityResultLauncher<Intent>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val type = pendingType
            val id = pendingId
            pendingType = null
            pendingId = null

            val data = result.data
            val ok = result.resultCode == Activity.RESULT_OK && data != null && !data.getBooleanExtra("rejected", false)

            if (type == "get_public_key") {
                val payload = JSONObject()
                val pubkey = if (ok) data!!.getStringExtra("result") ?: data.getStringExtra("signature") else null
                if (pubkey.isNullOrBlank()) {
                    payload.put("rejected", true)
                } else {
                    payload.put("pubkey", pubkey)
                    data!!.getStringExtra("package")?.let { payload.put("package", it) }
                }
                dispatchEvent(EVENT_PUBLIC_KEY, payload.toString())
            } else {
                // sign_event → `event`-Extra (signiertes Event); nip44_* → `result`-Extra.
                val payload = JSONObject()
                id?.let { payload.put("id", it) }
                val event = if (ok) data!!.getStringExtra("event") else null
                val res = if (ok) data!!.getStringExtra("result") ?: data.getStringExtra("signature") else null
                when {
                    !event.isNullOrBlank() -> payload.put("event", event)
                    !res.isNullOrBlank() -> payload.put("result", res)
                    else -> payload.put("rejected", true)
                }
                dispatchEvent(EVENT_SIGNER_RESULT, payload.toString())
            }
        }
    }

    /**
     * get_public_key-Login: öffnet Amber mit der vollständigen Perm-Liste (die Amber sich
     * merkt) und registriert die App (callingPackage). Ergebnis: EVENT_PUBLIC_KEY.
     */
    fun requestPublicKey(permissions: String, appName: String, signerPackage: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:")).apply {
            setPackage(signerPackage)
            putExtra("type", "get_public_key")
            putExtra("permissions", permissions)
            putExtra("appName", appName)
        }
        launch("get_public_key", null, intent)
    }

    /**
     * Sichtbare Signer-Op mit interaktivem Prompt (Fallback bei nicht vorab gewährter
     * Aktion): `type` = sign_event | nip44_encrypt | nip44_decrypt. `payload` = Event-JSON
     * bzw. Klar-/Ciphertext; `counterparty` = Gegenpartei-pubkey (nur nip44). Ergebnis:
     * EVENT_SIGNER_RESULT mit `id`.
     */
    fun signerRequest(type: String, payload: String, currentUser: String, counterparty: String?, id: String, signerPackage: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("nostrsigner:$payload")).apply {
            setPackage(signerPackage)
            putExtra("type", type)
            putExtra("current_user", currentUser)
            putExtra("id", id)
            if (!counterparty.isNullOrBlank()) {
                putExtra("pubkey", counterparty)
            }
        }
        launch(type, id, intent)
    }

    private fun launch(type: String, id: String?, intent: Intent) {
        pendingType = type
        pendingId = id
        try {
            launcher.launch(intent)
        } catch (e: Exception) {
            pendingType = null
            pendingId = null
            Log.e(TAG, "Launch ($type) fehlgeschlagen: ${e.message}", e)
            val event = if (type == "get_public_key") EVENT_PUBLIC_KEY else EVENT_SIGNER_RESULT
            val payload = JSONObject().put("rejected", true).put("error", e.message ?: "unknown")
            id?.let { payload.put("id", it) }
            dispatchEvent(event, payload.toString())
        }
    }

    private fun dispatchEvent(event: String, payloadJson: String) {
        NativeActionCoordinator.dispatchEvent(requireActivity(), event, payloadJson)
    }
}
