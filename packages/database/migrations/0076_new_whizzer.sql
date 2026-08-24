CREATE TABLE `erp_invoice_line_reassignments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`invoice_line_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`from_employee_id` int NOT NULL,
	`to_employee_id` int NOT NULL,
	`reason` varchar(1000) NOT NULL,
	`operation_reference` varchar(36) NOT NULL,
	`acting_account_id` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_invoice_line_reassignments_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_line_reassignments_line_operation_unique` UNIQUE(`operation_reference`),
	CONSTRAINT `erp_invoice_line_reassignments_employee_changed` CHECK(`erp_invoice_line_reassignments`.`from_employee_id` <> `erp_invoice_line_reassignments`.`to_employee_id`),
	CONSTRAINT `erp_invoice_line_reassignments_reason_required` CHECK(CHAR_LENGTH(TRIM(`erp_invoice_line_reassignments`.`reason`)) > 0)
);
--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` DROP CONSTRAINT `erp_commission_ledger_entry_consistent`;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` DROP CONSTRAINT `erp_commission_ledger_amount_direction`;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` MODIFY COLUMN `entry_type` enum('earned','reversal','reassignment_out','reassignment_in') NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD `invoice_line_reassignment_id` int;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_id_invoice_branch_unique` UNIQUE(`id`,`invoice_id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_invoice_line_reassignments` ADD CONSTRAINT `erp_invoice_line_reassignments_line_invoice_branch_fk` FOREIGN KEY (`invoice_line_id`,`invoice_id`,`branch_id`) REFERENCES `erp_invoice_lines`(`id`,`invoice_id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_line_reassignments` ADD CONSTRAINT `erp_invoice_line_reassignments_from_employee_branch_fk` FOREIGN KEY (`from_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_line_reassignments` ADD CONSTRAINT `erp_invoice_line_reassignments_to_employee_branch_fk` FOREIGN KEY (`to_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_line_reassignments` ADD CONSTRAINT `erp_invoice_line_reassignments_acting_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_invoice_line_reassignments_line_created_idx` ON `erp_invoice_line_reassignments` (`invoice_line_id`,`created_at`,`id`);--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_entry_consistent` CHECK ((entry_type = 'earned' and reverses_entry_id is null and invoice_reversal_id is null and invoice_line_reassignment_id is null) or (entry_type = 'reversal' and reverses_entry_id is not null and invoice_reversal_id is not null and invoice_line_reassignment_id is null) or (entry_type in ('reassignment_out', 'reassignment_in') and reverses_entry_id is null and invoice_reversal_id is null and invoice_line_reassignment_id is not null));--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_amount_direction` CHECK (`erp_commission_ledger_entries`.`base_amount` > 0 and `erp_commission_ledger_entries`.`commission_rate_snapshot` between 0 and 100 and ((entry_type in ('earned', 'reassignment_in') and amount >= 0) or (entry_type in ('reversal', 'reassignment_out') and amount <= 0)));--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_line_reassignment_fk` FOREIGN KEY (`invoice_line_reassignment_id`) REFERENCES `erp_invoice_line_reassignments`(`id`) ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
DROP TRIGGER `erp_commission_ledger_validate_insert`;
--> statement-breakpoint
CREATE TRIGGER `erp_commission_ledger_validate_insert`
BEFORE INSERT ON `erp_commission_ledger_entries`
FOR EACH ROW
BEGIN
  DECLARE target_base DECIMAL(14,2) DEFAULT NULL;
  DECLARE target_amount DECIMAL(14,2) DEFAULT NULL;
  DECLARE reversed_base DECIMAL(14,2) DEFAULT 0.00;
  DECLARE locked_invoice_id INT DEFAULT NULL;
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;

  SELECT invoice.id, invoice.status INTO locked_invoice_id, invoice_status
    FROM `erp_invoices` invoice WHERE invoice.id = NEW.invoice_id FOR UPDATE;
  IF NEW.entry_type = 'earned' THEN
    IF invoice_status <> 'draft' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Earned commission requires a draft invoice';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM `erp_invoice_lines` line
      WHERE line.id = NEW.invoice_line_id AND line.invoice_id = NEW.invoice_id
        AND line.employee_id = NEW.employee_id AND line.item_type = 'service'
        AND line.commission_rule_snapshot = NEW.commission_rule_snapshot
        AND line.commission_rate_snapshot = NEW.commission_rate_snapshot
        AND line.line_total = NEW.base_amount AND line.commission_amount_snapshot = NEW.amount
    ) OR NEW.amount <> ROUND(NEW.base_amount * NEW.commission_rate_snapshot / 100, 2) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Earned commission does not match its service line';
    END IF;
  ELSEIF NEW.entry_type = 'reversal' THEN
    IF invoice_status = 'draft' OR NOT EXISTS (
      SELECT 1 FROM `erp_invoice_reversals` reversal
      WHERE reversal.id = NEW.invoice_reversal_id AND reversal.invoice_id = NEW.invoice_id
        AND reversal.status = 'pending' AND reversal.acting_account_id = NEW.acting_account_id
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal requires a pending invoice reversal';
    END IF;
    SELECT original.base_amount, original.amount INTO target_base, target_amount
      FROM `erp_commission_ledger_entries` original
      WHERE original.id = NEW.reverses_entry_id AND original.entry_type IN ('earned', 'reassignment_in')
        AND original.invoice_id = NEW.invoice_id AND original.invoice_line_id = NEW.invoice_line_id
        AND original.employee_id = NEW.employee_id
        AND original.commission_rule_snapshot = NEW.commission_rule_snapshot
        AND original.commission_rate_snapshot = NEW.commission_rate_snapshot;
    SELECT COALESCE(SUM(reversal_entry.base_amount), 0.00) INTO reversed_base
      FROM `erp_commission_ledger_entries` reversal_entry
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_entry.invoice_reversal_id
      WHERE reversal_entry.reverses_entry_id = NEW.reverses_entry_id
        AND reversal.status = 'finalized';
    IF target_base IS NULL OR NEW.base_amount > target_base
      OR target_amount <> ROUND(target_base * NEW.commission_rate_snapshot / 100, 2)
      OR -NEW.amount <> ROUND((reversed_base + NEW.base_amount) * NEW.commission_rate_snapshot / 100, 2)
        - ROUND(reversed_base * NEW.commission_rate_snapshot / 100, 2)
      OR reversed_base + NEW.base_amount > target_base THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal exceeds or mismatches the earned entry';
    END IF;
  ELSE
    IF invoice_status = 'draft' OR NOT EXISTS (
      SELECT 1
      FROM `erp_invoice_line_reassignments` reassignment
      JOIN `erp_invoice_lines` line ON line.id = reassignment.invoice_line_id
      WHERE reassignment.id = NEW.invoice_line_reassignment_id
        AND reassignment.invoice_id = NEW.invoice_id
        AND reassignment.invoice_line_id = NEW.invoice_line_id
        AND reassignment.acting_account_id = NEW.acting_account_id
        AND line.item_type = 'service'
        AND line.commission_rule_snapshot = NEW.commission_rule_snapshot
        AND line.commission_rate_snapshot = NEW.commission_rate_snapshot
        AND line.line_total = NEW.base_amount
        AND ABS(NEW.amount) = line.commission_amount_snapshot
        AND ((NEW.entry_type = 'reassignment_out' AND NEW.employee_id = reassignment.from_employee_id)
          OR (NEW.entry_type = 'reassignment_in' AND NEW.employee_id = reassignment.to_employee_id))
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reassignment does not match its service-line correction';
    END IF;
  END IF;
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
    JOIN `erp_invoice_payments` payment ON payment.id = reversal_payment.invoice_payment_id
      AND payment.invoice_id = NEW.invoice_id
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
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_line_reassignments_validate_insert`
BEFORE INSERT ON `erp_invoice_line_reassignments`
FOR EACH ROW
BEGIN
  DECLARE current_employee_id INT DEFAULT NULL;
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  DECLARE line_type VARCHAR(16) DEFAULT NULL;
  SELECT COALESCE((
      SELECT prior.to_employee_id
      FROM `erp_invoice_line_reassignments` prior
      WHERE prior.invoice_line_id = NEW.invoice_line_id
      ORDER BY prior.created_at DESC, prior.id DESC
      LIMIT 1
    ), line.employee_id), invoice.status, line.item_type
    INTO current_employee_id, invoice_status, line_type
    FROM `erp_invoice_lines` line
    JOIN `erp_invoices` invoice ON invoice.id = line.invoice_id
    WHERE line.id = NEW.invoice_line_id
      AND line.invoice_id = NEW.invoice_id
      AND line.branch_id = NEW.branch_id;
  IF invoice_status IS NULL OR invoice_status <> 'completed' OR line_type <> 'service' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only sold service lines can be reassigned';
  END IF;
  IF current_employee_id IS NULL OR current_employee_id <> NEW.from_employee_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reassignment source employee is not current';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_line_reassignments_reject_update`
BEFORE UPDATE ON `erp_invoice_line_reassignments`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice line reassignments are immutable';
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_line_reassignments_reject_delete`
BEFORE DELETE ON `erp_invoice_line_reassignments`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice line reassignments are immutable';
END;
