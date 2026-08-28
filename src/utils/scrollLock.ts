/**
 * Refcounted document scroll lock.
 *
 * iOS PWAs rubber-band the document even when the real scroll container is an
 * inner element with `overflow: hidden`, so the shells that own a viewport pin
 * `body` with `position: fixed` + `inset: 0`. `height: 100%` alone isn't enough
 * on iOS, where 100% of html doesn't always include the safe areas.
 *
 * Refcounted because two components independently snapshotted and restored
 * `body.style` before this existed (MobileShell and the hole-tracking page). If
 * one ever took its snapshot while the other's lock was applied — overlapping
 * mounts, an unmount whose cleanup didn't run — it saved the LOCKED values and
 * "restored" them on the way out, leaving the document permanently unscrollable.
 * That's what made pages intermittently refuse to scroll. Here only the first
 * acquire snapshots, and only the last release restores.
 *
 * Each call returns its own release function; calling it twice is a no-op, so a
 * double-invoked effect cleanup can't drive the count negative.
 */

/** Body style properties the lock touches, and therefore must save + restore. */
const BODY_PROPS = [
  'position',
  'overflow',
  'top',
  'right',
  'bottom',
  'left',
  'width',
  'height',
  'touchAction'
] as const;

type BodyProp = (typeof BODY_PROPS)[number];

let depth = 0;
/** Separate count: `touch-action: none` is opt-in (see `blockTouch`). */
let touchDepth = 0;
let saved: { htmlOverflow: string; body: Record<BodyProp, string> } | null = null;

const bodyStyle = () => document.body.style as unknown as Record<BodyProp, string>;

export interface ScrollLockOptions {
  /**
   * Also set `touch-action: none` on the body. Only for screens that own the
   * whole viewport and handle their own gestures (the map-driven round screen)
   * — it suppresses panning for gestures that START on any descendant, which
   * would break an inner scroll container.
   */
  blockTouch?: boolean;
}

/**
 * Lock document scrolling. Returns the release function — hand it straight back
 * from a `useEffect` as its cleanup.
 */
export function lockDocumentScroll(options: ScrollLockOptions = {}): () => void {
  const html = document.documentElement;
  const style = bodyStyle();

  if (depth === 0) {
    saved = {
      htmlOverflow: html.style.overflow,
      body: Object.fromEntries(BODY_PROPS.map((p) => [p, style[p]])) as Record<
        BodyProp,
        string
      >
    };
    html.style.overflow = 'hidden';
    style.position = 'fixed';
    style.overflow = 'hidden';
    // Anchor to all four edges rather than sizing: this reliably extends the
    // body through the safe-area zones, which `height: 100%` does not on iOS.
    style.top = '0';
    style.right = '0';
    style.bottom = '0';
    style.left = '0';
    style.width = '';
    style.height = '';
  }
  depth++;

  if (options.blockTouch) {
    touchDepth++;
    style.touchAction = 'none';
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;

    if (options.blockTouch) {
      touchDepth = Math.max(0, touchDepth - 1);
      if (touchDepth === 0 && saved) bodyStyle().touchAction = saved.body.touchAction;
    }

    depth = Math.max(0, depth - 1);
    if (depth > 0 || !saved) return;

    const restore = saved;
    saved = null;
    document.documentElement.style.overflow = restore.htmlOverflow;
    const s = bodyStyle();
    for (const p of BODY_PROPS) {
      // A still-held touch lock outlives this release; leave it applied.
      if (p === 'touchAction' && touchDepth > 0) continue;
      s[p] = restore.body[p];
    }
  };
}
