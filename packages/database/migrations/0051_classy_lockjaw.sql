CREATE TABLE `erp_invoice_reversal_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reversal_id` int NOT NULL,
	`invoice_id` int NOT NULL,
	`invoice_line_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`quantity` int NOT NULL,
	`gross_amount` decimal(14,2) NOT NULL,
	`discount_amount` decimal(14,2) NOT NULL,
	`tax_amount` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	CONSTRAINT `erp_invoice_reversal_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_reversal_lines_reversal_line_unique` UNIQUE(`reversal_id`,`invoice_line_id`),
	CONSTRAINT `erp_invoice_reversal_lines_amounts_consistent` CHECK(`erp_invoice_reversal_lines`.`quantity` > 0 and `erp_invoice_reversal_lines`.`gross_amount` > 0 and `erp_invoice_reversal_lines`.`discount_amount` >= 0 and `erp_invoice_reversal_lines`.`tax_amount` >= 0 and `erp_invoice_reversal_lines`.`total` = `erp_invoice_reversal_lines`.`gross_amount` - `erp_invoice_reversal_lines`.`discount_amount` + `erp_invoice_reversal_lines`.`tax_amount` and `erp_invoice_reversal_lines`.`total` >= 0)
);
--> statement-breakpoint
CREATE TABLE `erp_invoice_reversal_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reversal_id` int NOT NULL,
	`invoice_payment_id` int NOT NULL,
	`method_snapshot` enum('cash','visa','instapay','vodafone_cash') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	CONSTRAINT `erp_invoice_reversal_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_reversal_payments_method_unique` UNIQUE(`reversal_id`,`method_snapshot`),
	CONSTRAINT `erp_invoice_reversal_payments_amount_positive` CHECK(`erp_invoice_reversal_payments`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `erp_invoice_reversals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`type` enum('void','refund') NOT NULL,
	`status` enum('pending','finalized') NOT NULL DEFAULT 'pending',
	`idempotency_key` varchar(36) NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`acting_account_id` int NOT NULL,
	`approving_account_id` int,
	`gross_amount` decimal(14,2) NOT NULL,
	`discount_amount` decimal(14,2) NOT NULL,
	`tax_amount` decimal(14,2) NOT NULL,
	`total` decimal(14,2) NOT NULL,
	`business_date` date NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_invoice_reversals_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_reversals_idempotency_unique` UNIQUE(`idempotency_key`),
	CONSTRAINT `erp_invoice_reversals_reason_required` CHECK(CHAR_LENGTH(TRIM(`erp_invoice_reversals`.`reason`)) > 0),
	CONSTRAINT `erp_invoice_reversals_amounts_consistent` CHECK(`erp_invoice_reversals`.`gross_amount` > 0 and `erp_invoice_reversals`.`discount_amount` >= 0 and `erp_invoice_reversals`.`tax_amount` >= 0 and `erp_invoice_reversals`.`total` = `erp_invoice_reversals`.`gross_amount` - `erp_invoice_reversals`.`discount_amount` + `erp_invoice_reversals`.`tax_amount` and `erp_invoice_reversals`.`total` >= 0)
);
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_lines` ADD CONSTRAINT `erp_reversal_lines_reversal_fk` FOREIGN KEY (`reversal_id`) REFERENCES `erp_invoice_reversals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_lines` ADD CONSTRAINT `erp_reversal_lines_invoice_fk` FOREIGN KEY (`invoice_id`) REFERENCES `erp_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_lines` ADD CONSTRAINT `erp_reversal_lines_line_fk` FOREIGN KEY (`invoice_line_id`) REFERENCES `erp_invoice_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_lines` ADD CONSTRAINT `erp_reversal_lines_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD CONSTRAINT `erp_reversal_payments_reversal_fk` FOREIGN KEY (`reversal_id`) REFERENCES `erp_invoice_reversals`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD CONSTRAINT `erp_reversal_payments_payment_fk` FOREIGN KEY (`invoice_payment_id`) REFERENCES `erp_invoice_payments`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_invoice_branch_fk` FOREIGN KEY (`invoice_id`,`branch_id`) REFERENCES `erp_invoices`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_acting_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_approving_account_fk` FOREIGN KEY (`approving_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_invoice_reversals_invoice_created_idx` ON `erp_invoice_reversals` (`invoice_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_validate_insert`
BEFORE INSERT ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  DECLARE stored_invoice_number VARCHAR(64) DEFAULT NULL;
  DECLARE cairo_created_date DATE DEFAULT NULL;
  DECLARE cairo_current_date DATE DEFAULT NULL;
  DECLARE created_year INT DEFAULT NULL;
  DECLARE current_year INT DEFAULT NULL;
  DECLARE created_dst_start DATETIME DEFAULT NULL;
  DECLARE created_dst_end DATETIME DEFAULT NULL;
  DECLARE current_dst_start DATETIME DEFAULT NULL;
  DECLARE current_dst_end DATETIME DEFAULT NULL;
  SELECT invoice.status, invoice.invoice_number INTO invoice_status, stored_invoice_number
    FROM `erp_invoices` invoice
    WHERE invoice.id = NEW.invoice_id AND invoice.branch_id = NEW.branch_id FOR UPDATE;
  IF NEW.status <> 'pending' OR invoice_status IS NULL
    OR invoice_status IN ('draft', 'refunded', 'voided')
    OR (NEW.type = 'void' AND invoice_status <> 'completed') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice is not reversible';
  END IF;
  SET created_year = YEAR(NEW.created_at + INTERVAL 2 HOUR);
  SET current_year = YEAR(UTC_TIMESTAMP() + INTERVAL 2 HOUR);
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
  SET cairo_created_date = DATE(NEW.created_at + INTERVAL IF(
    NEW.created_at >= created_dst_start AND NEW.created_at < created_dst_end, 3, 2
  ) HOUR);
  SET cairo_current_date = DATE(UTC_TIMESTAMP() + INTERVAL IF(
    UTC_TIMESTAMP() >= current_dst_start AND UTC_TIMESTAMP() < current_dst_end, 3, 2
  ) HOUR);
  IF NEW.type = 'void' AND (
    cairo_created_date IS NULL OR cairo_current_date IS NULL
    OR REPLACE(SUBSTRING(stored_invoice_number, 5, 10), '.', '-') <> NEW.business_date
    OR NEW.business_date <> cairo_created_date
    OR NEW.business_date <> cairo_current_date
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Void business date is invalid';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_validate_finalize`
BEFORE UPDATE ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  IF OLD.status <> 'pending' OR NEW.status <> 'finalized'
    OR NOT (NEW.invoice_id <=> OLD.invoice_id)
    OR NOT (NEW.branch_id <=> OLD.branch_id)
    OR NOT (NEW.type <=> OLD.type)
    OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
    OR NOT (NEW.reason <=> OLD.reason)
    OR NOT (NEW.acting_account_id <=> OLD.acting_account_id)
    OR NOT (NEW.approving_account_id <=> OLD.approving_account_id)
    OR NOT (NEW.gross_amount <=> OLD.gross_amount)
    OR NOT (NEW.discount_amount <=> OLD.discount_amount)
    OR NOT (NEW.tax_amount <=> OLD.tax_amount)
    OR NOT (NEW.total <=> OLD.total)
    OR NOT (NEW.business_date <=> OLD.business_date)
    OR NOT (NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal facts are immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id)
    OR (SELECT COALESCE(SUM(gross_amount), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.gross_amount
    OR (SELECT COALESCE(SUM(discount_amount), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.discount_amount
    OR (SELECT COALESCE(SUM(tax_amount), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.tax_amount
    OR (SELECT COALESCE(SUM(total), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal totals are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT reversal_line.gross_amount, reversal_line.discount_amount,
        reversal_line.tax_amount, reversal_line.total, reversal_line.quantity,
        original_line.unit_price, original_line.quantity original_quantity,
        COALESCE(prior.quantity, 0) prior_quantity,
        ROUND(invoice.discount_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number <= original_line.line_number
        ) / invoice.subtotal, 2) - ROUND(invoice.discount_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number < original_line.line_number
        ) / invoice.subtotal, 2) allocated_discount,
        ROUND(invoice.tax_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number <= original_line.line_number
        ) / invoice.subtotal, 2) - ROUND(invoice.tax_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number < original_line.line_number
        ) / invoice.subtotal, 2) allocated_tax
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_lines` original_line ON original_line.id = reversal_line.invoice_line_id
      JOIN `erp_invoices` invoice ON invoice.id = original_line.invoice_id
      LEFT JOIN (
        SELECT prior_line.invoice_line_id, SUM(prior_line.quantity) quantity
        FROM `erp_invoice_reversal_lines` prior_line
        JOIN `erp_invoice_reversals` prior_reversal ON prior_reversal.id = prior_line.reversal_id
        WHERE prior_reversal.status = 'finalized'
        GROUP BY prior_line.invoice_line_id
      ) prior ON prior.invoice_line_id = original_line.id
      WHERE reversal_line.reversal_id = NEW.id
    ) allocation
    WHERE allocation.gross_amount <> allocation.unit_price * allocation.quantity
      OR allocation.discount_amount <> ROUND(
        allocation.allocated_discount * (allocation.prior_quantity + allocation.quantity)
          / allocation.original_quantity, 2
      ) - ROUND(
        allocation.allocated_discount * allocation.prior_quantity / allocation.original_quantity, 2
      )
      OR allocation.tax_amount <> ROUND(
        allocation.allocated_tax * (allocation.prior_quantity + allocation.quantity)
          / allocation.original_quantity, 2
      ) - ROUND(
        allocation.allocated_tax * allocation.prior_quantity / allocation.original_quantity, 2
      )
      OR allocation.total <> allocation.gross_amount
        - allocation.discount_amount + allocation.tax_amount
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal line allocation is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM `erp_invoice_lines` original_line
    LEFT JOIN (
      SELECT reversal_line.invoice_line_id, SUM(reversal_line.quantity) quantity
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id
        AND (reversal.status = 'finalized' OR reversal.id = NEW.id)
      GROUP BY reversal_line.invoice_line_id
    ) reversed ON reversed.invoice_line_id = original_line.id
    WHERE original_line.invoice_id = NEW.invoice_id
      AND COALESCE(reversed.quantity, 0) > original_line.quantity
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice refunded quantities are inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM `erp_invoice_payments` original_payment
    LEFT JOIN (
      SELECT reversal_payment.invoice_payment_id, SUM(reversal_payment.amount) amount
      FROM `erp_invoice_reversal_payments` reversal_payment
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_payment.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id
        AND (reversal.status = 'finalized' OR reversal.id = NEW.id)
      GROUP BY reversal_payment.invoice_payment_id
    ) reversed ON reversed.invoice_payment_id = original_payment.id
    WHERE original_payment.invoice_id = NEW.invoice_id
      AND COALESCE(reversed.amount, 0.00) > original_payment.amount
  ) OR (SELECT COALESCE(SUM(amount), 0.00) FROM `erp_invoice_reversal_payments`
    WHERE reversal_id = NEW.id) <> NEW.total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversed payments are inconsistent';
  END IF;
  IF EXISTS (
    SELECT original_line.product_id
    FROM `erp_invoice_reversal_lines` reversal_line
    JOIN `erp_invoice_lines` original_line ON original_line.id = reversal_line.invoice_line_id
    WHERE reversal_line.reversal_id = NEW.id AND original_line.item_type = 'product'
    GROUP BY original_line.product_id
    HAVING COALESCE((
      SELECT SUM(movement.quantity_delta) FROM `erp_stock_movements` movement
      WHERE movement.source_id = NEW.id
        AND movement.source_type = NEW.type
        AND movement.reason = NEW.type
        AND movement.product_id = original_line.product_id
        AND movement.branch_id = NEW.branch_id
    ), 0) <> SUM(reversal_line.quantity)
      OR EXISTS (
        SELECT 1 FROM `erp_stock_movements` movement
        WHERE movement.source_id = NEW.id AND movement.source_type = NEW.type
          AND movement.reason = NEW.type AND movement.product_id = original_line.product_id
          AND movement.branch_id = NEW.branch_id
          AND movement.acting_account_id <> NEW.acting_account_id
      )
      OR (SELECT stock.quantity FROM `erp_product_stocks` stock
        WHERE stock.product_id = original_line.product_id AND stock.branch_id = NEW.branch_id)
        <> (SELECT movement.balance_after FROM `erp_stock_movements` movement
          WHERE movement.source_id = NEW.id AND movement.source_type = NEW.type
            AND movement.reason = NEW.type AND movement.product_id = original_line.product_id
            AND movement.branch_id = NEW.branch_id
          ORDER BY movement.id DESC LIMIT 1)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal stock restoration is incomplete';
  END IF;
  IF EXISTS (
    SELECT original_line.id
    FROM `erp_invoice_lines` original_line
    LEFT JOIN (
      SELECT reversal_line.invoice_line_id, SUM(reversal_line.quantity) quantity
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id
        AND (reversal.status = 'finalized' OR reversal.id = NEW.id)
      GROUP BY reversal_line.invoice_line_id
    ) reversed ON reversed.invoice_line_id = original_line.id
    WHERE original_line.invoice_id = NEW.invoice_id AND original_line.item_type = 'service'
      AND COALESCE((
        SELECT SUM(ledger.base_amount) FROM `erp_commission_ledger_entries` ledger
        JOIN `erp_invoice_reversals` ledger_reversal
          ON ledger_reversal.id = ledger.invoice_reversal_id
        WHERE ledger.invoice_line_id = original_line.id AND ledger.entry_type = 'reversal'
          AND (ledger_reversal.status = 'finalized' OR ledger_reversal.id = NEW.id)
      ), 0.00) <> original_line.unit_price * COALESCE(reversed.quantity, 0)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal commission facts are incomplete';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_apply_finalize`
AFTER UPDATE ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  DECLARE fully_reversed INT DEFAULT 0;
  SELECT NOT EXISTS (
    SELECT 1 FROM `erp_invoice_lines` original_line
    LEFT JOIN (
      SELECT reversal_line.invoice_line_id, SUM(reversal_line.quantity) quantity
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id AND reversal.status = 'finalized'
      GROUP BY reversal_line.invoice_line_id
    ) reversed ON reversed.invoice_line_id = original_line.id
    WHERE original_line.invoice_id = NEW.invoice_id
      AND COALESCE(reversed.quantity, 0) <> original_line.quantity
  ) INTO fully_reversed;
  UPDATE `erp_invoices` SET status = CASE
    WHEN NEW.type = 'void' THEN 'voided'
    WHEN fully_reversed = 1 THEN 'refunded'
    ELSE 'partially_refunded'
  END WHERE id = NEW.invoice_id;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_reject_delete`
BEFORE DELETE ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  IF OLD.status = 'finalized' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal facts are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_lines_validate_insert`
BEFORE INSERT ON `erp_invoice_reversal_lines`
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM `erp_invoice_reversals` reversal
    JOIN `erp_invoice_lines` original_line ON original_line.id = NEW.invoice_line_id
    WHERE reversal.id = NEW.reversal_id AND reversal.status = 'pending'
      AND reversal.invoice_id = NEW.invoice_id AND reversal.branch_id = NEW.branch_id
      AND original_line.invoice_id = NEW.invoice_id AND original_line.branch_id = NEW.branch_id
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal line ownership is invalid';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_lines_reject_update`
BEFORE UPDATE ON `erp_invoice_reversal_lines`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal line facts are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_lines_reject_delete`
BEFORE DELETE ON `erp_invoice_reversal_lines`
FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM `erp_invoice_reversals` WHERE id = OLD.reversal_id AND status = 'finalized') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal line facts are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_payments_validate_insert`
BEFORE INSERT ON `erp_invoice_reversal_payments`
FOR EACH ROW
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM `erp_invoice_reversals` reversal
    JOIN `erp_invoice_payments` original_payment
      ON original_payment.id = NEW.invoice_payment_id
      AND original_payment.invoice_id = reversal.invoice_id
      AND original_payment.method = NEW.method_snapshot
    WHERE reversal.id = NEW.reversal_id AND reversal.status = 'pending'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal payment ownership is invalid';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_payments_reject_update`
BEFORE UPDATE ON `erp_invoice_reversal_payments`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal payment facts are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_payments_reject_delete`
BEFORE DELETE ON `erp_invoice_reversal_payments`
FOR EACH ROW
BEGIN
  IF EXISTS (SELECT 1 FROM `erp_invoice_reversals` WHERE id = OLD.reversal_id AND status = 'finalized') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal payment facts are immutable';
  END IF;
END;
--> statement-breakpoint
DROP TRIGGER `erp_invoices_validate_completion`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_lifecycle`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  DECLARE fully_reversed INT DEFAULT 0;
  DECLARE reversal_count INT DEFAULT 0;
  DECLARE void_count INT DEFAULT 0;
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'completed') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice status transition is invalid';
    END IF;
    IF NEW.status = 'completed' THEN
      IF NOT EXISTS (SELECT 1 FROM `erp_invoice_lines` WHERE invoice_id = NEW.id)
        OR (SELECT COALESCE(SUM(line_total), 0.00) FROM `erp_invoice_lines` WHERE invoice_id = NEW.id) <> NEW.subtotal THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice lines must exactly cover the subtotal';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM `erp_invoice_payments` WHERE invoice_id = NEW.id)
        OR (SELECT COALESCE(SUM(amount), 0.00) FROM `erp_invoice_payments` WHERE invoice_id = NEW.id) <> NEW.total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payments must exactly cover the total';
      END IF;
      IF (SELECT COUNT(*) FROM `erp_invoice_lines` WHERE invoice_id = NEW.id AND item_type = 'service')
        <> (SELECT COUNT(*) FROM `erp_commission_ledger_entries` WHERE invoice_id = NEW.id AND entry_type = 'earned') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Every service line requires earned commission';
      END IF;
    END IF;
  ELSE
    IF OLD.status IN ('refunded', 'voided')
      OR NEW.status NOT IN ('partially_refunded', 'refunded', 'voided')
      OR (OLD.status = 'partially_refunded' AND NEW.status = 'voided') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice status transition is invalid';
    END IF;
    IF NOT (NEW.branch_id <=> OLD.branch_id) OR NOT (NEW.client_id <=> OLD.client_id)
      OR NOT (NEW.assigned_employee_id <=> OLD.assigned_employee_id)
      OR NOT (NEW.acting_account_id <=> OLD.acting_account_id)
      OR NOT (NEW.cashier_session_id <=> OLD.cashier_session_id)
      OR NOT (NEW.invoice_number <=> OLD.invoice_number)
      OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
      OR NOT (NEW.client_name_snapshot <=> OLD.client_name_snapshot)
      OR NOT (NEW.client_phone_snapshot <=> OLD.client_phone_snapshot)
      OR NOT (NEW.employee_name_snapshot <=> OLD.employee_name_snapshot)
      OR NOT (NEW.employee_code_snapshot <=> OLD.employee_code_snapshot)
      OR NOT (NEW.authorized_by_snapshot <=> OLD.authorized_by_snapshot)
      OR NOT (NEW.subtotal <=> OLD.subtotal)
      OR NOT (NEW.discount_kind <=> OLD.discount_kind)
      OR NOT (NEW.discount_value <=> OLD.discount_value)
      OR NOT (NEW.discount_amount <=> OLD.discount_amount)
      OR NOT (NEW.tax_kind <=> OLD.tax_kind) OR NOT (NEW.tax_value <=> OLD.tax_value)
      OR NOT (NEW.tax_amount <=> OLD.tax_amount) OR NOT (NEW.total <=> OLD.total)
      OR NOT (NEW.sold_at <=> OLD.sold_at) OR NOT (NEW.created_at <=> OLD.created_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice facts are immutable';
    END IF;
    SELECT COUNT(*), COALESCE(SUM(type = 'void'), 0) INTO reversal_count, void_count
      FROM `erp_invoice_reversals` WHERE invoice_id = NEW.id AND status = 'finalized';
    SELECT NOT EXISTS (
      SELECT 1 FROM `erp_invoice_lines` original_line
      LEFT JOIN (
        SELECT reversal_line.invoice_line_id, SUM(reversal_line.quantity) quantity
        FROM `erp_invoice_reversal_lines` reversal_line
        JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
        WHERE reversal.invoice_id = NEW.id AND reversal.status = 'finalized'
        GROUP BY reversal_line.invoice_line_id
      ) reversed ON reversed.invoice_line_id = original_line.id
      WHERE original_line.invoice_id = NEW.id
        AND COALESCE(reversed.quantity, 0) <> original_line.quantity
    ) INTO fully_reversed;
    IF reversal_count = 0
      OR (NEW.status = 'partially_refunded' AND (fully_reversed = 1 OR void_count <> 0))
      OR (NEW.status = 'refunded' AND (fully_reversed = 0 OR void_count <> 0))
      OR (NEW.status = 'voided' AND (fully_reversed = 0 OR reversal_count <> 1 OR void_count <> 1)) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal status is inconsistent';
    END IF;
  END IF;
END;
