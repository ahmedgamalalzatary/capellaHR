CREATE TABLE `device_authentication_challenges` (
	`id` varchar(36) NOT NULL,
	`device_id` int NOT NULL,
	`challenge` varchar(512) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`consumed_at` timestamp(3),
	CONSTRAINT `device_authentication_challenges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `device_pairing_requests` ADD `registration_challenge` varchar(512);--> statement-breakpoint
ALTER TABLE `device_pairing_requests` ADD `webauthn_user_id` varchar(128);--> statement-breakpoint
ALTER TABLE `devices` ADD `credential_id` varchar(4096);--> statement-breakpoint
ALTER TABLE `devices` ADD `counter` bigint unsigned DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` ADD `transports` json;--> statement-breakpoint
ALTER TABLE `devices` ADD `credential_device_type` enum('singleDevice','multiDevice');--> statement-breakpoint
ALTER TABLE `devices` ADD `credential_backed_up` boolean;--> statement-breakpoint
UPDATE `devices` SET `status` = 'revoked', `revoked_at` = COALESCE(`revoked_at`, CURRENT_TIMESTAMP(3)), `credential_id` = `credential_id_hash`, `transports` = JSON_ARRAY(), `credential_device_type` = 'singleDevice', `credential_backed_up` = false;--> statement-breakpoint
ALTER TABLE `devices` MODIFY `credential_id` varchar(4096) NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` MODIFY `transports` json NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` MODIFY `credential_device_type` enum('singleDevice','multiDevice') NOT NULL;--> statement-breakpoint
ALTER TABLE `devices` MODIFY `credential_backed_up` boolean NOT NULL;--> statement-breakpoint
ALTER TABLE `device_authentication_challenges` ADD CONSTRAINT `device_authentication_challenges_device_id_devices_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices`(`id`) ON DELETE no action ON UPDATE no action;
