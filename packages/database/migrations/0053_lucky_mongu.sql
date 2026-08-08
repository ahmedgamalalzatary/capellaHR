ALTER TABLE `erp_expenses` ADD `correction_operation_id` varchar(36);--> statement-breakpoint
DROP TRIGGER `erp_expenses_guard_insert`;--> statement-breakpoint
DROP TRIGGER `erp_expenses_guard_update`;--> statement-breakpoint
UPDATE `erp_expenses` AS reversal
SET reversal.`correction_operation_id` = UUID()
WHERE reversal.`reversal_of_id` IS NOT NULL;--> statement-breakpoint
UPDATE `erp_expenses` AS replacement
INNER JOIN `erp_expenses` AS reversal
  ON reversal.`reversal_of_id` = replacement.`supersedes_id`
  AND reversal.`branch_id` = replacement.`branch_id`
SET replacement.`correction_operation_id` = reversal.`correction_operation_id`
WHERE replacement.`supersedes_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_expenses` ADD CONSTRAINT `erp_expenses_correction_operation_consistent` CHECK ((`erp_expenses`.`reversal_of_id` is null and `erp_expenses`.`supersedes_id` is null and `erp_expenses`.`correction_operation_id` is null) or (`erp_expenses`.`correction_operation_id` is not null and (`erp_expenses`.`reversal_of_id` is not null or `erp_expenses`.`supersedes_id` is not null)));--> statement-breakpoint
CREATE TABLE `erp_expense_correction_guards` (
  `connection_id` bigint unsigned NOT NULL,
  `operation_id` varchar(36) NOT NULL,
  `original_id` bigint unsigned NOT NULL,
  CONSTRAINT `erp_expense_correction_guards_connection_pk` PRIMARY KEY (`connection_id`),
  CONSTRAINT `erp_expense_correction_guards_operation_unique` UNIQUE (`operation_id`)
);--> statement-breakpoint
CREATE PROCEDURE `correct_erp_expense`(
  IN p_original_id bigint unsigned,
  IN p_branch_id bigint unsigned,
  IN p_category_id bigint unsigned,
  IN p_amount decimal(13,2),
  IN p_expense_date date,
  IN p_description varchar(500),
  IN p_acting_account_id bigint unsigned,
  IN p_reason varchar(500),
  IN p_created_at timestamp(3),
  IN p_operation_id varchar(36)
)
SQL SECURITY DEFINER
MODIFIES SQL DATA
BEGIN
  DECLARE has_savepoint boolean DEFAULT FALSE;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    IF has_savepoint THEN
      ROLLBACK TO SAVEPOINT erp_expense_correction_start;
    END IF;
    RESIGNAL;
  END;

  SAVEPOINT erp_expense_correction_start;
  UPDATE `erp_expense_correction_guards`
  SET `original_id` = `original_id`
  WHERE `connection_id` = 0;
  ROLLBACK TO SAVEPOINT erp_expense_correction_start;
  SET has_savepoint = TRUE;

  INSERT INTO `erp_expense_correction_guards` (`connection_id`, `operation_id`, `original_id`)
  VALUES (CONNECTION_ID(), p_operation_id, p_original_id);

  INSERT INTO `erp_expenses` (
    `branch_id`, `category_id`, `amount`, `expense_date`, `description`,
    `acting_account_id`, `kind`, `status`, `reversal_of_id`,
    `correction_operation_id`, `correction_reason`, `created_at`
  )
  SELECT
    original.`branch_id`, original.`category_id`, original.`amount`, original.`expense_date`,
    original.`description`, p_acting_account_id, 'reversal', 'active', original.`id`,
    p_operation_id, p_reason, p_created_at
  FROM `erp_expenses` AS original
  WHERE original.`id` = p_original_id
    AND original.`branch_id` = p_branch_id
    AND original.`kind` = 'expense'
    AND original.`status` = 'active';

  IF ROW_COUNT() <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense correction target is invalid';
  END IF;

  INSERT INTO `erp_expenses` (
    `branch_id`, `category_id`, `amount`, `expense_date`, `description`,
    `acting_account_id`, `kind`, `status`, `supersedes_id`,
    `correction_operation_id`, `correction_reason`, `created_at`
  ) VALUES (
    p_branch_id, p_category_id, p_amount, p_expense_date, p_description,
    p_acting_account_id, 'expense', 'active', p_original_id,
    p_operation_id, p_reason, p_created_at
  );

  UPDATE `erp_expenses`
  SET `status` = 'corrected'
  WHERE `id` = p_original_id
    AND `branch_id` = p_branch_id
    AND `kind` = 'expense'
    AND `status` = 'active';

  IF ROW_COUNT() <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense correction target changed';
  END IF;

  DELETE FROM `erp_expense_correction_guards`
  WHERE `connection_id` = CONNECTION_ID();
  RELEASE SAVEPOINT erp_expense_correction_start;
END;--> statement-breakpoint
CREATE TRIGGER `erp_expenses_guard_insert`
BEFORE INSERT ON `erp_expenses`
FOR EACH ROW
BEGIN
  IF NEW.`status` = 'corrected'
    OR ((NEW.`reversal_of_id` IS NOT NULL OR NEW.`supersedes_id` IS NOT NULL)
      AND NOT EXISTS (
        SELECT 1 FROM `erp_expense_correction_guards` AS correction_guard
        WHERE correction_guard.`connection_id` = CONNECTION_ID()
          AND correction_guard.`operation_id` = NEW.`correction_operation_id`
          AND correction_guard.`original_id` = COALESCE(NEW.`reversal_of_id`, NEW.`supersedes_id`)
      ))
  THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ERP expense correction facts must use the correction transaction';
  END IF;
END;--> statement-breakpoint
CREATE TRIGGER `erp_expenses_guard_update`
BEFORE UPDATE ON `erp_expenses`
FOR EACH ROW
BEGIN
  IF NOT (
    OLD.`id` <=> NEW.`id`
    AND OLD.`branch_id` <=> NEW.`branch_id`
    AND OLD.`category_id` <=> NEW.`category_id`
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
