import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor config.
 *
 * `webDir` matches Vite's build output. Change `appId` to your real reverse-DNS
 * before submitting to the App Store / Play Store — it can't be changed easily
 * after publish.
 *
 * For local development against the live Vite dev server, uncomment the
 * `server` block and change the URL to your LAN IP (so the iOS Simulator /
 * Android Emulator can reach your machine).
 */
const config: CapacitorConfig = {
  appId: 'com.golfroundtracker.app',
  appName: 'Golf Round Tracker',
  webDir: 'dist',
  ios: {
    // 'never' lets the WKWebView extend edge-to-edge under the status bar
    // and over the home-indicator zone. With 'never', env(safe-area-inset-*)
    // returns real pixel values that our CSS already handles via padding/
    // height calcs (see MobileShell, HoleTrackingPage, AddShotSheet).
    //
    // 'always' (the previous setting) auto-insets the web content away from
    // the safe areas — which clamps the app inside a smaller box AND zeroes
    // out env(safe-area-inset-*), so our CSS can't make the layout fill the
    // screen.
    contentInset: 'never'
  },
  android: {
    // Match the deep colour the dark theme expects so there's no white flash
    // during startup.
    backgroundColor: '#0B1410'
  }
  // server: {
  //   url: 'http://192.168.1.42:5173',
  //   cleartext: true
  // }
};

export default config;
