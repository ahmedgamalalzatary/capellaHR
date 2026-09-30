DROP TRIGGER IF EXISTS `erp_invoices_validate_seller_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `erp_invoices_validate_seller_assignment`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_seller_assignment`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF NOT (NEW.kind <=> OLD.kind) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice kind is immutable';
  ELSEIF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoices cannot return to draft';
  ELSEIF OLD.status <> 'draft' AND OLD.seller_employee_id IS NOT NULL
    AND (NOT (NEW.seller_employee_id <=> OLD.seller_employee_id)
      OR NOT (NEW.seller_name_snapshot <=> OLD.seller_name_snapshot)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice seller attribution is immutable';
  END IF;
END;
