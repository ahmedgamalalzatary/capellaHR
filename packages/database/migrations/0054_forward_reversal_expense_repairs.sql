DROP TRIGGER `erp_invoice_reversals_validate_finalize`;--> statement-breakpoint
CREATE TRIGGER `erp_invoice_reversals_validate_finalize`
BEFORE UPDATE ON `erp_invoice_reversals`
FOR EACH ROW
BEGIN
  IF OLD.status <> 'pending' OR NEW.status <> 'finalized'
    OR NOT (NEW.invoice_id <=> OLD.invoice_id)
    OR NOT (NEW.branch_id <=> OLD.branch_id)
    OR NOT (NEW.type <=> OLD.type)
    OR NOT (NEW.idempotency_key <=> OLD.idempotency_key)
    OR NOT (NEW.reason <=> OLD.reason)
    OR NOT (NEW.acting_account_id <=> OLD.acting_account_id)
    OR NOT (NEW.approving_account_id <=> OLD.approving_account_id)
    OR NOT (NEW.gross_amount <=> OLD.gross_amount)
    OR NOT (NEW.discount_amount <=> OLD.discount_amount)
    OR NOT (NEW.tax_amount <=> OLD.tax_amount)
    OR NOT (NEW.total <=> OLD.total)
    OR NOT (NEW.business_date <=> OLD.business_date)
    OR NOT (NEW.created_at <=> OLD.created_at) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal facts are immutable';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id)
    OR (SELECT COALESCE(SUM(gross_amount), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.gross_amount
    OR (SELECT COALESCE(SUM(discount_amount), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.discount_amount
    OR (SELECT COALESCE(SUM(tax_amount), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.tax_amount
    OR (SELECT COALESCE(SUM(total), 0.00) FROM `erp_invoice_reversal_lines` WHERE reversal_id = NEW.id) <> NEW.total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal totals are incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT reversal_line.gross_amount, reversal_line.discount_amount,
        reversal_line.tax_amount, reversal_line.total, reversal_line.quantity,
        original_line.unit_price, original_line.quantity original_quantity,
        COALESCE(prior.quantity, 0) prior_quantity,
        ROUND(invoice.discount_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number <= original_line.line_number
        ) / invoice.subtotal, 2) - ROUND(invoice.discount_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number < original_line.line_number
        ) / invoice.subtotal, 2) allocated_discount,
        ROUND(invoice.tax_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number <= original_line.line_number
        ) / invoice.subtotal, 2) - ROUND(invoice.tax_amount * (
          SELECT COALESCE(SUM(prefix.line_total), 0.00) FROM `erp_invoice_lines` prefix
          WHERE prefix.invoice_id = original_line.invoice_id
            AND prefix.line_number < original_line.line_number
        ) / invoice.subtotal, 2) allocated_tax
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_lines` original_line ON original_line.id = reversal_line.invoice_line_id
      JOIN `erp_invoices` invoice ON invoice.id = original_line.invoice_id
      LEFT JOIN (
        SELECT prior_line.invoice_line_id, SUM(prior_line.quantity) quantity
        FROM `erp_invoice_reversal_lines` prior_line
        JOIN `erp_invoice_reversals` prior_reversal ON prior_reversal.id = prior_line.reversal_id
        WHERE prior_reversal.status = 'finalized'
          AND prior_reversal.invoice_id = NEW.invoice_id
        GROUP BY prior_line.invoice_line_id
      ) prior ON prior.invoice_line_id = original_line.id
      WHERE reversal_line.reversal_id = NEW.id
    ) allocation
    WHERE allocation.gross_amount <> allocation.unit_price * allocation.quantity
      OR allocation.discount_amount <> ROUND(
        allocation.allocated_discount * (allocation.prior_quantity + allocation.quantity)
          / allocation.original_quantity, 2
      ) - ROUND(
        allocation.allocated_discount * allocation.prior_quantity / allocation.original_quantity, 2
      )
      OR allocation.tax_amount <> ROUND(
        allocation.allocated_tax * (allocation.prior_quantity + allocation.quantity)
          / allocation.original_quantity, 2
      ) - ROUND(
        allocation.allocated_tax * allocation.prior_quantity / allocation.original_quantity, 2
      )
      OR allocation.total <> allocation.gross_amount
        - allocation.discount_amount + allocation.tax_amount
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal line allocation is invalid';
  END IF;
  IF EXISTS (
    SELECT 1 FROM `erp_invoice_lines` original_line
    LEFT JOIN (
      SELECT reversal_line.invoice_line_id, SUM(reversal_line.quantity) quantity
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id
        AND (reversal.status = 'finalized' OR reversal.id = NEW.id)
      GROUP BY reversal_line.invoice_line_id
    ) reversed ON reversed.invoice_line_id = original_line.id
    WHERE original_line.invoice_id = NEW.invoice_id
      AND COALESCE(reversed.quantity, 0) > original_line.quantity
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice refunded quantities are inconsistent';
  END IF;
  IF EXISTS (
    SELECT 1 FROM `erp_invoice_payments` original_payment
    LEFT JOIN (
      SELECT reversal_payment.invoice_payment_id, SUM(reversal_payment.amount) amount
      FROM `erp_invoice_reversal_payments` reversal_payment
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_payment.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id
        AND (reversal.status = 'finalized' OR reversal.id = NEW.id)
      GROUP BY reversal_payment.invoice_payment_id
    ) reversed ON reversed.invoice_payment_id = original_payment.id
    WHERE original_payment.invoice_id = NEW.invoice_id
      AND COALESCE(reversed.amount, 0.00) > original_payment.amount
  ) OR (SELECT COALESCE(SUM(amount), 0.00) FROM `erp_invoice_reversal_payments`
    WHERE reversal_id = NEW.id) <> NEW.total THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversed payments are inconsistent';
  END IF;
  IF EXISTS (
    SELECT original_line.product_id
    FROM `erp_invoice_reversal_lines` reversal_line
    JOIN `erp_invoice_lines` original_line ON original_line.id = reversal_line.invoice_line_id
    WHERE reversal_line.reversal_id = NEW.id AND original_line.item_type = 'product'
    GROUP BY original_line.product_id
    HAVING COALESCE((
      SELECT SUM(movement.quantity_delta) FROM `erp_stock_movements` movement
      WHERE movement.source_id = NEW.id
        AND movement.source_type = NEW.type
        AND movement.reason = NEW.type
        AND movement.product_id = original_line.product_id
        AND movement.branch_id = NEW.branch_id
    ), 0) <> SUM(reversal_line.quantity)
      OR EXISTS (
        SELECT 1 FROM `erp_stock_movements` movement
        WHERE movement.source_id = NEW.id AND movement.source_type = NEW.type
          AND movement.reason = NEW.type AND movement.product_id = original_line.product_id
          AND movement.branch_id = NEW.branch_id
          AND movement.acting_account_id <> NEW.acting_account_id
      )
      OR (SELECT stock.quantity FROM `erp_product_stocks` stock
        WHERE stock.product_id = original_line.product_id AND stock.branch_id = NEW.branch_id)
        <> (SELECT movement.balance_after FROM `erp_stock_movements` movement
          WHERE movement.source_id = NEW.id AND movement.source_type = NEW.type
            AND movement.reason = NEW.type AND movement.product_id = original_line.product_id
            AND movement.branch_id = NEW.branch_id
          ORDER BY movement.id DESC LIMIT 1)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal stock restoration is incomplete';
  END IF;
  IF EXISTS (
    SELECT original_line.id
    FROM `erp_invoice_lines` original_line
    LEFT JOIN (
      SELECT reversal_line.invoice_line_id, SUM(reversal_line.quantity) quantity
      FROM `erp_invoice_reversal_lines` reversal_line
      JOIN `erp_invoice_reversals` reversal ON reversal.id = reversal_line.reversal_id
      WHERE reversal.invoice_id = NEW.invoice_id
        AND (reversal.status = 'finalized' OR reversal.id = NEW.id)
      GROUP BY reversal_line.invoice_line_id
    ) reversed ON reversed.invoice_line_id = original_line.id
    WHERE original_line.invoice_id = NEW.invoice_id AND original_line.item_type = 'service'
      AND COALESCE((
        SELECT SUM(ledger.base_amount) FROM `erp_commission_ledger_entries` ledger
        JOIN `erp_invoice_reversals` ledger_reversal
          ON ledger_reversal.id = ledger.invoice_reversal_id
        WHERE ledger.invoice_line_id = original_line.id AND ledger.entry_type = 'reversal'
          AND (ledger_reversal.status = 'finalized' OR ledger_reversal.id = NEW.id)
      ), 0.00) <> original_line.unit_price * COALESCE(reversed.quantity, 0)
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice reversal commission facts are incomplete';
  END IF;
END;--> statement-breakpoint
DROP PROCEDURE `correct_erp_expense`;--> statement-breakpoint
CREATE PROCEDURE `correct_erp_expense`(
  IN p_original_id bigint unsigned,
  IN p_branch_id bigint unsigned,
  IN p_category_id bigint unsigned,
  IN p_amount decimal(13,2),
  IN p_expense_date date,
  IN p_description varchar(1000),
  IN p_acting_account_id bigint unsigned,
  IN p_reason varchar(500),
  IN p_created_at timestamp(3),
  IN p_operation_id varchar(36)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE has_savepoint boolean DEFAULT FALSE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF has_savepoint THEN
      ROLLBACK TO SAVEPOINT erp_expense_correction_start;
    END IF;
    RESIGNAL;
  END;

  SAVEPOINT erp_expense_correction_start;
  UPDATE `erp_expense_correction_guards`
  SET `original_id` = `original_id`
  WHERE `connection_id` = 0;
  ROLLBACK TO SAVEPOINT erp_expense_correction_start;
  SET has_savepoint = TRUE;

  INSERT INTO `erp_expense_correction_guards` (`connection_id`, `operation_id`, `original_id`)
  VALUES (CONNECTION_ID(), p_operation_id, p_original_id);

  INSERT INTO `erp_expenses` (
    `branch_id`, `category_id`, `amount`, `expense_date`, `description`,
    `acting_account_id`, `kind`, `status`, `reversal_of_id`,
    `correction_operation_id`, `correction_reason`, `created_at`
  )
  SELECT
    original.`branch_id`, original.`category_id`, original.`amount`, original.`expense_date`,
    original.`description`, p_acting_account_id, 'reversal', 'active', original.`id`,
    p_operation_id, p_reason, p_created_at
  FROM `erp_expenses` AS original
  WHERE original.`id` = p_original_id
    AND original.`branch_id` = p_branch_id
    AND original.`kind` = 'expense'
    AND original.`status` = 'active';

  IF ROW_COUNT() <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense correction target is invalid';
  END IF;

  INSERT INTO `erp_expenses` (
    `branch_id`, `category_id`, `amount`, `expense_date`, `description`,
    `acting_account_id`, `kind`, `status`, `supersedes_id`,
    `correction_operation_id`, `correction_reason`, `created_at`
  ) VALUES (
    p_branch_id, p_category_id, p_amount, p_expense_date, p_description,
    p_acting_account_id, 'expense', 'active', p_original_id,
    p_operation_id, p_reason, p_created_at
  );

  UPDATE `erp_expenses`
  SET `status` = 'corrected'
  WHERE `id` = p_original_id
    AND `branch_id` = p_branch_id
    AND `kind` = 'expense'
    AND `status` = 'active';

  IF ROW_COUNT() <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense correction target changed';
  END IF;

  DELETE FROM `erp_expense_correction_guards`
  WHERE `connection_id` = CONNECTION_ID();
  RELEASE SAVEPOINT erp_expense_correction_start;
END;
