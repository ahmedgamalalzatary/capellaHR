ALTER TABLE `advances` ADD `reason` varchar(200);
--> statement-breakpoint
UPDATE `advances` SET `reason` = 'غير مسجل (سجل قديم)' WHERE `reason` IS NULL;
--> statement-breakpoint
ALTER TABLE `advances` MODIFY COLUMN `reason` varchar(200) NOT NULL;
