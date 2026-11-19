package ke.co.servicehub.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

import java.util.Map;

/**
 * Shows the incoming-call notification that rings the phone (looping ringtone + vibration),
 * lights the screen and opens the full-screen call screen over the lock screen.
 */
public final class CallNotifier {

    public static final String CHANNEL_CALLS = "sh_incoming_calls_v1";
    public static final String CHANNEL_MISSED = "sh_missed_calls_v1";

    public static final String EXTRA_CALL_ID = "sh_call_id";
    public static final String EXTRA_CALL_ACTION = "sh_call_action";
    public static final String EXTRA_CONVERSATION_ID = "sh_conversation_id";
    public static final String EXTRA_CALLER_NAME = "sh_caller_name";
    public static final String EXTRA_DECLINE_TOKEN = "sh_decline_token";

    private static final long[] VIBRATION = new long[]{0, 900, 400, 900, 400, 900, 1200};

    private CallNotifier() {}

    public static int notificationId(String callId) {
        return 0x5C000000 | (callId == null ? 0 : (callId.hashCode() & 0x00FFFFFF));
    }

    public static int missedId(String callId) {
        return 0x5D000000 | (callId == null ? 0 : (callId.hashCode() & 0x00FFFFFF));
    }

    public static void ensureChannels(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;

        if (nm.getNotificationChannel(CHANNEL_CALLS) == null) {
            NotificationChannel calls = new NotificationChannel(CHANNEL_CALLS, "Incoming calls", NotificationManager.IMPORTANCE_HIGH);
            calls.setDescription("Rings your phone when someone calls you on ServiceHub");
            Uri ring = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            AudioAttributes attrs = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
            calls.setSound(ring, attrs);
            calls.enableVibration(true);
            calls.setVibrationPattern(VIBRATION);
            calls.enableLights(true);
            calls.setLightColor(0xFF22C55E);
            calls.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            calls.setShowBadge(false);
            nm.createNotificationChannel(calls);
        }
        if (nm.getNotificationChannel(CHANNEL_MISSED) == null) {
            NotificationChannel missed = new NotificationChannel(CHANNEL_MISSED, "Missed calls", NotificationManager.IMPORTANCE_DEFAULT);
            missed.setDescription("Calls you missed on ServiceHub");
            nm.createNotificationChannel(missed);
        }
    }

    private static PendingIntent activityIntent(Context ctx, int requestCode, String action, Map<String, String> d) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra(EXTRA_CALL_ID, d.get("callId"));
        i.putExtra(EXTRA_CALL_ACTION, action);
        i.putExtra(EXTRA_CONVERSATION_ID, d.get("conversationId"));
        i.putExtra(EXTRA_CALLER_NAME, d.get("callerName"));
        return PendingIntent.getActivity(ctx, requestCode, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    public static void showIncoming(Context ctx, Map<String, String> d) {
        String callId = d.get("callId");
        if (callId == null) return;
        long expiresAt = parseLong(d.get("expiresAt"), System.currentTimeMillis() + 45000);
        long remaining = expiresAt - System.currentTimeMillis();
        if (remaining <= 1000) return; // arrived too late, the call is already over

        ensureChannels(ctx);
        boolean video = "video".equals(d.get("callType"));
        String caller = d.get("callerName") == null ? "Someone" : d.get("callerName");
        int id = notificationId(callId);

        PendingIntent open = activityIntent(ctx, id, "open", d);
        PendingIntent answer = activityIntent(ctx, id + 1, "accept", d);

        Intent declineI = new Intent(ctx, DeclineReceiver.class);
        declineI.putExtra(EXTRA_CALL_ID, callId);
        declineI.putExtra(EXTRA_DECLINE_TOKEN, d.get("declineToken"));
        PendingIntent decline = PendingIntent.getBroadcast(ctx, id + 2, declineI, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_CALLS)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setColor(0xFF0B2A5B)
                .setContentTitle(video ? "Incoming video call" : "Incoming voice call")
                .setContentText(caller + " is calling you on ServiceHub")
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(false)
                .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), android.media.AudioManager.STREAM_RING)
                .setVibrate(VIBRATION)
                .setTimeoutAfter(remaining)
                .setContentIntent(open)
                .setFullScreenIntent(open, true)
                .addAction(0, "Decline", decline)
                .addAction(0, "Answer", answer);

        Notification n = b.build();
        n.flags |= Notification.FLAG_INSISTENT; // keep ringing until answered, declined or timed out
        try {
            NotificationManagerCompat.from(ctx).notify(id, n);
        } catch (SecurityException e) {
            // Notification permission not granted - nothing we can show.
        }
    }

    public static void showMissed(Context ctx, Map<String, String> d) {
        String callId = d.get("callId");
        cancel(ctx, callId);
        ensureChannels(ctx);
        boolean video = "video".equals(d.get("callType"));
        String caller = d.get("callerName") == null ? "Someone" : d.get("callerName");
        Intent i = new Intent(ctx, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra(EXTRA_CALL_ACTION, "open_chat");
        i.putExtra(EXTRA_CONVERSATION_ID, d.get("conversationId"));
        i.putExtra(EXTRA_CALLER_NAME, caller);
        PendingIntent pi = PendingIntent.getActivity(ctx, missedId(callId), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Notification n = new NotificationCompat.Builder(ctx, CHANNEL_MISSED)
                .setSmallIcon(R.drawable.ic_stat_call)
                .setColor(0xFFEF4444)
                .setContentTitle(video ? "Missed video call" : "Missed voice call")
                .setContentText(caller + " called you on ServiceHub")
                .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build();
        try {
            NotificationManagerCompat.from(ctx).notify(missedId(callId), n);
        } catch (SecurityException e) { /* no permission */ }
    }

    public static void cancel(Context ctx, String callId) {
        if (callId == null) return;
        NotificationManagerCompat.from(ctx).cancel(notificationId(callId));
    }

    private static long parseLong(String s, long fallback) {
        try { return s == null ? fallback : Long.parseLong(s); } catch (NumberFormatException e) { return fallback; }
    }
}
