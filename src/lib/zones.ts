export type ZoneId = "DE" | "AT" | "FR" | "CZ" | "HU" | "SK" | "RO" | "PL" | "BG";

export type Zone = {
  id: ZoneId;
  name: string;
  short: string;
  eexArea: string;
  monthCode: string;
  /** Prefix for EEX Base Day futures, e.g. DB + 05 → DB05. Null = no day contract. */
  dayPrefix: string | null;
  /** Base shortCode for Week (calendar): DEB + maturity 202637. Null = no week. */
  weekCode: string | null;
  /** Base shortCode for Weekend: DWB + maturity YYYYWW. Null = no weekend. */
  weekendCode: string | null;
  spotNeedle: string;
};

export const ZONES: Zone[] = [
  {
    id: "DE",
    name: "Німеччина",
    short: "DE-LU",
    eexArea: "DE",
    monthCode: "DEBM",
    dayPrefix: "DB",
    weekCode: "DEB",
    weekendCode: "DWB",
    spotNeedle: "(DE-LU)",
  },
  {
    id: "AT",
    name: "Австрія",
    short: "AT",
    eexArea: "AT",
    monthCode: "ATBM",
    dayPrefix: "AB",
    weekCode: "AWB",
    weekendCode: "AWB", // same family; API accepts AWB for week; weekend may share
    spotNeedle: "(AT)",
  },
  {
    id: "FR",
    name: "Франція",
    short: "FR",
    eexArea: "FR",
    monthCode: "F7BM",
    dayPrefix: "F7",
    weekCode: "F7B",
    weekendCode: "F7W",
    spotNeedle: "(FR)",
  },
  {
    id: "CZ",
    name: "Чехія",
    short: "CZ",
    eexArea: "CZ",
    monthCode: "FXBM",
    dayPrefix: "FX",
    weekCode: "FXB",
    weekendCode: "FXW",
    spotNeedle: "(CZ)",
  },
  {
    id: "HU",
    name: "Угорщина",
    short: "HU",
    eexArea: "HU",
    monthCode: "F9BM",
    dayPrefix: "F9",
    weekCode: "F9B",
    weekendCode: "F9W",
    spotNeedle: "(HU)",
  },
  {
    id: "SK",
    name: "Словаччина",
    short: "SK",
    eexArea: "SK",
    monthCode: "FYBM",
    dayPrefix: null,
    weekCode: "FYB",
    weekendCode: "FYW",
    spotNeedle: "(SK)",
  },
  {
    id: "RO",
    name: "Румунія",
    short: "RO",
    eexArea: "RO",
    monthCode: "FHBM",
    dayPrefix: null,
    weekCode: "FHB",
    weekendCode: "FHW",
    spotNeedle: "(RO)",
  },
  {
    id: "PL",
    name: "Польща",
    short: "PL",
    eexArea: "PL",
    monthCode: "FPBM",
    dayPrefix: null,
    weekCode: "FPB",
    weekendCode: "FPW",
    spotNeedle: "(PL)",
  },
  {
    id: "BG",
    name: "Болгарія",
    short: "BG",
    eexArea: "BG",
    monthCode: "FKBM",
    dayPrefix: null,
    weekCode: "FKB",
    weekendCode: "FKW",
    spotNeedle: "(BG)",
  },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z])) as Record<
  ZoneId,
  Zone
>;

export function dayShortCode(prefix: string, isoDate: string): string {
  const day = isoDate.slice(8, 10);
  return `${prefix}${day}`;
}

export function monthMaturity(isoDate: string): string {
  return isoDate.slice(0, 4) + isoDate.slice(5, 7);
}

/** ISO week maturity for EEX: YYYYWW e.g. 202637 */
export function isoWeekMaturity(isoDate: string): number {
  const d = new Date(`${isoDate}T12:00:00Z`);
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const y = d.getUTCFullYear();
  return y * 100 + week;
}
