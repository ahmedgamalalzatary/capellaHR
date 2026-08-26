DROP TRIGGER IF EXISTS `erp_invoices_validate_lifecycle`;--> statement-breakpoint
ALTER TABLE `erp_invoice_reversal_payments`
  DROP INDEX `erp_invoice_reversal_payments_method_unique`,
  ADD UNIQUE INDEX `erp_invoice_reversal_payments_method_payment_unique` (`reversal_id`, `method_snapshot`, `invoice_payment_id`);--> statement-breakpoint
UPDATE `erp_invoices`
  SET `credited_amount` = 0.00, `settlement_status` = 'open'
  WHERE `status` = 'draft';--> statement-breakpoint
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
      IF OLD.status NOT IN ('completed', 'partially_refunded')
        OR (service_count > 0
          AND NEW.amount_paid <=> OLD.amount_paid
          AND NEW.credited_amount <=> OLD.credited_amount
          AND NEW.settlement_status <=> OLD.settlement_status) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice settlement update is invalid';
      END IF;
      IF service_count > 0
        AND NEW.credited_amount <=> OLD.credited_amount
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
