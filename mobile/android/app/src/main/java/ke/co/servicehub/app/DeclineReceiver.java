package ke.co.servicehub.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** "Decline" button on the ringing notification: stops the ringing and tells the server. */
public class DeclineReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        final String callId = intent.getStringExtra(CallNotifier.EXTRA_CALL_ID);
        final String token = intent.getStringExtra(CallNotifier.EXTRA_DECLINE_TOKEN);
        CallNotifier.cancel(context, callId);
        if (callId == null || token == null) return;

        final PendingResult pending = goAsync();
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                JSONObject body = new JSONObject();
                body.put("callId", callId);
                body.put("token", token);
                c = (HttpURLConnection) new URL(BuildConfig.SH_BASE_URL + "/api/calls/decline").openConnection();
                c.setRequestMethod("POST");
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json");
                try (OutputStream os = c.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                c.getResponseCode();
            } catch (Exception ignored) {
            } finally {
                if (c != null) c.disconnect();
                pending.finish();
            }
        }).start();
    }
}
