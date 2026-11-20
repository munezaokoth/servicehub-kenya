package ke.co.servicehub.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/**
 * New chat message notifications (one per conversation; newer messages replace the older one),
 * and the delivery receipt sent back to ServiceHub so the sender sees two grey ticks.
 */
public final class MessageNotifier {

    public static final String CHANNEL_MESSAGES = "sh_messages_v1";
    private static final String SITE = "https://servicehub.co.ke";

    private MessageNotifier() {}

    static int notificationId(String conversationId) {
        return 0x4D000000 | ((conversationId == null ? 0 : conversationId.hashCode()) & 0x00FFFFFF);
    }

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null || nm.getNotificationChannel(CHANNEL_MESSAGES) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_MESSAGES, "Messages", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("New chat messages from clients and service providers");
        ch.enableVibration(true);
        ch.setShowBadge(true);
        nm.createNotificationChannel(ch);
    }

    public static void show(Context ctx, Map<String, String> d) {
        ensureChannel(ctx);
        String conv = d.get("conversationId");
        String sender = d.get("senderName") == null ? "New message" : d.get("senderName");
        String body = d.get("body") == null ? "New message on ServiceHub" : d.get("body");

        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra(CallNotifier.EXTRA_CALL_ACTION, "open_chat");
        i.putExtra(CallNotifier.EXTRA_CONVERSATION_ID, conv);
        i.putExtra(CallNotifier.EXTRA_CALLER_NAME, sender);
        PendingIntent pi = PendingIntent.getActivity(ctx, notificationId(conv), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_MESSAGES)
                .setSmallIcon(R.drawable.ic_stat_message)
                .setColor(0xFF1557D6)
                .setContentTitle(sender)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true)
                .setContentIntent(pi);
        try {
            NotificationManagerCompat.from(ctx).notify(notificationId(conv), b.build());
        } catch (SecurityException e) { /* notifications not allowed */ }
    }

    public static void cancel(Context ctx, String conversationId) {
        if (conversationId == null) return;
        NotificationManagerCompat.from(ctx).cancel(notificationId(conversationId));
    }

    /** Tell ServiceHub the message reached this phone (runs on the messaging service's worker thread). */
    public static void ackDelivered(Map<String, String> d) {
        String m = d.get("messageId"), u = d.get("recipientId"), t = d.get("ackToken");
        if (m == null || u == null || t == null) return;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(SITE + "/api/chat/delivered-ack").openConnection();
            c.setRequestMethod("POST");
            c.setConnectTimeout(8000);
            c.setReadTimeout(8000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            String json = "{\"m\":\"" + esc(m) + "\",\"u\":\"" + esc(u) + "\",\"t\":\"" + esc(t) + "\"}";
            try (OutputStream os = c.getOutputStream()) { os.write(json.getBytes(StandardCharsets.UTF_8)); }
            c.getResponseCode();
        } catch (Exception e) {
            // best effort; the message is marked delivered anyway when the app next opens
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }
}
