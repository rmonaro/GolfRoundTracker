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
    // Lets safe-area-inset CSS (which the app uses heavily) work the way it
    // does in mobile Safari. Without 'always' the WKWebView ignores the
    // notch / home-indicator regions and content gets cut off.
    contentInset: 'always'
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
