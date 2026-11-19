package ke.co.servicehub.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {

    private static volatile boolean inForeground = false;

    public static boolean isInForeground() { return inForeground; }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ServiceHubNativePlugin.class);
        super.onCreate(savedInstanceState);
        handleCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleCallIntent(intent);
    }

    @Override
    public void onResume() {
        super.onResume();
        inForeground = true;
    }

    @Override
    public void onPause() {
        inForeground = false;
        super.onPause();
    }

    private void handleCallIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(CallNotifier.EXTRA_CALL_ACTION);
        if (action == null) return;
        String callId = intent.getStringExtra(CallNotifier.EXTRA_CALL_ID);

        if (!"open_chat".equals(action)) {
            // Show the call screen over the lock screen and switch the screen on.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true);
                setTurnScreenOn(true);
            } else {
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
            }
            if ("accept".equals(action)) {
                CallNotifier.cancel(this, callId); // stop ringing now that it's answered (works over the lock screen)
            }
        }

        JSObject a = new JSObject();
        a.put("action", action);
        a.put("callId", callId);
        a.put("conversationId", intent.getStringExtra(CallNotifier.EXTRA_CONVERSATION_ID));
        a.put("callerName", intent.getStringExtra(CallNotifier.EXTRA_CALLER_NAME));
        ServiceHubNativePlugin.deliverLaunch(a);

        // Consume so a rotation / recreate doesn't replay it.
        intent.removeExtra(CallNotifier.EXTRA_CALL_ACTION);
    }
}
