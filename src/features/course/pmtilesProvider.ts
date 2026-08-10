// PMTiles imagery for Mapbox GL, via a custom tile provider.
//
// WHY OUR OWN rather than Mapbox's built-in PMTiles support: mapbox-gl 3.24
// resolves `.pmtiles` sources through a provider script fetched at RUNTIME from
// `api.mapbox.com/mapbox-gl-js/plugins/…`. That's a network dependency at the
// exact moment we have no network, which would defeat the whole feature.
//
// `addTileProvider(name, url)` dynamically imports a module from a URL, so the
// provider has to exist as a standalone module. Two things make that awkward in
// a bundled app: the URL must resolve at runtime, and the module can't rely on
// the bundler to resolve bare imports. Vite's `new URL('./x.ts', import.meta.url)`
// does NOT work here — it inlines the untranspiled TypeScript as a
// `data:video/mp2t` URL, which the browser cannot execute.
//
// So the module we hand Mapbox is a dependency-free SHIM built at runtime as a
// blob URL. All the real work — the `pmtiles` library, the archives, the
// in-memory packs — stays in the main bundle behind a global bridge. The shim
// is a few lines and imports nothing, so there's nothing to resolve and nothing
// to fetch.

import { PMTiles, FetchSource, type Source, type RangeResponse } from 'pmtiles';

export const LOCAL_PACK_SCHEME = 'grtpack://';

/**
 * Pixel size of the tiles in our packs.
 *
 * GDAL's MBTiles driver writes 256px tiles, and Mapbox GL v3 defaults raster
 * sources to 512 — so this MUST be stated explicitly. Getting it wrong doesn't
 * error: Mapbox simply renders each tile at double size, which looks exactly
 * like low-resolution imagery. (It cost us a round of "why is this blurry?".)
 */
export const TILE_SIZE = 256;

/** Global bridge the shim calls back into. */
const BRIDGE_KEY = '__grtPmtilesBridge';

interface Bridge {
  load(url: string): Promise<unknown>;
  loadTile(
    url: string,
    tile: { z: number; x: number; y: number }
  ): Promise<{ data: ArrayBuffer } | undefined>;
}

/**
 * A pmtiles `Source` backed by bytes already in memory.
 *
 * Packs are ~4 MB, so holding one is cheap, and it sidesteps whether
 * `capacitor://` file URLs honour HTTP Range — a failure that would only show
 * up on a course with no signal.
 */
class MemorySource implements Source {
  constructor(private readonly buf: ArrayBuffer, private readonly key: string) {}

  getKey(): string {
    return this.key;
  }

  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: this.buf.slice(offset, offset + length) };
  }
}

/** Downloaded packs, keyed by the `grtpack://<courseId>` URL a source uses. */
const localPacks = new Map<string, ArrayBuffer>();
/** One PMTiles instance per url — they cache directory lookups internally. */
const archives = new Map<string, PMTiles>();

export function registerLocalPack(url: string, bytes: ArrayBuffer) {
  localPacks.set(url, bytes);
  // Drop any archive built before the bytes arrived, so it's rebuilt against
  // the local source instead of continuing to hit the network.
  archives.delete(url);
}

export function unregisterLocalPack(url: string) {
  localPacks.delete(url);
  archives.delete(url);
}

function archiveFor(url: string): PMTiles {
  let archive = archives.get(url);
  if (!archive) {
    const local = localPacks.get(url);
    archive = new PMTiles(local ? new MemorySource(local, url) : new FetchSource(url));
    archives.set(url, archive);
  }
  return archive;
}

/** Publish the bridge the shim module calls into. Idempotent. */
export function installBridge() {
  const bridge: Bridge = {
    async load(url) {
      const header = await archiveFor(url).getHeader();
      return {
        // A tile-URL template is REQUIRED even though the provider never
        // fetches it: Mapbox builds a request URL per tile before handing off,
        // and an empty `tiles` array makes it call `.replace` on undefined —
        // the source loads fine and then every tile throws. The value only has
        // to be a well-formed template; `loadTile` uses the z/x/y arguments.
        tiles: [`${url}/{z}/{x}/{y}`],
        minzoom: header.minZoom,
        maxzoom: header.maxZoom,
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        tileSize: TILE_SIZE
      };
    },
    async loadTile(url, tile) {
      const result = await archiveFor(url).getZxy(tile.z, tile.x, tile.y);
      // Nullish tells Mapbox to overscale the parent tile rather than draw a
      // hole — a stretched parent beats a gap in the middle of a fairway.
      if (!result) return undefined;
      return { data: result.data };
    }
  };
  (globalThis as unknown as Record<string, unknown>)[BRIDGE_KEY] = bridge;
}

/**
 * Source for the shim module handed to `addTileProvider`.
 *
 * Deliberately plain JS with zero imports: it's loaded as a blob URL, where
 * nothing would resolve a bare specifier or a relative path.
 */
const SHIM_SOURCE = `
const bridge = () => globalThis['${BRIDGE_KEY}'];
export default class GrtPmtilesProvider {
  constructor(options) { this.url = options.url; }
  load() { return bridge().load(this.url); }
  loadTile(tile, options) {
    if (options && options.signal && options.signal.aborted) return Promise.resolve(null);
    return bridge().loadTile(this.url, tile);
  }
}
`;

let shimUrl: string | null = null;

/** Blob URL of the shim module. Created once and reused. */
export function shimModuleUrl(): string {
  if (!shimUrl) {
    shimUrl = URL.createObjectURL(new Blob([SHIM_SOURCE], { type: 'text/javascript' }));
  }
  return shimUrl;
}
