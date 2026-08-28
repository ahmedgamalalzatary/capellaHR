/**
 * The counter's three machines, read off their own labels.
 *
 * Everything printed goes through the Windows driver and the browser's print
 * dialog: no raw bytes, no local agent. Both printers speak ESC/POS and both
 * carry a cash-drawer port, but a browser cannot address either, so the drawer
 * stays manual — see docs/erp-next-features-plan.md §2.
 */

/** Xprinter XP-T80Q — the receipt printer. 80 mm roll, 200 mm/s, USB + Ethernet. */
export const RECEIPT_PRINTER = {
  model: 'XP-T80Q',
  paperWidthMm: 80,
} as const;

/** Xprinter XP-233B — the sticker printer. 20–60 mm roll, 127 mm/s, USB. */
export const LABEL_PRINTER = {
  model: 'XP-233B',
  paperWidthMm: { min: 20, max: 60 },
} as const;

/** Datalogic QuickScan Lite QW2100 — 1D only, USB keyboard wedge, CR suffix. */
export const BARCODE_SCANNER = {
  model: 'QW2100',
  symbologies: ['ean13', 'code128'],
} as const;

/** Kept for consumers that need the nominal printable receipt width. */
export const RECEIPT_CONTENT_WIDTH_MM = 72;

/**
 * Without this the receipt inherits the app's `size: auto` rule and the paper is
 * whatever the driver last defaulted to — an A4 sheet with a thin slip on it if
 * the wrong printer is picked. `auto` height keeps the roll continuous: the slip
 * is as long as the sale, never padded to a page.
 */
export const RECEIPT_PAGE_RULE =
  `@page { size: ${RECEIPT_PRINTER.paperWidthMm}mm auto; margin: 0; }`;

/** A sticker the XP-233B cannot feed prints skewed or jams the roll. */
export const labelFitsRoll = ({ width }: { width: number; height: number }) =>
  width >= LABEL_PRINTER.paperWidthMm.min && width <= LABEL_PRINTER.paperWidthMm.max;
