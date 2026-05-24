/**
 * Custom golf-club glyphs for the tier-1 shot picker.
 * All icons share a 24×24 viewBox, render in `currentColor`, and depict a club
 * standing vertically (grip → shaft → head from top to bottom).
 *
 * Visual differentiation between categories:
 *   • Driver — biggest bulbous head
 *   • Wood   — smaller rounded head
 *   • Iron   — thin angled blade
 *   • Wedge  — shorter blade with heavier sole / steeper face
 *   • Putter — long flat blade with a sight line
 */

interface IconProps {
  size?: number;
}

const DEFAULT_SIZE = 26;

export function DriverIcon({ size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="10" y="2" width="4" height="2.5" rx="0.5" />
      <rect x="11.25" y="4" width="1.5" height="14" />
      <ellipse cx="12" cy="20" rx="6" ry="3.5" />
    </svg>
  );
}

export function WoodIcon({ size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="10" y="2" width="4" height="2.5" rx="0.5" />
      <rect x="11.25" y="4" width="1.5" height="14.5" />
      <ellipse cx="12" cy="20" rx="4" ry="2.5" />
    </svg>
  );
}

export function IronIcon({ size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="10" y="2" width="4" height="2.5" rx="0.5" />
      <rect x="11.25" y="4" width="1.5" height="15" />
      {/* Slim angled blade — top edge slopes forward */}
      <path d="M 6.5 19 L 17.5 17.5 L 17.5 21.5 L 6.5 21.5 Z" />
    </svg>
  );
}

export function WedgeIcon({ size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="10" y="2" width="4" height="2.5" rx="0.5" />
      <rect x="11.25" y="4" width="1.5" height="14" />
      {/* Heavier sole, more aggressive top-edge angle = higher loft */}
      <path d="M 6 19.5 L 18 16 L 18 21.5 L 5.5 21.5 Z" />
    </svg>
  );
}

export function PutterIcon({ size = DEFAULT_SIZE }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <rect x="10" y="2" width="4" height="2.5" rx="0.5" />
      <rect x="11.25" y="4" width="1.5" height="12" />
      {/* Sight-line connector + long flat blade */}
      <rect x="11.4" y="16" width="1.2" height="3" />
      <rect x="3" y="18.5" width="18" height="3" rx="0.5" />
    </svg>
  );
}
