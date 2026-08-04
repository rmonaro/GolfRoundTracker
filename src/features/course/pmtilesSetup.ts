// Registers our PMTiles tile provider with Mapbox GL, once at bootstrap.
// See pmtilesProvider.ts for why the module handed to Mapbox is a blob-URL shim.

import { mapboxgl } from './mapbox';
import { getPackBytes } from '@/services/coursePackRepo';
import {
  LOCAL_PACK_SCHEME,
  installBridge,
  registerLocalPack,
  shimModuleUrl
} from './pmtilesProvider';

export const PROVIDER_NAME = 'grtpmtiles';

let registered = false;

export function initPmtilesProvider(): void {
  if (registered) return;
  try {
    installBridge();
    // Experimental API in mapbox-gl 3.24, typed @private — hence the cast. If a
    // future release drops it, registration throws, `registered` stays false,
    // and the map falls back to online Mapbox satellite and then the SVG
    // render. Offline imagery would stop working; nothing breaks outright.
    (mapboxgl as unknown as { addTileProvider: (n: string, u: string) => void }).addTileProvider(
      PROVIDER_NAME,
      shimModuleUrl()
    );
    registered = true;
  } catch (err) {
    console.warn('[pmtiles] provider registration failed', err);
  }
}

export function isPmtilesProviderReady(): boolean {
  return registered;
}

/** URL a source spec uses to mean "the downloaded pack for this course". */
export function localPackUrl(courseId: string): string {
  return `${LOCAL_PACK_SCHEME}${courseId}`;
}

/**
 * Make a downloaded pack readable by the provider.
 *
 * Returns the URL to use, or null when this course has no pack on the device.
 */
export async function prepareLocalPack(courseId: string): Promise<string | null> {
  const bytes = await getPackBytes(courseId);
  if (!bytes) return null;
  const url = localPackUrl(courseId);
  registerLocalPack(url, bytes);
  return url;
}
