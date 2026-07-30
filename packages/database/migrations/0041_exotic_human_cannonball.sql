ALTER TABLE `auth_login_limits` ADD `version` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `auth_login_limits` ADD CONSTRAINT `auth_login_limits_version_nonnegative` CHECK (`auth_login_limits`.`version` >= 0);--> statement-breakpoint
CREATE INDEX `auth_login_limits_updated_idx` ON `auth_login_limits` (`updated_at`);