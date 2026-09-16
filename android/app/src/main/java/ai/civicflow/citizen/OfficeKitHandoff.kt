package ai.civicflow.citizen

import android.content.Intent
import org.json.JSONObject

object OfficeKitHandoff {
    fun shareIntent(packet: JSONObject): Intent {
        return Intent(Intent.ACTION_SEND).apply {
            type = "application/json"
            putExtra(Intent.EXTRA_SUBJECT, "CivicFlow Office Kit packet")
            putExtra(Intent.EXTRA_TEXT, packet.toString(2))
        }
    }
}
