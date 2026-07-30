ALTER TABLE `auth_sessions` DROP CONSTRAINT `auth_sessions_actor_employee_consistency`;--> statement-breakpoint
ALTER TABLE `auth_attempts` MODIFY COLUMN `actor_type` enum('admin','employee','account') NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_sessions` MODIFY COLUMN `actor_type` enum('admin','employee','account') NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` MODIFY COLUMN `actor_type` enum('admin','employee','account','system') NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `account_id` int;--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_actor_identity_consistency` CHECK ((`auth_sessions`.`actor_type` = 'admin' and `auth_sessions`.`employee_id` is null and `auth_sessions`.`account_id` is null)
      or (`auth_sessions`.`actor_type` = 'employee' and `auth_sessions`.`employee_id` is not null and `auth_sessions`.`account_id` is null)
      or (`auth_sessions`.`actor_type` = 'account' and `auth_sessions`.`employee_id` is null and `auth_sessions`.`account_id` is not null));--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `auth_sessions_account_active_idx` ON `auth_sessions` (`account_id`,`revoked_at`);