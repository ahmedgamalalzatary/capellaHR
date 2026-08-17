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
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_name_present` CHECK (CHAR_LENGTH(TRIM(`erp_expenses`.`name`)) > 0);--> statement-breakpoint
CREATE TRIGGER `erp_expenses_guard_update`
BEFORE UPDATE ON `erp_expenses`
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.`id` <=> NEW.`id`
    AND OLD.`branch_id` <=> NEW.`branch_id`
    AND OLD.`category_id` <=> NEW.`category_id`
    AND OLD.`name` <=> NEW.`name`
    AND OLD.`amount` <=> NEW.`amount`
    AND OLD.`expense_date` <=> NEW.`expense_date`
    AND OLD.`description` <=> NEW.`description`
    AND OLD.`acting_account_id` <=> NEW.`acting_account_id`
    AND OLD.`kind` <=> NEW.`kind`
    AND OLD.`reversal_of_id` <=> NEW.`reversal_of_id`
    AND OLD.`supersedes_id` <=> NEW.`supersedes_id`
    AND OLD.`correction_operation_id` <=> NEW.`correction_operation_id`
    AND OLD.`correction_reason` <=> NEW.`correction_reason`
    AND OLD.`created_at` <=> NEW.`created_at`
    AND OLD.`kind` = 'expense'
    AND OLD.`status` = 'active' AND NEW.`status` = 'corrected'
    AND EXISTS (
      SELECT 1 FROM `erp_expense_correction_guards` AS correction_guard
      WHERE correction_guard.`connection_id` = CONNECTION_ID()
        AND correction_guard.`original_id` = OLD.`id`
    )
    AND EXISTS (
      SELECT 1 FROM `erp_expenses` AS reversal
      INNER JOIN `erp_expenses` AS replacement
        ON replacement.`supersedes_id` = OLD.`id`
        AND replacement.`branch_id` = OLD.`branch_id`
        AND replacement.`kind` = 'expense'
        AND replacement.`correction_operation_id` = reversal.`correction_operation_id`
      WHERE reversal.`reversal_of_id` = OLD.`id`
        AND reversal.`branch_id` = OLD.`branch_id`
        AND reversal.`kind` = 'reversal'
    )
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense facts are immutable';
  END IF;
END;
