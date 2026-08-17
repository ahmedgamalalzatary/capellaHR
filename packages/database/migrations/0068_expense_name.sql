DROP TRIGGER `erp_expenses_guard_update`;
--> statement-breakpoint
ALTER TABLE `erp_expenses` MODIFY COLUMN `description` varchar(1000) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD `name` varchar(255);--> statement-breakpoint
UPDATE `erp_expenses`
SET `name` = CASE
  WHEN CHAR_LENGTH(TRIM(`description`)) > 0 THEN LEFT(TRIM(`description`), 255)
  ELSE 'مصروف'
END
WHERE `name` IS NULL;--> statement-breakpoint
ALTER TABLE `erp_expenses` MODIFY COLUMN `name` varchar(255) NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_name_present` CHECK (CHAR_LENGTH(TRIM(`erp_expenses`.`name`)) > 0);
