/**
 * Alpha Soft's "Label ( 5 CM) Full Layout" — 5 cm across the roll by 2.5 cm of
 * feed. Code 39 needs that extra width: the same 13-digit code on a 4 cm sticker
 * draws bars too thin for the QW2100. The XP-233B feeds 20–60 mm, so 50 mm fits.
 * This is the one constant everything else derives from — the print page rule,
 * the sheet layout and the barcode height. Changing the roll is a one-line edit.
 */
export const LABEL_SIZE_MM = { width: 50, height: 25 } as const;

/**
 * Printing goes through the printer's Windows driver rather than raw ESC/POS or
 * TSPL bytes: the model's label claims ESC/POS while this hardware commonly
 * speaks TSPL, and the driver makes the question irrelevant.
 */
export const LABEL_PAGE_RULE =
  `@page { size: ${LABEL_SIZE_MM.width}mm ${LABEL_SIZE_MM.height}mm; margin: 0; }`;
