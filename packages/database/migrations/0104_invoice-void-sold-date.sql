DROP TRIGGER `erp_invoice_reversals_validate_insert`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_validate_insert`
BEFORE INSERT ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  DECLARE stored_sold_at TIMESTAMP(3) DEFAULT NULL;
  DECLARE cairo_sold_date DATE DEFAULT NULL;
  DECLARE cairo_created_date DATE DEFAULT NULL;
  DECLARE cairo_current_date DATE DEFAULT NULL;
  DECLARE sold_year INT DEFAULT NULL;
  DECLARE created_year INT DEFAULT NULL;
  DECLARE current_year INT DEFAULT NULL;
  DECLARE sold_dst_start DATETIME DEFAULT NULL;
  DECLARE sold_dst_end DATETIME DEFAULT NULL;
  DECLARE created_dst_start DATETIME DEFAULT NULL;
  DECLARE created_dst_end DATETIME DEFAULT NULL;
  DECLARE current_dst_start DATETIME DEFAULT NULL;
  DECLARE current_dst_end DATETIME DEFAULT NULL;
  SELECT invoice.status, invoice.sold_at INTO invoice_status, stored_sold_at
    FROM `erp_invoices` invoice
    WHERE invoice.id = NEW.invoice_id AND invoice.branch_id = NEW.branch_id FOR UPDATE;
  IF NEW.status <> 'pending' OR invoice_status IS NULL
    OR invoice_status IN ('draft', 'refunded', 'voided')
    OR (NEW.type = 'void' AND invoice_status <> 'completed') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice is not reversible';
  END IF;
  SET sold_year = YEAR(stored_sold_at + INTERVAL 2 HOUR);
  SET created_year = YEAR(NEW.created_at + INTERVAL 2 HOUR);
  SET current_year = YEAR(UTC_TIMESTAMP() + INTERVAL 2 HOUR);
  SET sold_dst_start = TIMESTAMP(DATE_SUB(
    LAST_DAY(MAKEDATE(sold_year, 1) + INTERVAL 3 MONTH),
    INTERVAL MOD(WEEKDAY(LAST_DAY(MAKEDATE(sold_year, 1) + INTERVAL 3 MONTH)) - 4 + 7, 7) DAY
  )) - INTERVAL 2 HOUR;
  SET sold_dst_end = TIMESTAMP(DATE_SUB(
    LAST_DAY(MAKEDATE(sold_year, 1) + INTERVAL 9 MONTH),
    INTERVAL MOD(WEEKDAY(LAST_DAY(MAKEDATE(sold_year, 1) + INTERVAL 9 MONTH)) - 4 + 7, 7) DAY
  )) - INTERVAL 3 HOUR;
  SET created_dst_start = TIMESTAMP(DATE_SUB(
    LAST_DAY(MAKEDATE(created_year, 1) + INTERVAL 3 MONTH),
    INTERVAL MOD(WEEKDAY(LAST_DAY(MAKEDATE(created_year, 1) + INTERVAL 3 MONTH)) - 4 + 7, 7) DAY
  )) - INTERVAL 2 HOUR;
  SET created_dst_end = TIMESTAMP(DATE_SUB(
    LAST_DAY(MAKEDATE(created_year, 1) + INTERVAL 9 MONTH),
    INTERVAL MOD(WEEKDAY(LAST_DAY(MAKEDATE(created_year, 1) + INTERVAL 9 MONTH)) - 4 + 7, 7) DAY
  )) - INTERVAL 3 HOUR;
  SET current_dst_start = TIMESTAMP(DATE_SUB(
    LAST_DAY(MAKEDATE(current_year, 1) + INTERVAL 3 MONTH),
    INTERVAL MOD(WEEKDAY(LAST_DAY(MAKEDATE(current_year, 1) + INTERVAL 3 MONTH)) - 4 + 7, 7) DAY
  )) - INTERVAL 2 HOUR;
  SET current_dst_end = TIMESTAMP(DATE_SUB(
    LAST_DAY(MAKEDATE(current_year, 1) + INTERVAL 9 MONTH),
    INTERVAL MOD(WEEKDAY(LAST_DAY(MAKEDATE(current_year, 1) + INTERVAL 9 MONTH)) - 4 + 7, 7) DAY
  )) - INTERVAL 3 HOUR;
  SET cairo_sold_date = DATE(stored_sold_at + INTERVAL IF(
    stored_sold_at >= sold_dst_start AND stored_sold_at < sold_dst_end, 3, 2
  ) HOUR);
  SET cairo_created_date = DATE(NEW.created_at + INTERVAL IF(
    NEW.created_at >= created_dst_start AND NEW.created_at < created_dst_end, 3, 2
  ) HOUR);
  SET cairo_current_date = DATE(UTC_TIMESTAMP() + INTERVAL IF(
    UTC_TIMESTAMP() >= current_dst_start AND UTC_TIMESTAMP() < current_dst_end, 3, 2
  ) HOUR);
  IF NEW.type = 'void' AND (
    cairo_sold_date IS NULL OR cairo_created_date IS NULL OR cairo_current_date IS NULL
    OR cairo_sold_date <> NEW.business_date
    OR NEW.business_date <> cairo_created_date
    OR NEW.business_date <> cairo_current_date
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Void business date is invalid';
  END IF;
END;
