package ai.civicflow.citizen

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat

object NotificationHelper {
    private const val CHANNEL = "civicflow_status"

    fun ensureChannel(ctx: Context) {
        val mgr = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        mgr.createNotificationChannel(
            NotificationChannel(CHANNEL, "CivicFlow status", NotificationManager.IMPORTANCE_DEFAULT)
        )
    }

    fun statusSaved(ctx: Context, title: String, body: String) {
        ensureChannel(ctx)
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify((System.currentTimeMillis() % 100000).toInt(), n)
        } catch (_: SecurityException) {
            /* POST_NOTIFICATIONS may be denied */
        }
    }
}
