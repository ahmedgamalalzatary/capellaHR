ALTER TABLE `erp_invoice_lines` DROP CONSTRAINT `erp_invoice_lines_employee_consistent`;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` DROP CONSTRAINT `erp_invoice_lines_commission_consistent`;--> statement-breakpoint
ALTER TABLE `erp_products` ADD `commission_percent` decimal(5,2) DEFAULT '0.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `erp_products_commission_range` CHECK (`erp_products`.`commission_percent` between 0 and 100);--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_employee_consistent` CHECK (((item_type in ('product','service')) and ((employee_id is null and employee_name_snapshot is null and employee_code_snapshot is null) or (employee_id is not null and employee_name_snapshot is not null and employee_code_snapshot > 0))));--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_commission_consistent` CHECK (commission_rate_snapshot between 0 and 100 and commission_amount_snapshot >= 0 and ((item_type = 'product' and ((commission_rule_snapshot = 'none' and commission_rate_snapshot = 0 and commission_amount_snapshot = 0) or commission_rule_snapshot <> 'none')) or (item_type = 'service' and commission_rule_snapshot <> 'none')));
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
    IF invoice_status <> 'draft' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Earned commission requires a draft invoice'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM `erp_invoice_lines` line WHERE line.id = NEW.invoice_line_id AND line.invoice_id = NEW.invoice_id
        AND line.employee_id = NEW.employee_id AND line.item_type IN ('service','product')
        AND line.commission_rule_snapshot = NEW.commission_rule_snapshot
        AND line.commission_rate_snapshot = NEW.commission_rate_snapshot
        AND line.line_total = NEW.base_amount AND line.commission_amount_snapshot = NEW.amount
    ) OR NEW.amount <> ROUND(NEW.base_amount * NEW.commission_rate_snapshot / 100, 2) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Earned commission does not match its invoice line';
    END IF;
  ELSEIF NEW.entry_type = 'reversal' THEN
    IF invoice_status = 'draft' OR NOT EXISTS (SELECT 1 FROM `erp_invoice_reversals` reversal WHERE reversal.id = NEW.invoice_reversal_id AND reversal.invoice_id = NEW.invoice_id AND reversal.status = 'pending' AND reversal.acting_account_id = NEW.acting_account_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal requires a pending invoice reversal';
    END IF;
    SELECT original.base_amount, original.amount INTO target_base, target_amount FROM `erp_commission_ledger_entries` original
      WHERE original.id = NEW.reverses_entry_id AND original.entry_type = 'earned' AND original.invoice_id = NEW.invoice_id AND original.invoice_line_id = NEW.invoice_line_id;
    SELECT COALESCE(SUM(reversal_entry.base_amount), 0.00) INTO reversed_base FROM `erp_commission_ledger_entries` reversal_entry JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_entry.invoice_reversal_id WHERE reversal_entry.reverses_entry_id = NEW.reverses_entry_id AND reversal.status = 'finalized';
    IF target_base IS NULL OR NEW.base_amount > target_base OR target_amount <> ROUND(target_base * NEW.commission_rate_snapshot / 100, 2) OR -NEW.amount <> ROUND((reversed_base + NEW.base_amount) * NEW.commission_rate_snapshot / 100, 2) - ROUND(reversed_base * NEW.commission_rate_snapshot / 100, 2) OR reversed_base + NEW.base_amount > target_base THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal exceeds or mismatches the earned entry';
    END IF;
  END IF;
END;
