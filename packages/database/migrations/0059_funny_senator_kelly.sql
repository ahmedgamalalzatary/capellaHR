ALTER TABLE `erp_invoices` MODIFY COLUMN `assigned_employee_id` int;--> statement-breakpoint
ALTER TABLE `erp_invoices` MODIFY COLUMN `employee_name_snapshot` varchar(255);--> statement-breakpoint
ALTER TABLE `erp_invoices` MODIFY COLUMN `employee_code_snapshot` int;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_employee_assignment_consistent` CHECK ((`erp_invoices`.`assigned_employee_id` is null and `erp_invoices`.`employee_name_snapshot` is null and `erp_invoices`.`employee_code_snapshot` is null) or (`erp_invoices`.`assigned_employee_id` is not null and `erp_invoices`.`employee_name_snapshot` is not null and `erp_invoices`.`employee_code_snapshot` is not null));--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_employee_assignment`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  DECLARE service_count INT DEFAULT 0;
  IF OLD.status = 'draft' AND NEW.status = 'completed' THEN
    SELECT COUNT(*) INTO service_count
      FROM `erp_invoice_lines`
      WHERE invoice_id = NEW.id AND item_type = 'service';
    IF service_count > 0 AND NEW.assigned_employee_id IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Every service invoice requires an employee';
    END IF;
    IF service_count = 0 AND NEW.assigned_employee_id IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Product-only invoices cannot have an employee';
    END IF;
  END IF;
END;
