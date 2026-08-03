CREATE TABLE `erp_products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_normalized` varchar(64) NOT NULL,
	`description` varchar(1000),
	`selling_price` decimal(12,2) NOT NULL,
	`last_purchase_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
	`low_stock_threshold` int NOT NULL DEFAULT 0,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_products_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_products_id_branch_unique` UNIQUE(`id`,`branch_id`),
	CONSTRAINT `erp_products_branch_name_unique` UNIQUE(`branch_id`,`name_normalized`),
	CONSTRAINT `erp_products_selling_price_positive` CHECK(`erp_products`.`selling_price` > 0),
	CONSTRAINT `erp_products_purchase_cost_nonnegative` CHECK(`erp_products`.`last_purchase_cost` >= 0),
	CONSTRAINT `erp_products_low_stock_nonnegative` CHECK(`erp_products`.`low_stock_threshold` >= 0)
);
--> statement-breakpoint
CREATE TABLE `erp_commission_ledger_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`invoice_line_id` int NOT NULL,
	`employee_id` int NOT NULL,
	`acting_account_id` int NOT NULL,
	`entry_type` enum('earned','reversal') NOT NULL,
	`reverses_entry_id` int,
	`commission_rule_snapshot` enum('service_default','employee_override') NOT NULL,
	`commission_rate_snapshot` decimal(5,2) NOT NULL,
	`base_amount` decimal(14,2) NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`original_invoice_line_id` int GENERATED ALWAYS AS (case when entry_type = 'earned' then invoice_line_id else null end) STORED,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_commission_ledger_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_commission_ledger_original_line_unique` UNIQUE(`original_invoice_line_id`),
	CONSTRAINT `erp_commission_ledger_entry_consistent` CHECK((entry_type = 'earned' and reverses_entry_id is null) or (entry_type = 'reversal' and reverses_entry_id is not null)),
	CONSTRAINT `erp_commission_ledger_amount_direction` CHECK(`erp_commission_ledger_entries`.`base_amount` > 0 and `erp_commission_ledger_entries`.`commission_rate_snapshot` between 0 and 100 and ((entry_type = 'earned' and amount >= 0) or (entry_type = 'reversal' and amount <= 0)))
);
--> statement-breakpoint
CREATE TABLE `erp_invoice_daily_sequences` (
	`business_date` date NOT NULL,
	`last_value` int NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_invoice_daily_sequences_business_date` PRIMARY KEY(`business_date`),
	CONSTRAINT `erp_invoice_daily_sequences_value_positive` CHECK(`erp_invoice_daily_sequences`.`last_value` > 0)
);
--> statement-breakpoint
CREATE TABLE `erp_invoice_lines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`line_number` int NOT NULL,
	`item_type` enum('service','product') NOT NULL,
	`service_id` int,
	`product_id` int,
	`item_name_snapshot` varchar(255) NOT NULL,
	`quantity` int NOT NULL,
	`unit_price` decimal(12,2) NOT NULL,
	`line_total` decimal(14,2) NOT NULL,
	`commission_rule_snapshot` enum('service_default','employee_override','none') NOT NULL,
	`commission_rate_snapshot` decimal(5,2) NOT NULL,
	`commission_amount_snapshot` decimal(14,2) NOT NULL,
	`product_cost_basis_snapshot` decimal(12,2),
	CONSTRAINT `erp_invoice_lines_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_lines_invoice_line_unique` UNIQUE(`invoice_id`,`line_number`),
	CONSTRAINT `erp_invoice_lines_source_consistent` CHECK((item_type = 'service' and service_id is not null and product_id is null) or (item_type = 'product' and product_id is not null and service_id is null)),
	CONSTRAINT `erp_invoice_lines_amounts_consistent` CHECK(`erp_invoice_lines`.`line_number` > 0 and `erp_invoice_lines`.`quantity` > 0 and `erp_invoice_lines`.`unit_price` > 0 and `erp_invoice_lines`.`line_total` = `erp_invoice_lines`.`unit_price` * `erp_invoice_lines`.`quantity`),
	CONSTRAINT `erp_invoice_lines_commission_consistent` CHECK(commission_rate_snapshot between 0 and 100 and commission_amount_snapshot >= 0 and ((item_type = 'product' and commission_rule_snapshot = 'none' and commission_rate_snapshot = 0 and commission_amount_snapshot = 0) or (item_type = 'service' and commission_rule_snapshot <> 'none'))),
	CONSTRAINT `erp_invoice_lines_cost_consistent` CHECK((item_type = 'service' and product_cost_basis_snapshot is null) or (item_type = 'product' and product_cost_basis_snapshot is not null and product_cost_basis_snapshot >= 0))
);
--> statement-breakpoint
CREATE TABLE `erp_invoice_payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`invoice_id` int NOT NULL,
	`method` enum('cash','visa','instapay','vodafone_cash') NOT NULL,
	`amount` decimal(14,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_invoice_payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoice_payments_invoice_method_unique` UNIQUE(`invoice_id`,`method`),
	CONSTRAINT `erp_invoice_payments_amount_positive` CHECK(`erp_invoice_payments`.`amount` > 0)
);
--> statement-breakpoint
CREATE TABLE `erp_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`client_id` int NOT NULL,
	`assigned_employee_id` int NOT NULL,
	`acting_account_id` int NOT NULL,
	`cashier_session_id` int NOT NULL,
	`invoice_number` varchar(40) NOT NULL,
	`idempotency_key` varchar(36) NOT NULL,
	`status` enum('draft','completed','partially_refunded','refunded','voided') NOT NULL DEFAULT 'draft',
	`client_name_snapshot` varchar(255) NOT NULL,
	`client_phone_snapshot` varchar(11) NOT NULL,
	`employee_name_snapshot` varchar(255) NOT NULL,
	`employee_code_snapshot` int NOT NULL,
	`authorized_by_snapshot` varchar(255) NOT NULL,
	`subtotal` decimal(14,2) NOT NULL,
	`discount_kind` enum('percentage','fixed'),
	`discount_value` decimal(14,2),
	`discount_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`tax_kind` enum('percentage','fixed'),
	`tax_value` decimal(14,2),
	`tax_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
	`total` decimal(14,2) NOT NULL,
	`sold_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_invoices_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_invoices_id_branch_unique` UNIQUE(`id`,`branch_id`),
	CONSTRAINT `erp_invoices_number_unique` UNIQUE(`invoice_number`),
	CONSTRAINT `erp_invoices_idempotency_unique` UNIQUE(`idempotency_key`),
	CONSTRAINT `erp_invoices_subtotal_positive` CHECK(`erp_invoices`.`subtotal` > 0),
	CONSTRAINT `erp_invoices_totals_consistent` CHECK(`erp_invoices`.`total` = `erp_invoices`.`subtotal` - `erp_invoices`.`discount_amount` + `erp_invoices`.`tax_amount` and `erp_invoices`.`total` > 0),
	CONSTRAINT `erp_invoices_discount_consistent` CHECK((discount_kind is null and discount_value is null and discount_amount = 0) or (discount_kind is not null and discount_value is not null and discount_value >= 0 and discount_amount >= 0 and discount_amount <= subtotal and (discount_kind <> 'percentage' or discount_value <= 100))),
	CONSTRAINT `erp_invoices_tax_consistent` CHECK((tax_kind is null and tax_value is null and tax_amount = 0) or (tax_kind is not null and tax_value is not null and tax_value >= 0 and tax_amount >= 0 and (tax_kind <> 'percentage' or tax_value <= 100))),
	CONSTRAINT `erp_invoices_employee_code_positive` CHECK(`erp_invoices`.`employee_code_snapshot` > 0)
);
--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_id_branch_unique` UNIQUE(`id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_services` ADD CONSTRAINT `erp_services_id_branch_unique` UNIQUE(`id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_id_branch_unique` UNIQUE(`id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_cashier_sessions` ADD CONSTRAINT `erp_cashier_sessions_id_branch_unique` UNIQUE(`id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `erp_products_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_invoice_fk` FOREIGN KEY (`invoice_id`) REFERENCES `erp_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_line_fk` FOREIGN KEY (`invoice_line_id`) REFERENCES `erp_invoice_lines`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_employee_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_ledger_entries` ADD CONSTRAINT `erp_commission_ledger_reverses_entry_fk` FOREIGN KEY (`reverses_entry_id`) REFERENCES `erp_commission_ledger_entries`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_invoice_branch_fk` FOREIGN KEY (`invoice_id`,`branch_id`) REFERENCES `erp_invoices`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_service_branch_fk` FOREIGN KEY (`service_id`,`branch_id`) REFERENCES `erp_services`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_lines` ADD CONSTRAINT `erp_invoice_lines_product_branch_fk` FOREIGN KEY (`product_id`,`branch_id`) REFERENCES `erp_products`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoice_payments` ADD CONSTRAINT `erp_invoice_payments_invoice_fk` FOREIGN KEY (`invoice_id`) REFERENCES `erp_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_client_branch_fk` FOREIGN KEY (`client_id`,`branch_id`) REFERENCES `clients`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_employee_branch_fk` FOREIGN KEY (`assigned_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_session_branch_fk` FOREIGN KEY (`cashier_session_id`,`branch_id`) REFERENCES `erp_cashier_sessions`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_products_branch_active_idx` ON `erp_products` (`branch_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `erp_commission_ledger_employee_created_idx` ON `erp_commission_ledger_entries` (`employee_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `erp_commission_ledger_invoice_idx` ON `erp_commission_ledger_entries` (`invoice_id`);--> statement-breakpoint
CREATE INDEX `erp_commission_ledger_reversal_idx` ON `erp_commission_ledger_entries` (`reverses_entry_id`);--> statement-breakpoint
CREATE INDEX `erp_invoice_lines_service_idx` ON `erp_invoice_lines` (`service_id`);--> statement-breakpoint
CREATE INDEX `erp_invoice_lines_product_idx` ON `erp_invoice_lines` (`product_id`);--> statement-breakpoint
CREATE INDEX `erp_invoices_branch_sold_idx` ON `erp_invoices` (`branch_id`,`sold_at`);--> statement-breakpoint
CREATE INDEX `erp_invoices_client_sold_idx` ON `erp_invoices` (`client_id`,`sold_at`);--> statement-breakpoint
CREATE INDEX `erp_invoices_employee_sold_idx` ON `erp_invoices` (`assigned_employee_id`,`sold_at`);--> statement-breakpoint
CREATE INDEX `erp_invoices_session_idx` ON `erp_invoices` (`cashier_session_id`);
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_require_draft_insert`
BEFORE INSERT ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF NEW.status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoices must be inserted as draft';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_completion`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF OLD.status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice facts are immutable';
  ELSEIF NEW.status <> 'draft' THEN
    IF NEW.status <> 'completed' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice status transition is invalid';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM `erp_invoice_lines` WHERE invoice_id = NEW.id
    ) OR (
      SELECT COALESCE(SUM(line_total), 0.00)
      FROM `erp_invoice_lines`
      WHERE invoice_id = NEW.id
    ) <> NEW.subtotal THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice lines must exactly cover the subtotal';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM `erp_invoice_payments` WHERE invoice_id = NEW.id
    ) OR (
      SELECT COALESCE(SUM(amount), 0.00)
      FROM `erp_invoice_payments`
      WHERE invoice_id = NEW.id
    ) <> NEW.total THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payments must exactly cover the total';
    END IF;

    IF (
      SELECT COUNT(*) FROM `erp_invoice_lines`
      WHERE invoice_id = NEW.id AND item_type = 'service'
    ) <> (
      SELECT COUNT(*) FROM `erp_commission_ledger_entries`
      WHERE invoice_id = NEW.id AND entry_type = 'earned'
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Every service line requires earned commission';
    END IF;
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoices_reject_delete`
BEFORE DELETE ON `erp_invoices`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice facts are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_lines_validate_insert`
BEFORE INSERT ON `erp_invoice_lines`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  SELECT status INTO invoice_status
    FROM `erp_invoices` WHERE id = NEW.invoice_id FOR UPDATE;
  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice lines are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_lines_validate_update`
BEFORE UPDATE ON `erp_invoice_lines`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  IF NEW.invoice_id <> OLD.invoice_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice line ownership is immutable';
  END IF;
  SELECT status INTO invoice_status
    FROM `erp_invoices` WHERE id = OLD.invoice_id FOR UPDATE;
  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice lines are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_lines_validate_delete`
BEFORE DELETE ON `erp_invoice_lines`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;
  SELECT status INTO invoice_status
    FROM `erp_invoices` WHERE id = OLD.invoice_id FOR UPDATE;
  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice lines are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_insert`
BEFORE INSERT ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;

  SELECT status
    INTO invoice_status
    FROM `erp_invoices`
    WHERE id = NEW.invoice_id
    FOR UPDATE;

  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice payments are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_update`
BEFORE UPDATE ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;

  IF NEW.invoice_id <> OLD.invoice_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invoice payment ownership is immutable';
  END IF;

  SELECT status
    INTO invoice_status
    FROM `erp_invoices`
    WHERE id = OLD.invoice_id
    FOR UPDATE;

  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice payments are immutable';
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_invoice_payments_validate_delete`
BEFORE DELETE ON `erp_invoice_payments`
FOR EACH ROW
BEGIN
  DECLARE invoice_status VARCHAR(32) DEFAULT NULL;

  SELECT status
    INTO invoice_status
    FROM `erp_invoices`
    WHERE id = OLD.invoice_id
    FOR UPDATE;

  IF invoice_status <> 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice payments are immutable';
  END IF;
END;
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

  SELECT invoice.id, invoice.status
    INTO locked_invoice_id, invoice_status
    FROM `erp_invoices` invoice
    WHERE invoice.id = NEW.invoice_id
    FOR UPDATE;

  IF NEW.entry_type = 'earned' THEN
    IF invoice_status <> 'draft' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Earned commission requires a draft invoice';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM `erp_invoice_lines` line
      INNER JOIN `erp_invoices` invoice ON invoice.id = line.invoice_id
      WHERE line.id = NEW.invoice_line_id
        AND line.invoice_id = NEW.invoice_id
        AND invoice.assigned_employee_id = NEW.employee_id
        AND line.item_type = 'service'
        AND line.commission_rule_snapshot = NEW.commission_rule_snapshot
        AND line.commission_rate_snapshot = NEW.commission_rate_snapshot
        AND line.line_total = NEW.base_amount
        AND line.commission_amount_snapshot = NEW.amount
    ) OR NEW.amount <> ROUND(NEW.base_amount * NEW.commission_rate_snapshot / 100, 2) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Earned commission does not match its service line';
    END IF;
  ELSE
    IF invoice_status = 'draft' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal requires a completed invoice';
    END IF;

    SELECT original.base_amount, original.amount
      INTO target_base, target_amount
      FROM `erp_commission_ledger_entries` original
      WHERE original.id = NEW.reverses_entry_id
        AND original.entry_type = 'earned'
        AND original.invoice_id = NEW.invoice_id
        AND original.invoice_line_id = NEW.invoice_line_id
        AND original.employee_id = NEW.employee_id
        AND original.commission_rule_snapshot = NEW.commission_rule_snapshot
        AND original.commission_rate_snapshot = NEW.commission_rate_snapshot;

    SELECT COALESCE(SUM(reversal.base_amount), 0.00)
      INTO reversed_base
      FROM `erp_commission_ledger_entries` reversal
      WHERE reversal.reverses_entry_id = NEW.reverses_entry_id;

    IF target_base IS NULL
      OR NEW.base_amount > target_base
      OR target_amount <> ROUND(target_base * NEW.commission_rate_snapshot / 100, 2)
      OR -NEW.amount <> ROUND((reversed_base + NEW.base_amount) * NEW.commission_rate_snapshot / 100, 2)
        - ROUND(reversed_base * NEW.commission_rate_snapshot / 100, 2)
      OR reversed_base + NEW.base_amount > target_base THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission reversal exceeds or mismatches the earned entry';
    END IF;
  END IF;
END;
--> statement-breakpoint
CREATE TRIGGER `erp_commission_ledger_reject_update`
BEFORE UPDATE ON `erp_commission_ledger_entries`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission ledger entries are immutable';
--> statement-breakpoint
CREATE TRIGGER `erp_commission_ledger_reject_delete`
BEFORE DELETE ON `erp_commission_ledger_entries`
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Commission ledger entries are immutable';
