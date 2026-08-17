DROP TRIGGER `erp_invoice_lines_validate_update`;
--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD `employee_id` int;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD `employee_name_snapshot` varchar(255);--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD `employee_code_snapshot` int;--> statement-breakpoint
UPDATE `erp_invoice_lines` `line`
INNER JOIN `erp_invoices` `invoice` ON `invoice`.`id` = `line`.`invoice_id`
SET `line`.`employee_id` = `invoice`.`assigned_employee_id`,
  `line`.`employee_name_snapshot` = `invoice`.`employee_name_snapshot`,
  `line`.`employee_code_snapshot` = `invoice`.`employee_code_snapshot`
WHERE `line`.`item_type` = 'service' AND `invoice`.`assigned_employee_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_employee_branch_fk` FOREIGN KEY (`employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_invoice_lines_employee_idx` ON `erp_invoice_lines` (`employee_id`);--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_employee_consistent` CHECK ((item_type = 'product' and employee_id is null and employee_name_snapshot is null and employee_code_snapshot is null) or (item_type = 'service' and ((employee_id is null and employee_name_snapshot is null and employee_code_snapshot is null) or (employee_id is not null and employee_name_snapshot is not null and employee_code_snapshot > 0))));--> statement-breakpoint
CREATE TRIGGER `erp_invoice_lines_validate_update`
BEFORE UPDATE ON `erp_invoice_lines`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  IF NEW.invoice_id <> OLD.invoice_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice line ownership is immutable';
  END IF;
  SELECT status INTO invoice_status
    FROM `erp_invoices` WHERE id = OLD.invoice_id FOR UPDATE;
  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice lines are immutable';
  END IF;
END;
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
  ELSE
    IF invoice_status = 'draft' OR NOT EXISTS (
      SELECT 1 FROM `erp_invoice_reversals` reversal
      WHERE reversal.id = NEW.invoice_reversal_id AND reversal.invoice_id = NEW.invoice_id
        AND reversal.status = 'pending' AND reversal.acting_account_id = NEW.acting_account_id
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal requires a pending invoice reversal';
    END IF;
    SELECT original.base_amount, original.amount INTO target_base, target_amount
      FROM `erp_commission_ledger_entries` original
      WHERE original.id = NEW.reverses_entry_id AND original.entry_type = 'earned'
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
  END IF;
END;
--> statement-breakpoint
DROP TRIGGER `erp_invoices_validate_employee_assignment`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_employee_assignment`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF OLD.status = 'draft' AND NEW.status = 'completed' THEN
    IF EXISTS (
      SELECT 1 FROM `erp_invoice_lines`
      WHERE invoice_id = NEW.id AND item_type = 'service' AND employee_id IS NULL
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Every service line requires an employee';
    END IF;
  END IF;
END;
--> statement-breakpoint
DROP TRIGGER `erp_invoices_validate_lifecycle`;
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
      OR NOT (NEW.acting_account_id <=> OLD.acting_account_id)
      OR NOT (NEW.cashier_session_id <=> OLD.cashier_session_id)
      OR NOT (NEW.invoice_number <=> OLD.invoice_number)
      OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
      OR NOT (NEW.client_name_snapshot <=> OLD.client_name_snapshot)
      OR NOT (NEW.client_phone_snapshot <=> OLD.client_phone_snapshot)
      OR NOT (NEW.seller_employee_id <=> OLD.seller_employee_id)
      OR NOT (NEW.seller_name_snapshot <=> OLD.seller_name_snapshot)
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
--> statement-breakpoint
ALTER TABLE `erp_invoices` DROP FOREIGN KEY `erp_invoices_employee_branch_fk`;--> statement-breakpoint
DROP INDEX `erp_invoices_employee_sold_idx` ON `erp_invoices`;--> statement-breakpoint
ALTER TABLE `erp_invoices` DROP CONSTRAINT `erp_invoices_employee_assignment_consistent`;--> statement-breakpoint
ALTER TABLE `erp_invoices` DROP CONSTRAINT `erp_invoices_employee_code_positive`;--> statement-breakpoint
ALTER TABLE `erp_invoices` DROP COLUMN `assigned_employee_id`;--> statement-breakpoint
ALTER TABLE `erp_invoices` DROP COLUMN `employee_name_snapshot`;--> statement-breakpoint
ALTER TABLE `erp_invoices` DROP COLUMN `employee_code_snapshot`;
