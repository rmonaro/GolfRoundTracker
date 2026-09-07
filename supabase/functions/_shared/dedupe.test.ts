import { describe, expect, it } from 'vitest';
import {
  clusterDuplicates,
  completenessScore,
  isSameCourse,
  normaliseCourseName,
  type DedupeCandidate
} from './dedupe.ts';

/** Real rows from the library, trimmed to the fields matching uses. */
const course = (
  id: string,
  name: string,
  lat: number | null,
  lng: number | null,
  city: string | null = null,
  state: string | null = null
): DedupeCandidate => ({ id, name, lat, lng, city, state });

describe('normaliseCourseName', () => {
  it('collapses the ways a source can spell the same club', () => {
    expect(normaliseCourseName('Richter Park Golf Course')).toBe('richter park');
    expect(normaliseCourseName('Richter Park GC')).toBe('richter park');
    expect(normaliseCourseName('The Richter Park Golf Club')).toBe('richter park');
    expect(normaliseCourseName('Cross Creek Country Club')).toBe('cross creek');
  });

  it('keeps the words that tell two courses at one facility apart', () => {
    // Whirlwind is a 36-hole facility sharing a clubhouse — and a single OSM
    // extract. Its two courses must never group together.
    expect(normaliseCourseName("Whirlwind Golf Club - Devil's Claw")).toBe('whirlwind devils claw');
    // Same course, apostrophe dropped by the other provider.
    expect(normaliseCourseName('Whirlwind Devils Claw')).toBe('whirlwind devils claw');
    expect(normaliseCourseName('Whirlwind Golf Club - Cattail')).toBe('whirlwind cattail');
    expect(normaliseCourseName('Raven Golf Club at Verrado')).toBe('raven at verrado');
  });

  it('folds accents and ampersands rather than treating them as new words', () => {
    expect(normaliseCourseName('Dorado Beach Golf Club')).toBe(
      normaliseCourseName('Dorádo Beach Golf Club')
    );
    expect(normaliseCourseName('Ford & Sons Links')).toBe('ford and sons');
  });

  it('returns empty for a name with nothing but generic words', () => {
    expect(normaliseCourseName('The Golf Club')).toBe('');
    expect(normaliseCourseName('')).toBe('');
  });
});

describe('isSameCourse', () => {
  it('matches two sources that put the same club a few hundred metres apart', () => {
    // The two Richter Park rows, 0.22 km apart.
    const a = course('a', 'Richter Park Golf Course', 41.4135, -73.5265);
    const b = course('b', 'Richter Park', 41.4155, -73.5265);
    expect(isSameCourse(a, b, 1)).toBe(true);
  });

  it('refuses two real clubs that happen to share a name', () => {
    // Brae Burn in Purchase NY and Brae Burn in Dansville NY.
    const purchase = course('a', 'Brae Burn Country Club', 41.0246, -73.7126);
    const dansville = course('b', 'Brae Burn Golf Course', 42.5606, -77.696);
    expect(isSameCourse(purchase, dansville, 1)).toBe(false);
  });

  it('falls back to town and state when a row has no coordinates', () => {
    const a = course('a', 'Cross Creek', null, null, 'Fort Myers', 'FL');
    const b = course('b', 'Cross Creek', 26.5, -81.9, 'Fort Myers', 'FL');
    expect(isSameCourse(a, b, 1)).toBe(true);

    const elsewhere = course('c', 'Cross Creek', null, null, 'Naples', 'FL');
    expect(isSameCourse(a, elsewhere, 1)).toBe(false);
  });

  it('does not match two rows that both lack a town', () => {
    const a = course('a', 'Cross Creek', null, null, null, 'FL');
    const b = course('b', 'Cross Creek', null, null, null, 'FL');
    expect(isSameCourse(a, b, 1)).toBe(false);
  });
});

describe('clusterDuplicates', () => {
  it('groups the duplicates and leaves everything else alone', () => {
    const rows = [
      course('richter-a', 'Richter Park Golf Course', 41.4135, -73.5265),
      course('richter-b', 'Richter Park', 41.4155, -73.5265),
      course('brae-purchase', 'Brae Burn Country Club', 41.0246, -73.7126),
      course('brae-dansville', 'Brae Burn Golf Course', 42.5606, -77.696),
      course('cattail', 'Whirlwind Golf Club - Cattail', 33.2645, -111.9702),
      course('devils', "Whirlwind Golf Club - Devil's Claw", 33.2649, -111.9718),
      course('lonely', 'Pebble Beach Golf Links', 36.5686, -121.9497)
    ];

    const clusters = clusterDuplicates(rows, 1);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].key).toBe('richter park');
    expect(clusters[0].members.map((m) => m.id).sort()).toEqual(['richter-a', 'richter-b']);
  });

  it('splits one name into separate clusters per location', () => {
    const rows = [
      course('a1', 'Hillcrest Golf Club', 41.0, -73.0),
      course('a2', 'Hillcrest GC', 41.0001, -73.0001),
      course('b1', 'Hillcrest Golf Course', 44.0, -93.0),
      course('b2', 'Hillcrest Country Club', 44.0002, -93.0002)
    ];
    const clusters = clusterDuplicates(rows, 1);
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.members.length === 2)).toBe(true);
  });

  it('honours a widened radius', () => {
    const a = course('a', 'Sandy Lane', 41.0, -73.0);
    // ~1.7 km north.
    const b = course('b', 'Sandy Lane Golf Club', 41.0153, -73.0);
    expect(clusterDuplicates([a, b], 1)).toHaveLength(0);
    expect(clusterDuplicates([a, b], 2)).toHaveLength(1);
  });
});

describe('completenessScore', () => {
  const base = {
    osm_status: null as string | null,
    verified: null as boolean | null,
    tiles_url: null as string | null,
    lat: 41 as number | null,
    lng: -73 as number | null,
    course_api_id: null as string | null,
    source: 'opengolf' as string | null
  };
  const noCounts = { holes: 0, tees: 0, features: 0, rounds: 0 };

  it('ranks a synced course above an unsynced one with a full scorecard', () => {
    const synced = completenessScore({ ...base, osm_status: 'synced' }, noCounts);
    const unsynced = completenessScore(base, { holes: 18, tees: 5, features: 0, rounds: 0 });
    expect(synced).toBeGreaterThan(unsynced);
  });

  it('prefers the row that already holds the rounds when both are synced', () => {
    const withRounds = completenessScore(
      { ...base, osm_status: 'synced' },
      { ...noCounts, rounds: 4 }
    );
    const without = completenessScore({ ...base, osm_status: 'synced' }, noCounts);
    expect(withRounds).toBeGreaterThan(without);
  });

  it('caps the feature count so geometry cannot outweigh having holes', () => {
    const manyFeatures = completenessScore(base, { ...noCounts, features: 5000 });
    const holesAndTees = completenessScore(base, {
      holes: 18,
      tees: 4,
      features: 200,
      rounds: 0
    });
    expect(holesAndTees).toBeGreaterThan(manyFeatures);
  });
});
