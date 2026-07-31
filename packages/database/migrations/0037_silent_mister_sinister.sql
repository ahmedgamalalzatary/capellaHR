ALTER TABLE `auth_sessions` ADD `expires_at` timestamp(3);--> statement-breakpoint
UPDATE `auth_sessions`
SET `expires_at` = `created_at` + INTERVAL 7 DAY;--> statement-breakpoint
ALTER TABLE `auth_sessions`
MODIFY `expires_at` timestamp(3) DEFAULT (CURRENT_TIMESTAMP(3) + INTERVAL 7 DAY) NOT NULL;
