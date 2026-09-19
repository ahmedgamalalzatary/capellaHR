-- Custom SQL migration file, put your code below! --
DROP TRIGGER IF EXISTS `erp_invoice_payments_validate_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `erp_invoice_payments_apply_insert`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_insert`
BEFORE INSERT ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  DECLARE invoice_kind VARCHAR(32) DEFAULT NULL;
  DECLARE invoice_balance DECIMAL(14,2) DEFAULT NULL;
  DECLARE invoice_has_service INT DEFAULT 0;
  SELECT status, kind, balance_due INTO invoice_status, invoice_kind, invoice_balance
    FROM `erp_invoices` WHERE id = NEW.invoice_id FOR UPDATE;
  SELECT EXISTS(SELECT 1 FROM `erp_invoice_lines`
    WHERE invoice_id = NEW.invoice_id AND item_type = 'service') INTO invoice_has_service;
  IF invoice_kind = 'branch_transfer' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Branch transfers do not accept payments';
  END IF;
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
CREATE TRIGGER `erp_invoice_payments_apply_insert`
AFTER INSERT ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  SELECT status INTO invoice_status FROM `erp_invoices` WHERE id = NEW.invoice_id;
  IF invoice_status <> 'draft' THEN
    UPDATE `erp_invoices`
    SET `amount_paid` = `amount_paid` + NEW.amount,
        `settlement_status` = IF(`balance_due` = NEW.amount, 'settled', 'open')
    WHERE id = NEW.invoice_id;
  END IF;
END;
