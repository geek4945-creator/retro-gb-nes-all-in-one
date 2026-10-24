package com.retropocket.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RomFoldersPlugin.class);   // Storage Access Framework ROM folders (www/js/folders.js)
        super.onCreate(savedInstanceState);
    }
}
