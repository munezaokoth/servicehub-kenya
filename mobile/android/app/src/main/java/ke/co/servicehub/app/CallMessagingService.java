package ke.co.servicehub.app;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/** Receives call pushes from the ServiceHub server (Firebase Cloud Messaging, high priority data messages). */
public class CallMessagingService extends FirebaseMessagingService {

    @Override
    public void onNewToken(@NonNull String token) {
        getSharedPreferences(ServiceHubNativePlugin.PREFS, MODE_PRIVATE).edit().putString("fcm_token", token).apply();
        ServiceHubNativePlugin.emit("pushToken", "token", token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> d = message.getData();
        String type = d.get("type");
        if (type == null) return;

        switch (type) {
            case "call":
                // If ServiceHub is open on screen, the page itself shows the call and rings.
                if (MainActivity.isInForeground()) {
                    ServiceHubNativePlugin.emitMap("callPush", d);
                } else {
                    CallNotifier.showIncoming(this, d);
                }
                break;
            case "call_cancel":
                CallNotifier.cancel(this, d.get("callId"));
                break;
            case "call_missed":
                CallNotifier.showMissed(this, d);
                break;
            default:
                break;
        }
    }
}
