// Physical parameters (single source of truth for the UI; the worklet carries the same numbers).
export const FIRING_ORDER = [1, 5, 3, 6, 2, 4] as const;
export const C_GAS = 615; // m/s at 1023 K (750 C)
export const RPM_IDLE = 1000;
export const RPM_REDLINE = 7200;

export const GEOMETRY = {
  downpipeMm: 598,
  bank1MidpipeMm: 1698, // includes +330 mm equalization loop
  bank2MidpipeMm: 1368, // direct
  jPipeMm: 650,
  xPipeAngleDeg: 18,
  tipDiameterMm: 101.6,
  stockEquivalentMm: 2300, // modelling assumption for the "Stock OEM" A/B reference
  tailMm: 1100, // modelling assumption: X-pipe -> rear muffler -> tip
} as const;

export const bank1TotalMm = GEOMETRY.downpipeMm + GEOMETRY.bank1MidpipeMm;
export const bank2TotalMm = GEOMETRY.downpipeMm + GEOMETRY.bank2MidpipeMm;
export const deltaLenMm = bank1TotalMm - bank2TotalMm;
export const deltaTUs = (deltaLenMm / 1000 / C_GAS) * 1e6; // 330 mm -> ~537 us
export const firingHz = (rpm: number) => (3 * rpm) / 60; // inline-6: 3 events per crank rev
export const jPipeQuarterWaveHz = C_GAS / (4 * (GEOMETRY.jPipeMm / 1000));

export const WORKLET_OPTIONS = {
  c: C_GAS,
  b1: bank1TotalMm,
  b2: bank2TotalMm,
  stock: GEOMETRY.stockEquivalentMm,
  tail: GEOMETRY.tailMm,
};
