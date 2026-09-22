DROP TRIGGER `erp_invoice_line_reassignments_validate_insert`;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_line_reassignments_validate_insert`
BEFORE INSERT ON `erp_invoice_line_reassignments`
FOR EACH ROW
BEGIN
  DECLARE current_employee_id INT DEFAULT NULL;
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  DECLARE line_type VARCHAR(16) DEFAULT NULL;
  DECLARE original_quantity INT DEFAULT NULL;
  DECLARE refunded_quantity INT DEFAULT 0;
  SELECT COALESCE((
      SELECT prior.to_employee_id
      FROM `erp_invoice_line_reassignments` prior
      WHERE prior.invoice_line_id = NEW.invoice_line_id
      ORDER BY prior.created_at DESC, prior.id DESC
      LIMIT 1
    ), line.employee_id), invoice.status, line.item_type, line.quantity
    INTO current_employee_id, invoice_status, line_type, original_quantity
    FROM `erp_invoice_lines` line
    JOIN `erp_invoices` invoice ON invoice.id = line.invoice_id
    WHERE line.id = NEW.invoice_line_id
      AND line.invoice_id = NEW.invoice_id
      AND line.branch_id = NEW.branch_id;
  SELECT COALESCE(SUM(reversal_line.quantity), 0) INTO refunded_quantity
    FROM `erp_invoice_reversal_lines` reversal_line
    JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
    WHERE reversal_line.invoice_line_id = NEW.invoice_line_id
      AND reversal.status = 'finalized';
  IF invoice_status IS NULL
    OR invoice_status NOT IN ('completed', 'partially_refunded')
    OR line_type <> 'service'
    OR refunded_quantity >= original_quantity THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only service lines with an unrefunded quantity can be reassigned';
  END IF;
  IF current_employee_id IS NULL OR current_employee_id <> NEW.from_employee_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Reassignment source employee is not current';
  END IF;
END;
