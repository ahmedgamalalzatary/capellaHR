/**
 * The sticker roll the XP-233B is loaded with, confirmed with the shop: 4 cm
 * across the roll by 1 cm of feed. This is the one constant everything else
 * derives from — the print page rule, the sheet layout and the barcode height.
 * Changing the roll is a one-line edit here, not a redesign.
 */
export const LABEL_SIZE_MM = { width: 40, height: 10 } as const;

/**
 * Printing goes through the printer's Windows driver rather than raw ESC/POS or
 * TSPL bytes: the model's label claims ESC/POS while this hardware commonly
 * speaks TSPL, and the driver makes the question irrelevant.
 */
export const LABEL_PAGE_RULE =
  `@page { size: ${LABEL_SIZE_MM.width}mm ${LABEL_SIZE_MM.height}mm; margin: 0; }`;
