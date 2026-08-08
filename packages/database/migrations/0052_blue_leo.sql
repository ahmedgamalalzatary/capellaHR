ALTER TABLE `erp_commission_ledger_entries` DROP CONSTRAINT `erp_commission_ledger_entry_consistent`;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD `invoice_reversal_id` int;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_entry_consistent` CHECK ((entry_type = 'earned' and reverses_entry_id is null and invoice_reversal_id is null) or (entry_type = 'reversal' and reverses_entry_id is not null and invoice_reversal_id is not null));--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_invoice_reversal_fk` FOREIGN KEY (`invoice_reversal_id`) REFERENCES `erp_invoice_reversals`(`id`) ON DELETE no action ON UPDATE no action;
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
      INNER JOIN `erp_invoices` invoice ON invoice.id = line.invoice_id
      WHERE line.id = NEW.invoice_line_id AND line.invoice_id = NEW.invoice_id
        AND invoice.assigned_employee_id = NEW.employee_id AND line.item_type = 'service'
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
