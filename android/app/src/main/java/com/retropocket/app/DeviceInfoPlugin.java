package com.retropocket.app;

import android.app.ActivityManager;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Settings → Performance & device (www/js/perf.js): phone model, chipset (Android 12+), Android version and memory,
 * which the WebView does not expose. Read-only; needs no permission.
 */
@CapacitorPlugin(name = "DeviceInfo")
public class DeviceInfoPlugin extends Plugin {
    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("manufacturer", Build.MANUFACTURER);
        r.put("model", Build.MODEL);
        r.put("device", Build.DEVICE);
        r.put("hardware", Build.HARDWARE);
        r.put("board", Build.BOARD);
        r.put("android", Build.VERSION.RELEASE);
        r.put("sdk", Build.VERSION.SDK_INT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            r.put("soc", Build.SOC_MODEL);
            r.put("socManufacturer", Build.SOC_MANUFACTURER);
        }
        StringBuilder abis = new StringBuilder();
        for (String a : Build.SUPPORTED_ABIS) { if (abis.length() > 0) abis.append(','); abis.append(a); }
        r.put("abis", abis.toString());
        r.put("cpus", Runtime.getRuntime().availableProcessors());
        try {
            ActivityManager am = (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
            am.getMemoryInfo(mi);
            r.put("totalRamMB", mi.totalMem / (1024 * 1024));
            r.put("availRamMB", mi.availMem / (1024 * 1024));
            r.put("memoryClassMB", am.getMemoryClass());
            r.put("largeMemoryClassMB", am.getLargeMemoryClass());
            r.put("lowRam", am.isLowRamDevice());
        } catch (Exception ignored) { }
        call.resolve(r);
    }
}
