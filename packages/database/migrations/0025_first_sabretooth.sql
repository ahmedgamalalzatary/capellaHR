DROP TABLE `device_authentication_challenges`;--> statement-breakpoint
ALTER TABLE `devices` DROP INDEX `devices_credential_hash_unique`;--> statement-breakpoint
ALTER TABLE `device_pairing_requests` DROP COLUMN `registration_challenge`;--> statement-breakpoint
ALTER TABLE `device_pairing_requests` DROP COLUMN `webauthn_user_id`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `credential_id`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `credential_id_hash`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `public_key`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `counter`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `transports`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `credential_device_type`;--> statement-breakpoint
ALTER TABLE `devices` DROP COLUMN `credential_backed_up`;