// Pure session-summary math for the range mode. Kept separate from the screen
// so it's testable and reused by both the live summary panel and the summary
// page.

import type { LatLng, RangeShot, RangeTarget } from '@/types/range';
import { circleRing, computeShot, pointInPolygon, polygonCentroid } from './rangeGeo';

export interface ClubSummary {
  /** Club label, or 'Unspecified' when no club was attached. */
  club: string;
  shotCount: number;
  /** Mean carry, yards. */
  avgCarryYards: number;
  /** Std dev of the signed offline distance, yards (dispersion). */
  dispersionYards: number;
  /** Mean signed offline (yards) — bias left(-)/right(+). */
  avgOfflineYards: number;
}

const UNSPECIFIED = 'Unspecified';

/** Population standard deviation. */
function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Per-club summaries for clubs with at least `minShots` shots (default 3),
 * sorted by shot count descending. Shots without a club are grouped under
 * 'Unspecified'.
 */
export function computeClubSummaries(shots: RangeShot[], minShots = 3): ClubSummary[] {
  const byClub = new Map<string, RangeShot[]>();
  for (const shot of shots) {
    const key = shot.club ?? UNSPECIFIED;
    const list = byClub.get(key);
    if (list) list.push(shot);
    else byClub.set(key, [shot]);
  }

  const summaries: ClubSummary[] = [];
  for (const [club, list] of byClub) {
    if (list.length < minShots) continue;
    const carries = list.map((s) => s.carryYards);
    const offlines = list.map((s) => s.offlineYards);
    summaries.push({
      club,
      shotCount: list.length,
      avgCarryYards: carries.reduce((a, b) => a + b, 0) / carries.length,
      dispersionYards: stdDev(offlines),
      avgOfflineYards: offlines.reduce((a, b) => a + b, 0) / offlines.length
    });
  }

  return summaries.sort((a, b) => b.shotCount - a.shotCount);
}

/** Human-friendly result chip text for a single shot, e.g. "152 yds · 8 right". */
export function shotChipLabel(carryYards: number, offlineYards: number): string {
  const carry = Math.round(carryYards);
  const off = Math.round(Math.abs(offlineYards));
  if (off === 0) return `${carry} yds · straight`;
  return `${carry} yds · ${off} ${offlineYards > 0 ? 'right' : 'left'}`;
}

// --- per-club dot colors ---------------------------------------------------

/** Canonical accent per named club; everything else falls back to a palette. */
const NAMED_CLUB_COLORS: Array<[RegExp, string]> = [
  [/\bdriver\b|^d$|\bdrv\b/i, '#f88930'],
  [/\b3\s?(w|wood)\b/i, '#ffce5c'],
  [/\b5\s?(i|iron)\b/i, '#34d27b'],
  [/\b7\s?(i|iron)\b/i, '#4cc8f0'],
  [/\b9\s?(i|iron)\b/i, '#8b9bff'],
  [/\bpw\b|pitch/i, '#ff7a8a']
];
const FALLBACK_PALETTE = ['#f88930', '#ffce5c', '#34d27b', '#4cc8f0', '#8b9bff', '#ff7a8a', '#c084fc', '#fbbf24'];
const NO_CLUB_COLOR = '#ff5a52';

/** A stable dot color for a club label — the named palette, else a hashed fallback. */
export function clubColor(label: string | null | undefined): string {
  if (!label) return NO_CLUB_COLOR;
  for (const [re, color] of NAMED_CLUB_COLORS) {
    if (re.test(label)) return color;
  }
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

// --- per-shot result vs an aim target --------------------------------------

export interface ShotResult {
  /** Landing point fell inside the target shape. */
  hit: boolean;
  lateral: 'left' | 'right' | null;
  depth: 'short' | 'long' | null;
  /** Short human label: "On target", "Long & right", "Left", … */
  label: string;
}

/** The target's full outline as {lat,lng} vertices, plus its center (aim point). */
function targetRing(target: RangeTarget): { ring: LatLng[]; center: LatLng } {
  if (target.kind === 'polygon' && target.points && target.points.length >= 3) {
    return { ring: target.points, center: polygonCentroid(target.points) };
  }
  const center = target.center ?? target.anchor;
  const radiusM = target.radiusM ?? 4.5;
  return { ring: circleRing(center, radiusM).map(([lng, lat]) => ({ lat, lng })), center };
}

/**
 * Classify where a shot landed relative to the WHOLE drawn target (its full
 * circle/shape, not a point). A shot anywhere inside the shape is "on target".
 * Otherwise short/long and left/right are measured against the shape's actual
 * extent — we project every outline vertex onto the aim frame (origin->center)
 * and compare the shot's carry/offline to those real min/max bounds.
 */
export function classifyShotVsTarget(origin: LatLng, target: RangeTarget, land: LatLng): ShotResult {
  const { ring, center } = targetRing(target);
  if (pointInPolygon(land, ring)) {
    return { hit: true, lateral: null, depth: null, label: 'On target' };
  }

  const shot = computeShot(origin, center, land);
  let minCarry = Infinity;
  let maxCarry = -Infinity;
  let minOffline = Infinity;
  let maxOffline = -Infinity;
  for (const v of ring) {
    const d = computeShot(origin, center, v);
    if (d.carryM < minCarry) minCarry = d.carryM;
    if (d.carryM > maxCarry) maxCarry = d.carryM;
    if (d.offlineM < minOffline) minOffline = d.offlineM;
    if (d.offlineM > maxOffline) maxOffline = d.offlineM;
  }

  const depth: ShotResult['depth'] =
    shot.carryM > maxCarry ? 'long' : shot.carryM < minCarry ? 'short' : null;
  const lateral: ShotResult['lateral'] =
    shot.offlineM > maxOffline ? 'right' : shot.offlineM < minOffline ? 'left' : null;

  const parts: string[] = [];
  if (depth) parts.push(depth);
  if (lateral) parts.push(lateral);
  const label = parts.length
    ? parts.map((p, i) => (i === 0 ? p[0].toUpperCase() + p.slice(1) : p)).join(' & ')
    : 'Just off';
  return { hit: false, lateral, depth, label };
}
