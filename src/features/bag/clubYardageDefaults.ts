import type { ClubCategory, Gender, SkillLevel } from '@/models';

type WedgeKey = 'PW' | 'GW' | 'SW' | 'LW';

type YardageRow = Record<SkillLevel, number>;

interface YardageTable {
  driver: YardageRow;
  woods: Record<number, YardageRow>;
  hybrid: YardageRow;
  irons: Record<number, YardageRow>;
  wedges: Record<WedgeKey, YardageRow>;
}

// Note: SkillLevel's `pga_tour` key is reused for the LPGA Tour row in the
// women's table — same enum value, different reference data.
const MEN: YardageTable = {
  driver: { beginner: 190, average: 230, good: 255, advanced: 275, pga_tour: 295 },
  woods: {
    3: { beginner: 175, average: 215, good: 235, advanced: 250, pga_tour: 275 },
    5: { beginner: 165, average: 205, good: 220, advanced: 235, pga_tour: 250 }
  },
  hybrid: { beginner: 155, average: 195, good: 210, advanced: 225, pga_tour: 240 },
  irons: {
    4: { beginner: 145, average: 185, good: 200, advanced: 215, pga_tour: 225 },
    5: { beginner: 135, average: 175, good: 190, advanced: 205, pga_tour: 215 },
    6: { beginner: 125, average: 165, good: 180, advanced: 195, pga_tour: 205 },
    7: { beginner: 115, average: 155, good: 170, advanced: 185, pga_tour: 195 },
    8: { beginner: 105, average: 145, good: 160, advanced: 175, pga_tour: 183 },
    9: { beginner: 95, average: 135, good: 150, advanced: 165, pga_tour: 172 }
  },
  wedges: {
    PW: { beginner: 80, average: 120, good: 135, advanced: 150, pga_tour: 155 },
    GW: { beginner: 70, average: 105, good: 120, advanced: 135, pga_tour: 140 },
    SW: { beginner: 60, average: 90, good: 105, advanced: 120, pga_tour: 125 },
    LW: { beginner: 50, average: 75, good: 90, advanced: 105, pga_tour: 110 }
  }
};

const WOMEN: YardageTable = {
  driver: { beginner: 140, average: 180, good: 210, advanced: 235, pga_tour: 255 },
  woods: {
    3: { beginner: 130, average: 170, good: 195, advanced: 220, pga_tour: 235 },
    5: { beginner: 120, average: 160, good: 185, advanced: 205, pga_tour: 220 }
  },
  hybrid: { beginner: 110, average: 150, good: 175, advanced: 195, pga_tour: 210 },
  irons: {
    4: { beginner: 100, average: 140, good: 165, advanced: 185, pga_tour: 195 },
    5: { beginner: 90, average: 130, good: 155, advanced: 175, pga_tour: 185 },
    6: { beginner: 80, average: 120, good: 145, advanced: 165, pga_tour: 175 },
    7: { beginner: 70, average: 110, good: 135, advanced: 155, pga_tour: 165 },
    8: { beginner: 60, average: 100, good: 125, advanced: 145, pga_tour: 155 },
    9: { beginner: 50, average: 90, good: 115, advanced: 135, pga_tour: 145 }
  },
  wedges: {
    PW: { beginner: 40, average: 80, good: 100, advanced: 120, pga_tour: 130 },
    GW: { beginner: 35, average: 70, good: 90, advanced: 110, pga_tour: 120 },
    SW: { beginner: 30, average: 60, good: 80, advanced: 95, pga_tour: 105 },
    LW: { beginner: 20, average: 50, good: 70, advanced: 85, pga_tour: 95 }
  }
};

function tableFor(gender: Gender): YardageTable {
  return gender === 'female' ? WOMEN : MEN;
}

function wedgeKeyFromLoft(loft: number): WedgeKey {
  if (loft <= 48) return 'PW';
  if (loft <= 52) return 'GW';
  if (loft <= 57) return 'SW';
  return 'LW';
}

function normalizeWedgeType(input: string | null | undefined): WedgeKey | null {
  if (!input) return null;
  const v = input.toUpperCase();
  if (v === 'AW') return 'GW';
  if (v === 'PW' || v === 'GW' || v === 'SW' || v === 'LW') return v;
  return null;
}

function closestKey(target: number, keys: number[]): number {
  return keys.reduce((best, k) =>
    Math.abs(k - target) < Math.abs(best - target) ? k : best
  );
}

export interface ClubIdentity {
  category: ClubCategory;
  number?: number | null;
  wedgeType?: string | null;
  loft?: number | null;
}

/**
 * Returns the suggested typical-carry yardage for a club at a given skill
 * level + gender, or `null` if either is unset or the club cannot be matched.
 */
export function getDefaultYardage(
  skillLevel: SkillLevel | null | undefined,
  gender: Gender | null | undefined,
  club: ClubIdentity
): number | null {
  if (!skillLevel || !gender) return null;
  const t = tableFor(gender);

  switch (club.category) {
    case 'driver':
      return t.driver[skillLevel];
    case 'putter':
      return null;
    case 'wood': {
      if (club.number != null && t.woods[club.number]) return t.woods[club.number][skillLevel];
      const fallback = club.number != null && club.number <= 3 ? 3 : 5;
      return t.woods[fallback][skillLevel];
    }
    case 'hybrid':
      return t.hybrid[skillLevel];
    case 'iron': {
      if (club.number == null) return null;
      if (t.irons[club.number]) return t.irons[club.number][skillLevel];
      const nearest = closestKey(club.number, Object.keys(t.irons).map(Number));
      return t.irons[nearest][skillLevel];
    }
    case 'wedge': {
      const typed = normalizeWedgeType(club.wedgeType);
      if (typed) return t.wedges[typed][skillLevel];
      if (club.loft != null) return t.wedges[wedgeKeyFromLoft(club.loft)][skillLevel];
      return null;
    }
  }
}

/**
 * Resolves a yardage from a DEFAULT_BAG-style display name (e.g. "7 Iron",
 * "3 Wood", "PW"). Used by the Quick Add flow which only carries name + category.
 */
export function getDefaultYardageByName(
  skillLevel: SkillLevel | null | undefined,
  gender: Gender | null | undefined,
  name: string,
  category: ClubCategory
): number | null {
  if (!skillLevel || !gender) return null;
  const trimmed = name.trim();

  if (category === 'wedge') {
    const m = /^(PW|GW|AW|SW|LW)$/i.exec(trimmed);
    return getDefaultYardage(skillLevel, gender, { category, wedgeType: m?.[1] ?? null });
  }
  if (category === 'driver' || category === 'putter') {
    return getDefaultYardage(skillLevel, gender, { category });
  }

  const m = /^(\d+)/.exec(trimmed);
  const number = m ? Number(m[1]) : null;
  return getDefaultYardage(skillLevel, gender, { category, number });
}
