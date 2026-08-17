DROP TRIGGER IF EXISTS `erp_invoices_validate_seller_assignment`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_seller_assignment`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF NOT (NEW.kind <=> OLD.kind) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice kind is immutable';
  ELSEIF OLD.kind = 'branch_transfer' AND OLD.status <> 'draft'
    AND NOT (NEW.status <=> OLD.status) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Branch transfer invoices cannot be voided or refunded';
  ELSEIF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoices cannot return to draft';
  ELSEIF OLD.kind = 'sale' AND OLD.status = 'draft' AND NEW.status <> 'draft'
    AND NEW.seller_employee_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoices require a seller';
  ELSEIF OLD.status <> 'draft' AND OLD.seller_employee_id IS NOT NULL
    AND (NOT (NEW.seller_employee_id <=> OLD.seller_employee_id)
      OR NOT (NEW.seller_name_snapshot <=> OLD.seller_name_snapshot)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice seller attribution is immutable';
  END IF;
END;
