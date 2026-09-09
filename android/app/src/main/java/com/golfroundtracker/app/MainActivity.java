package com.golfroundtracker.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered BEFORE super.onCreate(): Capacitor builds its bridge there
        // and only picks up plugins already declared. Registering afterwards
        // gives a plugin that exists but that JS cannot see.
        registerPlugin(WatchBridge.class);
        super.onCreate(savedInstanceState);
    }
}
