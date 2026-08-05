CREATE TABLE `erp_expenses` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`category_id` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`expense_date` date NOT NULL,
	`description` varchar(1000) NOT NULL,
	`acting_account_id` int NOT NULL,
	`kind` enum('expense','reversal') NOT NULL DEFAULT 'expense',
	`status` enum('active','corrected') NOT NULL DEFAULT 'active',
	`reversal_of_id` int,
	`supersedes_id` int,
	`correction_reason` varchar(500),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_expenses_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_expenses_id_branch_unique` UNIQUE(`id`,`branch_id`),
	CONSTRAINT `erp_expenses_reversal_unique` UNIQUE(`reversal_of_id`),
	CONSTRAINT `erp_expenses_supersedes_unique` UNIQUE(`supersedes_id`),
	CONSTRAINT `erp_expenses_amount_positive` CHECK(`erp_expenses`.`amount` > 0),
	CONSTRAINT `erp_expenses_lineage_consistent` CHECK((`erp_expenses`.`kind` = 'expense' and `erp_expenses`.`reversal_of_id` is null) or (`erp_expenses`.`kind` = 'reversal' and `erp_expenses`.`reversal_of_id` is not null and `erp_expenses`.`supersedes_id` is null)),
	CONSTRAINT `erp_expenses_correction_reason_consistent` CHECK((`erp_expenses`.`reversal_of_id` is null and `erp_expenses`.`supersedes_id` is null and `erp_expenses`.`correction_reason` is null) or (`erp_expenses`.`correction_reason` is not null and (`erp_expenses`.`reversal_of_id` is not null or `erp_expenses`.`supersedes_id` is not null)))
);
--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_branch_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_category_branch_fk` FOREIGN KEY (`category_id`,`branch_id`) REFERENCES `erp_categories`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_account_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_reversal_branch_fk` FOREIGN KEY (`reversal_of_id`,`branch_id`) REFERENCES `erp_expenses`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_supersedes_branch_fk` FOREIGN KEY (`supersedes_id`,`branch_id`) REFERENCES `erp_expenses`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_expenses_branch_date_idx` ON `erp_expenses` (`branch_id`,`expense_date`,`id`);--> statement-breakpoint
CREATE INDEX `erp_expenses_branch_category_date_idx` ON `erp_expenses` (`branch_id`,`category_id`,`expense_date`);--> statement-breakpoint
CREATE TRIGGER `erp_expenses_guard_update`
BEFORE UPDATE ON `erp_expenses`
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.`id` <=> NEW.`id`
    AND OLD.`branch_id` <=> NEW.`branch_id`
    AND OLD.`category_id` <=> NEW.`category_id`
    AND OLD.`amount` <=> NEW.`amount`
    AND OLD.`expense_date` <=> NEW.`expense_date`
    AND OLD.`description` <=> NEW.`description`
    AND OLD.`acting_account_id` <=> NEW.`acting_account_id`
    AND OLD.`kind` <=> NEW.`kind`
    AND OLD.`reversal_of_id` <=> NEW.`reversal_of_id`
    AND OLD.`supersedes_id` <=> NEW.`supersedes_id`
    AND OLD.`correction_reason` <=> NEW.`correction_reason`
    AND OLD.`created_at` <=> NEW.`created_at`
    AND OLD.`kind` = 'expense'
    AND OLD.`status` = 'active' AND NEW.`status` = 'corrected'
    AND EXISTS (
      SELECT 1 FROM `erp_expenses` AS reversal
      WHERE reversal.`reversal_of_id` = OLD.`id`
        AND reversal.`branch_id` = OLD.`branch_id`
        AND reversal.`kind` = 'reversal'
    )
    AND EXISTS (
      SELECT 1 FROM `erp_expenses` AS replacement
      WHERE replacement.`supersedes_id` = OLD.`id`
        AND replacement.`branch_id` = OLD.`branch_id`
        AND replacement.`kind` = 'expense'
    )
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense facts are immutable';
  END IF;
END;--> statement-breakpoint
CREATE TRIGGER `erp_expenses_reject_delete`
BEFORE DELETE ON `erp_expenses`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense facts cannot be deleted';
END;
