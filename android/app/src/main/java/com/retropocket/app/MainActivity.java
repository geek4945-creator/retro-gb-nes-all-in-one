package com.retropocket.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RomFoldersPlugin.class);   // Storage Access Framework ROM folders (www/js/folders.js)
        registerPlugin(AppUpdaterPlugin.class);   // in-app APK updates: download + verify + system installer (www/js/updates.js)
        registerPlugin(DeviceInfoPlugin.class);   // Settings > Performance & device: model, chipset, RAM (www/js/perf.js)
        super.onCreate(savedInstanceState);
    }
}
