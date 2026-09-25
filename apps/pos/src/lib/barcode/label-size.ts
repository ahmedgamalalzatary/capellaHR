/**
 * The measured white sticker is 40mm across by 10mm high, including all text.
 * This is the white sticker, not the Windows print page used by Alpha Soft.
 */
export const LABEL_SIZE_MM = { width: 40, height: 10 } as const;

/** Alpha Soft Half Layout: PaperSize("papersize", 150, 100), in 1/100 inch. */
export const LABEL_PAGE_SIZE_MM = { width: 38.1, height: 25.4 } as const;

/** GDI printer coordinates are hundredths of an inch; retain their precision. */
export const labelUnitMm = (units: number) => Math.round(units * 254) / 1000;

/** The selected desktop template fills the lower slot, then the upper slot. */
export const LABEL_SLOT_Y = [56, 6] as const;

/** Same Windows-driver page contract as Alpha Soft, via the browser. */
export const LABEL_PAGE_RULE =
  `@page { size: ${LABEL_PAGE_SIZE_MM.width}mm ${LABEL_PAGE_SIZE_MM.height}mm; margin: 0; }`;
