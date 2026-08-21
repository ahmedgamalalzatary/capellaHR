-- Attributes every payment and reversal to the shift that handled the money.
--
-- The two backfills below each update a table whose own guard triggers refuse the
-- write: a completed invoice's payments are immutable, and a reversal may only be
-- updated to finalize it. Both guards are therefore dropped for the length of the
-- backfill and recreated verbatim afterwards. Without this the migration dies on
-- the first statement that touches an existing row, which no empty database and no
-- test fixture ever reaches.
ALTER TABLE `erp_invoice_payments` ADD `cashier_session_id` int;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `acting_account_id` int;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `paid_at` timestamp(3) NULL;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_payments_validate_update`;
--> statement-breakpoint
UPDATE `erp_invoice_payments` `p`
  JOIN `erp_invoices` `i` ON `i`.`id` = `p`.`invoice_id`
  SET `p`.`cashier_session_id` = `i`.`cashier_session_id`,
      `p`.`acting_account_id` = `i`.`acting_account_id`,
      `p`.`paid_at` = `p`.`created_at`
  WHERE `p`.`cashier_session_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_update`
BEFORE UPDATE ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;

  IF NEW.invoice_id <> OLD.invoice_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payment ownership is immutable';
  END IF;

  SELECT status
    INTO invoice_status
    FROM `erp_invoices`
    WHERE id = OLD.invoice_id
    FOR UPDATE;

  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice payments are immutable';
  END IF;
END;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `cashier_session_id` int NOT NULL;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `acting_account_id` int NOT NULL;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `paid_at` timestamp(3) NOT NULL;
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD `cashier_session_id` int;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_reversals_validate_commission_link`;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_reversals_validate_finalize`;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_reversals_apply_finalize`;
--> statement-breakpoint
UPDATE `erp_invoice_reversals` `r`
  JOIN `erp_invoices` `i` ON `i`.`id` = `r`.`invoice_id`
  SET `r`.`cashier_session_id` = `i`.`cashier_session_id`
  WHERE `r`.`cashier_session_id` IS NULL;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_validate_commission_link`
BEFORE UPDATE ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  IF NEW.status = 'finalized' AND EXISTS (
    SELECT original_line.id
    FROM `erp_invoice_reversal_lines` reversal_line
    JOIN `erp_invoice_lines` original_line ON original_line.id = reversal_line.invoice_line_id
    WHERE reversal_line.reversal_id = NEW.id AND original_line.item_type = 'service'
    GROUP BY original_line.id, original_line.unit_price
    HAVING COALESCE((
      SELECT SUM(ledger.base_amount) FROM `erp_commission_ledger_entries` ledger
      WHERE ledger.invoice_reversal_id = NEW.id AND ledger.invoice_line_id = original_line.id
        AND ledger.entry_type = 'reversal'
    ), 0.00) <> original_line.unit_price * SUM(reversal_line.quantity)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal commission link is incomplete';
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
    OR EXISTS (
      SELECT 1 FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_lines` original_line ON original_line.id = reversal_line.invoice_line_id
      WHERE reversal_line.reversal_id = NEW.id
        AND (reversal_line.invoice_id <> NEW.invoice_id
          OR reversal_line.branch_id <> NEW.branch_id
          OR original_line.invoice_id <> NEW.invoice_id
          OR original_line.branch_id <> NEW.branch_id)
    )
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
        AND original_line.invoice_id = NEW.invoice_id
        AND original_line.branch_id = NEW.branch_id
      JOIN `erp_invoices` invoice ON invoice.id = original_line.invoice_id
        AND invoice.id = NEW.invoice_id
        AND invoice.branch_id = NEW.branch_id
      LEFT JOIN (
        SELECT prior_line.invoice_line_id, SUM(prior_line.quantity) quantity
        FROM `erp_invoice_reversal_lines` prior_line
        JOIN `erp_invoice_reversals` prior_reversal ON prior_reversal.id = prior_line.reversal_id
        WHERE prior_reversal.status = 'finalized'
          AND prior_reversal.invoice_id = NEW.invoice_id
        GROUP BY prior_line.invoice_line_id
      ) prior ON prior.invoice_line_id = original_line.id
      WHERE reversal_line.reversal_id = NEW.id
        AND reversal_line.invoice_id = NEW.invoice_id
        AND reversal_line.branch_id = NEW.branch_id
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
    SELECT 1 FROM `erp_invoice_reversal_payments` reversal_payment
    JOIN `erp_invoice_payments` payment ON payment.id = reversal_payment.invoice_payment_id
    WHERE reversal_payment.reversal_id = NEW.id
      AND payment.invoice_id <> NEW.invoice_id
  ) OR EXISTS (
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
  ) OR (SELECT COALESCE(SUM(reversal_payment.amount), 0.00)
    FROM `erp_invoice_reversal_payments` reversal_payment
    WHERE reversal_payment.reversal_id = NEW.id) <> NEW.total THEN
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
      OR NOT EXISTS (SELECT 1 FROM `erp_product_stocks` stock
        WHERE stock.product_id = original_line.product_id AND stock.branch_id = NEW.branch_id)
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
      AND (
        COALESCE((
          SELECT SUM(ledger.base_amount) FROM `erp_commission_ledger_entries` ledger
          JOIN `erp_commission_ledger_entries` earned ON earned.id = ledger.reverses_entry_id
            AND earned.entry_type = 'earned'
          JOIN `erp_invoice_reversal_lines` commission_line
            ON ledger.invoice_reversal_id = commission_line.reversal_id
            AND ledger.invoice_line_id = commission_line.invoice_line_id
          JOIN `erp_invoice_reversals` ledger_reversal
            ON ledger_reversal.id = ledger.invoice_reversal_id
          LEFT JOIN (
            SELECT prior.reverses_entry_id, SUM(prior.base_amount) base_amount
            FROM `erp_commission_ledger_entries` prior
            JOIN `erp_invoice_reversals` prior_reversal
              ON prior_reversal.id = prior.invoice_reversal_id
            WHERE prior.entry_type = 'reversal' AND prior_reversal.status = 'finalized'
            GROUP BY prior.reverses_entry_id
          ) prior ON prior.reverses_entry_id = ledger.reverses_entry_id
          WHERE ledger.invoice_line_id = original_line.id AND ledger.entry_type = 'reversal'
            AND ledger.invoice_id = NEW.invoice_id
            AND ledger.invoice_id = earned.invoice_id
            AND ledger.invoice_line_id = earned.invoice_line_id
            AND ledger.employee_id = earned.employee_id
            AND ledger.commission_rule_snapshot = earned.commission_rule_snapshot
            AND ledger.commission_rate_snapshot = earned.commission_rate_snapshot
            AND commission_line.invoice_id = NEW.invoice_id
            AND commission_line.branch_id = NEW.branch_id
            AND ledger.base_amount = original_line.unit_price * commission_line.quantity
            AND (ledger_reversal.status = 'finalized' OR -ledger.amount = ROUND(
              (COALESCE(prior.base_amount, 0.00) + ledger.base_amount)
                * earned.commission_rate_snapshot / 100, 2
            ) - ROUND(
              COALESCE(prior.base_amount, 0.00) * earned.commission_rate_snapshot / 100, 2
            ))
            AND (ledger_reversal.status = 'finalized' OR ledger_reversal.id = NEW.id)
        ), 0.00) <> original_line.unit_price * COALESCE(reversed.quantity, 0)
      )
  ) OR EXISTS (
    SELECT 1 FROM `erp_commission_ledger_entries` ledger
    LEFT JOIN `erp_commission_ledger_entries` earned
      ON earned.id = ledger.reverses_entry_id AND earned.entry_type = 'earned'
    LEFT JOIN `erp_invoice_reversal_lines` commission_line
      ON ledger.invoice_reversal_id = commission_line.reversal_id
      AND ledger.invoice_line_id = commission_line.invoice_line_id
    LEFT JOIN `erp_invoice_lines` commission_original_line
      ON commission_original_line.id = ledger.invoice_line_id
    LEFT JOIN (
      SELECT prior.reverses_entry_id, SUM(prior.base_amount) base_amount
      FROM `erp_commission_ledger_entries` prior
      JOIN `erp_invoice_reversals` prior_reversal
        ON prior_reversal.id = prior.invoice_reversal_id
      WHERE prior.entry_type = 'reversal' AND prior_reversal.status = 'finalized'
      GROUP BY prior.reverses_entry_id
    ) prior ON prior.reverses_entry_id = ledger.reverses_entry_id
    WHERE ledger.invoice_reversal_id = NEW.id AND ledger.entry_type = 'reversal'
      AND (earned.id IS NULL
        OR commission_line.id IS NULL
        OR commission_original_line.id IS NULL
        OR ledger.invoice_id <> NEW.invoice_id
        OR ledger.invoice_id <> earned.invoice_id
        OR ledger.invoice_line_id <> earned.invoice_line_id
        OR ledger.employee_id <> earned.employee_id
        OR ledger.commission_rule_snapshot <> earned.commission_rule_snapshot
        OR ledger.commission_rate_snapshot <> earned.commission_rate_snapshot
        OR commission_line.invoice_id <> NEW.invoice_id
        OR commission_line.branch_id <> NEW.branch_id
        OR commission_original_line.invoice_id <> NEW.invoice_id
        OR commission_original_line.branch_id <> NEW.branch_id
        OR ledger.base_amount <> commission_original_line.unit_price * commission_line.quantity
        OR -ledger.amount <> ROUND(
          (COALESCE(prior.base_amount, 0.00) + ledger.base_amount)
            * earned.commission_rate_snapshot / 100, 2
        ) - ROUND(
          COALESCE(prior.base_amount, 0.00) * earned.commission_rate_snapshot / 100, 2
        ))
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
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_session_fk` FOREIGN KEY (`cashier_session_id`) REFERENCES `erp_cashier_sessions`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `erp_invoice_reversals` ADD CONSTRAINT `erp_invoice_reversals_session_fk` FOREIGN KEY (`cashier_session_id`) REFERENCES `erp_cashier_sessions`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `erp_invoice_payments_session_paid_idx` ON `erp_invoice_payments` (`cashier_session_id`,`paid_at`);
--> statement-breakpoint
CREATE INDEX `erp_invoice_reversals_session_created_idx` ON `erp_invoice_reversals` (`cashier_session_id`,`created_at`);
