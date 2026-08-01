CREATE TABLE `erp_cashier_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`opened_by_account_id` int NOT NULL,
	`opened_at` timestamp(3) NOT NULL,
	`closed_at` timestamp(3),
	`closed_by_account_id` int,
	`open_branch_id` int GENERATED ALWAYS AS (case when closed_at is null then branch_id else null end) STORED,
	CONSTRAINT `erp_cashier_sessions_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_cashier_sessions_open_branch_unique` UNIQUE(`open_branch_id`),
	CONSTRAINT `erp_cashier_sessions_close_state` CHECK((`erp_cashier_sessions`.`closed_at` is null and `erp_cashier_sessions`.`closed_by_account_id` is null) or (`erp_cashier_sessions`.`closed_at` is not null and `erp_cashier_sessions`.`closed_by_account_id` is not null and `erp_cashier_sessions`.`closed_at` >= `erp_cashier_sessions`.`opened_at`))
);
--> statement-breakpoint
ALTER TABLE `erp_cashier_sessions` ADD CONSTRAINT `erp_cashier_sessions_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_cashier_sessions` ADD CONSTRAINT `erp_cashier_sessions_opened_by_account_id_accounts_id_fk` FOREIGN KEY (`opened_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_cashier_sessions` ADD CONSTRAINT `erp_cashier_sessions_closed_by_account_id_accounts_id_fk` FOREIGN KEY (`closed_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_cashier_sessions_branch_opened_idx` ON `erp_cashier_sessions` (`branch_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `erp_cashier_sessions_opened_account_idx` ON `erp_cashier_sessions` (`opened_by_account_id`,`opened_at`);--> statement-breakpoint
CREATE INDEX `erp_cashier_sessions_closed_account_idx` ON `erp_cashier_sessions` (`closed_by_account_id`,`closed_at`);