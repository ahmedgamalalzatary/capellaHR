INSERT INTO `device_history` (`device_id`, `event`, `created_at`)
SELECT `devices`.`id`, 'revoked', COALESCE(`devices`.`revoked_at`, CURRENT_TIMESTAMP(3))
FROM `devices`
WHERE `devices`.`status` = 'revoked'
  AND NOT EXISTS (SELECT 1 FROM `device_history` WHERE `device_history`.`device_id` = `devices`.`id` AND `device_history`.`event` = 'revoked');--> statement-breakpoint
ALTER TABLE `devices` MODIFY COLUMN `installation_marker_hash` varchar(64);
