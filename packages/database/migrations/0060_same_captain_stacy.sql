CREATE TABLE `erp_branch_cashier_roster` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`employee_id` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_branch_cashier_roster_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_branch_cashier_roster_branch_employee_unique` UNIQUE(`branch_id`,`employee_id`)
);
--> statement-breakpoint
ALTER TABLE `accounts` DROP CONSTRAINT `accounts_role_scope_consistency`;--> statement-breakpoint
ALTER TABLE `accounts` ADD `branch_id` int;--> statement-breakpoint
ALTER TABLE `accounts` ADD `active_cashier_branch` int GENERATED ALWAYS AS (case when role = 'cashier' and employee_id is null and active then branch_id else null end) STORED;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD `seller_employee_id` int;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD `seller_name_snapshot` varchar(255);--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_active_cashier_branch_unique` UNIQUE(`active_cashier_branch`);--> statement-breakpoint
ALTER TABLE `erp_branch_cashier_roster` ADD CONSTRAINT `erp_branch_cashier_roster_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_branch_cashier_roster` ADD CONSTRAINT `erp_branch_cashier_roster_employee_branch_fk` FOREIGN KEY (`employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_role_scope_consistency` CHECK ((`accounts`.`role` = 'admin' and `accounts`.`employee_id` is null and `accounts`.`branch_id` is null) or (`accounts`.`role` = 'cashier' and ((`accounts`.`employee_id` is not null and `accounts`.`branch_id` is null) or (`accounts`.`employee_id` is null and `accounts`.`branch_id` is not null))));--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_seller_consistent` CHECK ((`erp_invoices`.`seller_employee_id` is null and `erp_invoices`.`seller_name_snapshot` is null) or (`erp_invoices`.`seller_employee_id` is not null and `erp_invoices`.`seller_name_snapshot` is not null));--> statement-breakpoint
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_invoices` ADD CONSTRAINT `erp_invoices_seller_branch_fk` FOREIGN KEY (`seller_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_invoices_seller_sold_idx` ON `erp_invoices` (`seller_employee_id`,`sold_at`);--> statement-breakpoint
UPDATE `accounts` SET `active` = false, `updated_at` = CURRENT_TIMESTAMP(3)
WHERE `role` = 'cashier' AND `employee_id` IS NOT NULL;--> statement-breakpoint
UPDATE `auth_sessions`
SET `revoked_at` = CURRENT_TIMESTAMP(3)
WHERE `revoked_at` IS NULL
  AND `account_id` IN (SELECT `id` FROM `accounts` WHERE `role` = 'cashier' AND `employee_id` IS NOT NULL);--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_seller_insert`
BEFORE INSERT ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF NEW.status <> 'draft' AND NEW.seller_employee_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoices require a seller';
  END IF;
END;--> statement-breakpoint
CREATE TRIGGER `erp_invoices_validate_seller_assignment`
BEFORE UPDATE ON `erp_invoices`
FOR EACH ROW
BEGIN
  IF OLD.status <> 'draft' AND NEW.status = 'draft' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoices cannot return to draft';
  ELSEIF OLD.status = 'draft' AND NEW.status <> 'draft' AND NEW.seller_employee_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoices require a seller';
  ELSEIF OLD.status <> 'draft' AND OLD.seller_employee_id IS NOT NULL
    AND (NOT (NEW.seller_employee_id <=> OLD.seller_employee_id)
      OR NOT (NEW.seller_name_snapshot <=> OLD.seller_name_snapshot)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Completed invoice seller attribution is immutable';
  END IF;
END;
