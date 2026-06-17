import { Capacitor } from '@capacitor/core';

/**
 * User-facing name for the paired smartwatch, chosen by the phone's platform.
 * The integration is an Apple Watch on iOS; on Android (and web) we use the
 * generic "smartwatch" since the wearable isn't Apple-branded there.
 *
 * Pass `{ title: true }` for standalone/heading use where the word starts a
 * label and needs a leading capital ("Smartwatch"); the default is the
 * mid-sentence form ("smartwatch"). "Apple Watch" is a proper noun, so it's
 * capitalized either way.
 */
export function watchName(opts?: { title?: boolean }): string {
  if (Capacitor.getPlatform() === 'ios') return 'Apple Watch';
  return opts?.title ? 'Smartwatch' : 'smartwatch';
}
