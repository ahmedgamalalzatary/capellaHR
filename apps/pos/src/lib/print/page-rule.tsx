'use client';

/**
 * A `@page` rule that applies only while the document holding it is mounted.
 *
 * `@page` is global and cannot be scoped by class, so every printable document
 * carries the paper it belongs on: the receipt roll, the sticker roll, or the A4
 * default in globals.css. Without this the browser prints whatever the driver
 * last defaulted to.
 */
export function PrintPageRule({ rule }: { rule: string }) {
  return <style>{`@media print { ${rule} }`}</style>;
}
