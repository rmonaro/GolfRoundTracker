// Mapbox GL JS singleton initializer.
//
// Mapbox's SDK keeps the access token on the module-level `mapboxgl` namespace,
// so there's no React context to thread through. We expose two helpers:
//
//   initMapbox()  — set the access token once at app bootstrap. Returns true if
//                   the token is configured, false otherwise (e.g. local env
//                   without VITE_MAPBOX_TOKEN). Idempotent: safe to call N times.
//   hasMapbox()   — cheap predicate the layout component can call on every
//                   render to decide between Mapbox and the SVG fallback.
//
// When the token is missing, the SDK is still bundled (it's imported here for
// side-effect CSS), but no map is ever instantiated — the layout falls back to
// the SVG render path.

import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

let initialized = false;

export function initMapbox(): boolean {
  if (initialized) return !!mapboxgl.accessToken;
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token) {
    console.warn('[mapbox] VITE_MAPBOX_TOKEN missing — falling back to SVG rendering');
    initialized = true;
    return false;
  }
  mapboxgl.accessToken = token;
  initialized = true;
  return true;
}

export function hasMapbox(): boolean {
  return !!import.meta.env.VITE_MAPBOX_TOKEN;
}

export { mapboxgl };
