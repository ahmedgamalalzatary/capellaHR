ALTER TABLE `auth_sessions` ADD `expires_at` timestamp(3);--> statement-breakpoint
INSERT INTO `accounts` (`username`, `password_hash`, `role`, `employee_id`, `active`, `created_at`, `updated_at`)
SELECT LOWER(`email`), `password_hash`, 'admin', NULL, true, `updated_at`, `updated_at`
FROM `admin_credentials`;--> statement-breakpoint
UPDATE `auth_sessions`
JOIN `accounts` ON `accounts`.`role` = 'admin'
SET `auth_sessions`.`actor_type` = 'account',
    `auth_sessions`.`account_id` = `accounts`.`id`
WHERE `auth_sessions`.`actor_type` = 'admin';--> statement-breakpoint
UPDATE `auth_sessions`
SET `expires_at` = DATE_ADD(`created_at`, INTERVAL 1 DAY);--> statement-breakpoint
ALTER TABLE `auth_sessions` MODIFY COLUMN `expires_at` timestamp(3) NOT NULL;--> statement-breakpoint
DROP TABLE `admin_credentials`;
