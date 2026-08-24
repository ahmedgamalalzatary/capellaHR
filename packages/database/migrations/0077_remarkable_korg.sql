ALTER TABLE `report_exports` MODIFY COLUMN `report_type` enum('branches','employees','devices','shifts','weekly-day-off','attendance','payroll','bonuses','deductions','advances','erp-sales','erp-payment-methods','erp-services','erp-products','erp-employees','erp-commissions','erp-discounts','erp-taxes','erp-refunds','erp-voids','erp-expenses','erp-purchases','erp-stock','erp-profit','erp-client-history','erp-receivables','erp-invoice') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `operation_reference` varchar(36);--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD `is_initial` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD `cash_amount` decimal(14,2);--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD `amount_paid` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD `credited_amount` decimal(14,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD `balance_due` decimal(14,2) GENERATED ALWAYS AS (total - credited_amount - amount_paid) STORED;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD `settlement_status` enum('settled','open') DEFAULT 'open' NOT NULL;--> statement-breakpoint
DROP TRIGGER `erp_invoice_payments_validate_update`;--> statement-breakpoint
UPDATE `erp_invoice_payments` SET `operation_reference` = UUID(), `is_initial` = true;--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_update`
BEFORE UPDATE ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  IF NEW.invoice_id <> OLD.invoice_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payment ownership is immutable';
  END IF;
  SELECT status INTO invoice_status FROM `erp_invoices`
    WHERE id = OLD.invoice_id FOR UPDATE;
  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice payments are immutable';
  END IF;
END;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` MODIFY COLUMN `operation_reference` varchar(36) NOT NULL;--> statement-breakpoint
DROP TRIGGER `erp_invoice_reversal_payments_reject_update`;--> statement-breakpoint
UPDATE `erp_invoice_reversal_payments` SET `cash_amount` = `amount`;--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversal_payments_reject_update`
BEFORE UPDATE ON `erp_invoice_reversal_payments`
FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal payment facts are immutable';--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` MODIFY COLUMN `cash_amount` decimal(14,2) NOT NULL;--> statement-breakpoint
DROP TRIGGER `erp_invoices_validate_lifecycle`;--> statement-breakpoint
UPDATE `erp_invoices` invoice SET invoice.amount_paid = invoice.total,
  invoice.credited_amount = 0.00, invoice.settlement_status = 'settled';--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_invoice_reference_unique` UNIQUE(`invoice_id`,`operation_reference`);--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` DROP INDEX `erp_invoice_payments_invoice_method_unique`;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments` ADD CONSTRAINT `erp_invoice_reversal_payments_cash_valid` CHECK (`erp_invoice_reversal_payments`.`cash_amount` >= 0 and `erp_invoice_reversal_payments`.`cash_amount` <= `erp_invoice_reversal_payments`.`amount`);--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_amount_paid_valid` CHECK (`erp_invoices`.`amount_paid` >= 0 and `erp_invoices`.`credited_amount` >= 0 and `erp_invoices`.`amount_paid` + `erp_invoices`.`credited_amount` <= `erp_invoices`.`total`);--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_settlement_status_consistent` CHECK ((`erp_invoices`.`settlement_status` = 'settled' and `erp_invoices`.`amount_paid` + `erp_invoices`.`credited_amount` = `erp_invoices`.`total`) or (`erp_invoices`.`settlement_status` = 'open' and `erp_invoices`.`amount_paid` + `erp_invoices`.`credited_amount` < `erp_invoices`.`total`));
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_lifecycle`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  DECLARE fully_reversed INT DEFAULT 0;
  DECLARE reversal_count INT DEFAULT 0;
  DECLARE void_count INT DEFAULT 0;
  DECLARE payment_total DECIMAL(14,2) DEFAULT 0.00;
  DECLARE service_count INT DEFAULT 0;
  SELECT COALESCE(SUM(amount), 0.00) INTO payment_total
    FROM `erp_invoice_payments` WHERE invoice_id = NEW.id;
  SELECT COUNT(*) INTO service_count FROM `erp_invoice_lines`
    WHERE invoice_id = NEW.id AND item_type = 'service';
  IF OLD.status = 'draft' THEN
    IF NEW.status NOT IN ('draft', 'completed') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice status transition is invalid';
    END IF;
    IF NEW.status = 'completed' THEN
      IF NOT EXISTS (SELECT 1 FROM `erp_invoice_lines` WHERE invoice_id = NEW.id)
        OR (SELECT COALESCE(SUM(line_total), 0.00) FROM `erp_invoice_lines`
          WHERE invoice_id = NEW.id) <> NEW.subtotal THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice lines must exactly cover the subtotal';
      END IF;
      IF payment_total <> NEW.amount_paid OR payment_total > NEW.total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payments do not match amount paid';
      END IF;
      IF service_count > 0 AND payment_total <> NEW.total THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Partial payment is not allowed with services';
      END IF;
      IF service_count <> (SELECT COUNT(*) FROM `erp_commission_ledger_entries`
          WHERE invoice_id = NEW.id AND entry_type = 'earned') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Every service line requires earned commission';
      END IF;
    END IF;
  ELSE
    IF NOT (NEW.branch_id <=> OLD.branch_id) OR NOT (NEW.client_id <=> OLD.client_id)
      OR NOT (NEW.acting_account_id <=> OLD.acting_account_id)
      OR NOT (NEW.cashier_session_id <=> OLD.cashier_session_id)
      OR NOT (NEW.invoice_number <=> OLD.invoice_number)
      OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
      OR NOT (NEW.client_name_snapshot <=> OLD.client_name_snapshot)
      OR NOT (NEW.client_phone_snapshot <=> OLD.client_phone_snapshot)
      OR NOT (NEW.seller_employee_id <=> OLD.seller_employee_id)
      OR NOT (NEW.seller_name_snapshot <=> OLD.seller_name_snapshot)
      OR NOT (NEW.authorized_by_snapshot <=> OLD.authorized_by_snapshot)
      OR NOT (NEW.subtotal <=> OLD.subtotal) OR NOT (NEW.discount_kind <=> OLD.discount_kind)
      OR NOT (NEW.discount_value <=> OLD.discount_value)
      OR NOT (NEW.discount_amount <=> OLD.discount_amount)
      OR NOT (NEW.tax_kind <=> OLD.tax_kind) OR NOT (NEW.tax_value <=> OLD.tax_value)
      OR NOT (NEW.tax_amount <=> OLD.tax_amount) OR NOT (NEW.total <=> OLD.total)
      OR NOT (NEW.sold_at <=> OLD.sold_at) OR NOT (NEW.created_at <=> OLD.created_at) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice facts are immutable';
    END IF;
    IF NEW.status = OLD.status THEN
      IF OLD.status NOT IN ('completed', 'partially_refunded') OR service_count > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice settlement update is invalid';
      END IF;
    ELSE
      IF OLD.status IN ('refunded', 'voided')
        OR NEW.status NOT IN ('partially_refunded', 'refunded', 'voided')
        OR (OLD.status = 'partially_refunded' AND NEW.status = 'voided') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice status transition is invalid';
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
  END IF;
END;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_payments_validate_insert`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_insert`
BEFORE INSERT ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  DECLARE invoice_balance DECIMAL(14,2) DEFAULT NULL;
  DECLARE invoice_has_service INT DEFAULT 0;
  SELECT status, balance_due INTO invoice_status, invoice_balance
    FROM `erp_invoices` WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM `erp_invoice_lines`
    WHERE invoice_id = NEW.invoice_id AND item_type = 'service') INTO invoice_has_service;
  IF invoice_status NOT IN ('draft', 'completed', 'partially_refunded') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice does not accept payments';
  END IF;
  IF (invoice_status = 'draft' AND NEW.is_initial <> true)
    OR (invoice_status <> 'draft' AND NEW.is_initial <> false) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payment stage is invalid';
  END IF;
  IF invoice_status <> 'draft' AND invoice_has_service = 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Partial payment is not allowed with services';
  END IF;
  IF invoice_status <> 'draft' AND NEW.amount > invoice_balance THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment exceeds invoice balance';
  END IF;
END;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_reversals_apply_finalize`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_apply_finalize`
AFTER UPDATE ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  DECLARE fully_reversed INT DEFAULT 0;
  DECLARE cash_payout DECIMAL(14,2) DEFAULT 0.00;
  SELECT COALESCE(SUM(cash_amount), 0.00) INTO cash_payout
    FROM `erp_invoice_reversal_payments` WHERE reversal_id = NEW.id;
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
  UPDATE `erp_invoices` SET
    settlement_status = CASE
      WHEN credited_amount + NEW.total + amount_paid - cash_payout = total THEN 'settled'
      ELSE 'open'
    END,
    credited_amount = credited_amount + NEW.total,
    amount_paid = amount_paid - cash_payout,
    status = CASE
      WHEN NEW.type = 'void' THEN 'voided'
      WHEN fully_reversed = 1 THEN 'refunded'
      ELSE 'partially_refunded'
    END
  WHERE id = NEW.invoice_id;
END;
--> statement-breakpoint
DROP TRIGGER `erp_invoice_reversals_validate_finalize`;--> statement-breakpoint
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
            AND earned.entry_type IN ('earned', 'reassignment_in')
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
      ON earned.id = ledger.reverses_entry_id AND earned.entry_type IN ('earned', 'reassignment_in')
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
