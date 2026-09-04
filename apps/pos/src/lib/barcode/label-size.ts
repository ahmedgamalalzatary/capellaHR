/**
 * The sticker roll the XP-233B is loaded with, confirmed with the shop: 4 cm
 * across the roll by 1 cm of feed. This is the one constant everything else
 * derives from — the print page rule, the sheet layout and the barcode height.
 * Changing the roll is a one-line edit here, not a redesign.
 */
export const LABEL_SIZE_MM = { width: 40, height: 10 } as const;

/**
 * The page a turned sticker occupies: the roll's own sides, swapped.
 *
 * The sticker is composed at its full 4 cm of reading length and then turned a
 * quarter turn clockwise, so the paper it lands on is 1 cm across by 4 cm of
 * feed. Turning the finished artwork rather than re-authoring it inside a
 * centimetre of width is what keeps the bars their full length: an EAN-13
 * squeezed into 1 cm has modules finer than a 203-dpi head can lay down, and
 * would print as a smear no scanner could read.
 */
export const LABEL_PAGE_MM = {
  width: LABEL_SIZE_MM.height,
  height: LABEL_SIZE_MM.width,
} as const;

/** CSS angles run clockwise, so a positive quarter turn is the one we want. */
export const LABEL_QUARTER_TURN_CW = 'rotate(90deg)';

/**
 * Printing goes through the printer's Windows driver rather than raw ESC/POS or
 * TSPL bytes: the model's label claims ESC/POS while this hardware commonly
 * speaks TSPL, and the driver makes the question irrelevant. The paper is the
 * turned sticker's footprint, so the driver is never asked to rotate anything
 * itself — the page it gets is already the shape the artwork fills.
 */
export const LABEL_PAGE_RULE =
  `@page { size: ${LABEL_PAGE_MM.width}mm ${LABEL_PAGE_MM.height}mm; margin: 0; }`;
