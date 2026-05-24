/**
 * Selectable golf club brands.
 * Order is curated — major OEMs first, then quality brands, then specialty / DTC / heritage.
 * If the user picks "Other", we show a free-text input and store whatever they type.
 */
export const CLUB_BRANDS = [
  'Callaway',
  'TaylorMade',
  'Titleist',
  'Ping',
  'Cobra Golf',
  'Mizuno',
  'PXG',
  'Cleveland Golf',
  'Srixon',
  'Wilson Staff',
  'Tour Edge',
  'Bridgestone Golf',
  'XXIO',
  'Honma',
  'Yonex',
  'Miura',
  'Fourteen Golf',
  'PRGR',
  'Scotty Cameron',
  'Bettinardi',
  'L.A.B. Golf',
  'Evnroll',
  'SeeMore',
  'Odyssey',
  'Vokey',
  'Edel Golf',
  'Bobby Grace',
  'Sub 70',
  'Takomo',
  'Stix Golf',
  'Haywood Golf',
  'New Level Golf',
  'Ben Hogan Golf',
  'Robin Golf',
  'Vice Golf',
  'Avoda Golf',
  'Maltby',
  'MacGregor Golf',
  'Adams Golf',
  'Ben Sayers',
  'John Letters',
  'Ram Golf',
  'PowerBilt',
  'Forgan',
  'Nickent',
  'Tommy Armour Golf',
  'Sonartec',
  'Founders Club'
] as const;

export const OTHER_BRAND = 'Other' as const;

export type KnownBrand = (typeof CLUB_BRANDS)[number];
