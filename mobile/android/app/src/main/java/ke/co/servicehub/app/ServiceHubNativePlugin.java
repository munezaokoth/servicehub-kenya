package ke.co.servicehub.app;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.provider.Settings;
import android.view.WindowManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.messaging.FirebaseMessaging;

import java.util.List;
import java.util.Map;

/**
 * Native helpers used by servicehub.co.ke when it runs inside the app (calls-v2.js):
 * push token, notification / full-screen permissions, ringtone, in-call audio routing,
 * keep-screen-on, proximity sensor and the call launched from a notification.
 */
@CapacitorPlugin(
        name = "ServiceHubNative",
        permissions = {
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS})
        }
)
public class ServiceHubNativePlugin extends Plugin {

    public static final String PREFS = "servicehub_native";

    private static ServiceHubNativePlugin instance;
    private static JSObject pendingLaunch;

    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock proximityLock;

    @Override
    public void load() {
        instance = this;
        CallNotifier.ensureChannels(getContext());
    }

    @Override
    protected void handleOnDestroy() {
        stopRinging();
        releaseProximity();
        if (instance == this) instance = null;
    }

    /* ── events to the web page ─────────────────────────────────────────── */

    static void emit(String event, String key, String value) {
        ServiceHubNativePlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        o.put(key, value);
        p.notifyListeners(event, o, true);
    }

    static void emitMap(String event, Map<String, String> data) {
        ServiceHubNativePlugin p = instance;
        if (p == null) return;
        JSObject o = new JSObject();
        for (Map.Entry<String, String> e : data.entrySet()) o.put(e.getKey(), e.getValue());
        p.notifyListeners(event, o, true);
    }

    /** Called by MainActivity when the app is opened from a call / missed-call notification. */
    static void deliverLaunch(JSObject action) {
        ServiceHubNativePlugin p = instance;
        if (p != null && p.hasListeners("callAction")) {
            p.notifyListeners("callAction", action, true);
        } else {
            pendingLaunch = action;
        }
    }

    @PluginMethod
    public void getLaunchAction(PluginCall call) {
        JSObject r = new JSObject();
        r.put("action", pendingLaunch);
        pendingLaunch = null;
        call.resolve(r);
    }

    /* ── push token ─────────────────────────────────────────────────────── */

    @PluginMethod
    public void getPushToken(PluginCall call) {
        try {
            FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
                if (task.isSuccessful() && task.getResult() != null) {
                    String token = task.getResult();
                    getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("fcm_token", token).apply();
                    JSObject r = new JSObject();
                    r.put("token", token);
                    call.resolve(r);
                } else {
                    call.reject("Could not get a push token");
                }
            });
        } catch (Exception e) {
            call.reject("Push is not configured in this build");
        }
    }

    /* ── permissions ────────────────────────────────────────────────────── */

    @PluginMethod
    public void alertStatus(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve(statusObject());
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionResult");
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        call.resolve(statusObject());
    }

    private JSObject statusObject() {
        Context ctx = getContext();
        boolean notifications;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            notifications = getPermissionState("notifications") == PermissionState.GRANTED;
        } else {
            notifications = androidx.core.app.NotificationManagerCompat.from(ctx).areNotificationsEnabled();
        }
        boolean fullScreen = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            fullScreen = nm == null || nm.canUseFullScreenIntent();
        }
        boolean battery = true;
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        if (pm != null) battery = pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        JSObject r = new JSObject();
        r.put("notifications", notifications);
        r.put("fullScreen", fullScreen);
        r.put("batteryUnrestricted", battery);
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        return r;
    }

    @PluginMethod
    public void openFullScreenSettings(PluginCall call) {
        Context ctx = getContext();
        Intent i;
        if (Build.VERSION.SDK_INT >= 34) {
            i = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + ctx.getPackageName()));
        } else {
            i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName());
        }
        startSettings(i, call);
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Context ctx = getContext();
        startSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.getPackageName()), call);
    }

    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        startSettings(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), call);
    }

    private void startSettings(Intent i, PluginCall call) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            try {
                Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
            } catch (Exception ignored) { }
        }
        call.resolve();
    }

    /* ── call notification ──────────────────────────────────────────────── */

    @PluginMethod
    public void cancelCallNotification(PluginCall call) {
        CallNotifier.cancel(getContext(), call.getString("callId"));
        call.resolve();
    }

    /* ── ringtone while the app is open ─────────────────────────────────── */

    @PluginMethod
    public void startRingtone(PluginCall call) {
        stopRinging();
        Context ctx = getContext();
        AudioManager am = (AudioManager) ctx.getSystemService(Context.AUDIO_SERVICE);
        int mode = am == null ? AudioManager.RINGER_MODE_NORMAL : am.getRingerMode();
        if (mode == AudioManager.RINGER_MODE_NORMAL) {
            try {
                ringtone = RingtoneManager.getRingtone(ctx, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE));
                if (ringtone != null) {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) ringtone.setLooping(true);
                    ringtone.play();
                }
            } catch (Exception ignored) { }
        }
        if (mode != AudioManager.RINGER_MODE_SILENT) {
            vibrator = (Vibrator) ctx.getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = new long[]{0, 900, 400, 900, 1200};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                else vibrator.vibrate(pattern, 0);
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stopRingtone(PluginCall call) {
        stopRinging();
        call.resolve();
    }

    private void stopRinging() {
        try { if (ringtone != null) ringtone.stop(); } catch (Exception ignored) { }
        ringtone = null;
        try { if (vibrator != null) vibrator.cancel(); } catch (Exception ignored) { }
        vibrator = null;
    }

    /* ── in-call audio, screen and proximity ────────────────────────────── */

    @PluginMethod
    public void setInCall(PluginCall call) {
        boolean active = Boolean.TRUE.equals(call.getBoolean("active", false));
        boolean speaker = Boolean.TRUE.equals(call.getBoolean("speaker", false));
        boolean video = Boolean.TRUE.equals(call.getBoolean("video", false));
        AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (am != null) {
            try {
                if (active) {
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                    routeAudio(am, speaker);
                } else {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) am.clearCommunicationDevice();
                    else am.setSpeakerphoneOn(false);
                    am.setMode(AudioManager.MODE_NORMAL);
                }
            } catch (Exception ignored) { }
        }
        setKeepOn(active);
        if (active && !speaker && !video) acquireProximity(); else releaseProximity();
        JSObject r = new JSObject();
        r.put("speaker", active && speaker);
        call.resolve(r);
    }

    private void routeAudio(AudioManager am, boolean speaker) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            List<AudioDeviceInfo> devices = am.getAvailableCommunicationDevices();
            AudioDeviceInfo target = null;
            // Prefer a headset / Bluetooth when connected and speaker isn't requested
            if (!speaker) {
                for (AudioDeviceInfo d : devices) {
                    int t = d.getType();
                    if (t == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || t == AudioDeviceInfo.TYPE_WIRED_HEADSET
                            || t == AudioDeviceInfo.TYPE_WIRED_HEADPHONES || t == AudioDeviceInfo.TYPE_USB_HEADSET
                            || (Build.VERSION.SDK_INT >= 31 && t == AudioDeviceInfo.TYPE_BLE_HEADSET)) { target = d; break; }
                }
            }
            if (target == null) {
                int want = speaker ? AudioDeviceInfo.TYPE_BUILTIN_SPEAKER : AudioDeviceInfo.TYPE_BUILTIN_EARPIECE;
                for (AudioDeviceInfo d : devices) if (d.getType() == want) { target = d; break; }
            }
            if (target != null) am.setCommunicationDevice(target);
        } else {
            am.setSpeakerphoneOn(speaker);
        }
    }

    @PluginMethod
    public void setKeepScreenOn(PluginCall call) {
        setKeepOn(Boolean.TRUE.equals(call.getBoolean("on", false)));
        call.resolve();
    }

    private void setKeepOn(boolean on) {
        if (getActivity() == null) return;
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
    }

    @SuppressWarnings("WakelockTimeout")
    private void acquireProximity() {
        try {
            PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
            if (pm == null || !pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return;
            if (proximityLock == null) proximityLock = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "servicehub:call");
            if (!proximityLock.isHeld()) proximityLock.acquire();
        } catch (Exception ignored) { }
    }

    private void releaseProximity() {
        try { if (proximityLock != null && proximityLock.isHeld()) proximityLock.release(); } catch (Exception ignored) { }
    }
}
