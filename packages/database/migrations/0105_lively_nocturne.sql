CREATE TABLE `erp_commission_payouts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`commission_month` date NOT NULL,
	`branch_id` int NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`expense_id` int NOT NULL,
	`acting_account_id` int NOT NULL,
	`reason` varchar(200),
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_commission_payouts_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_commission_payouts_expense_unique` UNIQUE(`expense_id`),
	CONSTRAINT `erp_commission_payouts_amount_positive` CHECK(`erp_commission_payouts`.`amount` > 0),
	CONSTRAINT `erp_commission_payouts_month_first_day` CHECK(dayofmonth(`erp_commission_payouts`.`commission_month`) = 1)
);
--> statement-breakpoint
ALTER TABLE `erp_commission_payouts` ADD CONSTRAINT `erp_commission_payouts_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_payouts` ADD CONSTRAINT `erp_commission_payouts_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_payouts` ADD CONSTRAINT `erp_commission_payouts_expense_id_erp_expenses_id_fk` FOREIGN KEY (`expense_id`) REFERENCES `erp_expenses`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_commission_payouts` ADD CONSTRAINT `erp_commission_payouts_acting_account_id_accounts_id_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_commission_payouts_employee_month_idx` ON `erp_commission_payouts` (`employee_id`,`commission_month`);--> statement-breakpoint
CREATE INDEX `erp_commission_payouts_branch_idx` ON `erp_commission_payouts` (`branch_id`);