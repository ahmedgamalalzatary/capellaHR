DROP TRIGGER `erp_commission_ledger_validate_insert`;
--> statement-breakpoint
CREATE TRIGGER `erp_commission_ledger_validate_insert`
BEFORE INSERT ON `erp_commission_ledger_entries`
FOR EACH ROW
BEGIN
  DECLARE target_base DECIMAL(14,2) DEFAULT NULL;
  DECLARE target_amount DECIMAL(14,2) DEFAULT NULL;
  DECLARE target_rule VARCHAR(32) DEFAULT NULL;
  DECLARE target_rate DECIMAL(5,2) DEFAULT NULL;
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
    SELECT original.base_amount, original.amount, original.commission_rule_snapshot, original.commission_rate_snapshot
      INTO target_base, target_amount, target_rule, target_rate
      FROM `erp_commission_ledger_entries` original
      WHERE original.id = NEW.reverses_entry_id
        AND original.entry_type IN ('earned','reassignment_in')
        AND original.invoice_id = NEW.invoice_id
        AND original.invoice_line_id = NEW.invoice_line_id
        AND original.employee_id = NEW.employee_id;
    SELECT COALESCE(SUM(reversal_entry.base_amount), 0.00) INTO reversed_base FROM `erp_commission_ledger_entries` reversal_entry JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_entry.invoice_reversal_id WHERE reversal_entry.reverses_entry_id = NEW.reverses_entry_id AND reversal.status = 'finalized';
    IF target_base IS NULL OR NEW.base_amount > target_base
      OR NEW.commission_rule_snapshot <> target_rule
      OR NEW.commission_rate_snapshot <> target_rate
      OR target_amount <> ROUND(target_base * target_rate / 100, 2)
      OR -NEW.amount <> ROUND((reversed_base + NEW.base_amount) * target_rate / 100, 2)
        - ROUND(reversed_base * target_rate / 100, 2)
      OR reversed_base + NEW.base_amount > target_base THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal exceeds or mismatches the earned entry';
    END IF;
  END IF;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `erp_invoices_validate_lifecycle`;
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
      IF service_count + (SELECT COUNT(*) FROM `erp_invoice_lines` product_line WHERE product_line.invoice_id = NEW.id AND product_line.item_type = 'product' AND product_line.commission_rule_snapshot <> 'none') <> (SELECT COUNT(*) FROM `erp_commission_ledger_entries`
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
      IF OLD.status NOT IN ('completed', 'partially_refunded')
        OR (NEW.amount_paid <=> OLD.amount_paid
          AND NEW.credited_amount <=> OLD.credited_amount
          AND NEW.settlement_status <=> OLD.settlement_status) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice settlement update is invalid';
      END IF;
      IF NEW.credited_amount <=> OLD.credited_amount
        AND (payment_total <> NEW.amount_paid OR NEW.settlement_status <> 'settled') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Service invoice must stay fully settled';
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

