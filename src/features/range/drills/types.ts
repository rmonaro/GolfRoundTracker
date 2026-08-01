// Drill engine types. A drill is a CONFIG object (a `DrillDefinition`), not a
// screen — one generic DrillRunner drives the existing range loop and reads the
// definition for setup, per-shot instruction, scoring, completion, and report.
// Adding a new drill = a new definition in the registry; no new screen.
//
// The engine is intentionally PURE: `onShot` receives an already-decomposed shot
// (carry/offline/total in yards, computed by the runner via rangeGeo) and does
// only arithmetic. No geo, no turf, no I/O — so every drill is unit-testable.

export type DrillCategory = 'foundation' | 'skill' | 'transfer';

export type ShotZone = 'great' | 'good' | 'miss' | null;

/** A field rendered generically on the setup sheet (Phase 4). */
export type SetupField =
  | { kind: 'clubs'; key: string; label: string; help?: string; default: 'fullBag' | 'none' }
  | {
      kind: 'number';
      key: string;
      label: string;
      help?: string;
      default: number;
      min: number;
      max: number;
      step?: number;
      suffix?: string;
    }
  | { kind: 'toggle'; key: string; label: string; help?: string; default: boolean }
  | {
      kind: 'select';
      key: string;
      label: string;
      help?: string;
      default: string;
      options: Array<{ value: string; label: string }>;
    };

/** A club available to a drill, derived from the user's bag. */
export interface DrillClub {
  /** Display label (customName || name). */
  label: string;
  category: string;
  /** Typical/measured carry in yards from the bag, if known. */
  carryYards: number | null;
}

export interface DrillContext {
  bag: DrillClub[];
  config: Record<string, unknown>;
}

/** What the user should do RIGHT NOW. Null once the drill is complete. */
export interface CurrentShot {
  /** Prescribed club label, or null when the user picks their own. */
  club: string | null;
  /** Prescribed carry in yards, or null for dispersion-only drills. */
  targetYards: number | null;
  instruction: string;
  shotNumber: number; // 1-based
  totalShots: number;
}

/** A logged shot the drill has scored and kept. */
export interface ShotRecord {
  /** Club actually used (prescribed unless the user overrode it). */
  club: string | null;
  prescribedClub: string | null;
  targetYards: number | null;
  carryYards: number;
  offlineYards: number; // + right, - left
  totalYards: number;
  proximityYards: number | null;
  zone: ShotZone;
}

/** The raw, already-decomposed tap handed to the drill by the runner. */
export interface RawShot {
  carryYards: number;
  offlineYards: number;
  totalYards: number;
  /** The club the user had selected at tap time (may override the prescription). */
  club: string | null;
}

export interface DrillState {
  shotsLogged: ShotRecord[];
  current: CurrentShot | null;
  /** Per-drill bookkeeping (rotation queue, club index, target sequence…). */
  scratch: Record<string, unknown>;
}

/** Per-shot feedback returned after a tap. */
export interface ShotResult {
  carryYards: number;
  offlineYards: number;
  proximityYards: number | null;
  zone: ShotZone;
  note: string; // short caddie-style line
}

export interface ReportStat {
  label: string;
  value: string;
  sub?: string;
}

export interface DrillReport {
  /** The single most useful number, shown big at the top. */
  headline: { label: string; value: string };
  stats: ReportStat[];
  /** Which custom report screen renders the detail. */
  kind: string;
  /** Structured payload for that screen (carry ladder, dispersion, scatter…). */
  data: Record<string, unknown>;
}

export interface DrillDefinition {
  id: string;
  name: string;
  category: DrillCategory;
  blurb: string;
  why: string;
  setupSchema: SetupField[];
  /** Whether this run prescribes target yardages (→ proximity scoring + ring overlay). */
  usesTargets(config: Record<string, unknown>): boolean;

  init(ctx: DrillContext): DrillState;
  onShot(raw: RawShot, state: DrillState, ctx: DrillContext): { result: ShotResult; nextState: DrillState };
  isComplete(state: DrillState): boolean;
  report(state: DrillState, ctx: DrillContext): DrillReport;
}
