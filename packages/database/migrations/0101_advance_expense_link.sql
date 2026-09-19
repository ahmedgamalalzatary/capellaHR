ALTER TABLE `advances` ADD `expense_id` int;--> statement-breakpoint
UPDATE `advances`
INNER JOIN `employees` ON `employees`.`id` = `advances`.`employee_id`
INNER JOIN (
  SELECT
    `erp_expenses`.`id`,
    `erp_expenses`.`branch_id`,
    `erp_expenses`.`amount`,
    `erp_expenses`.`created_at`,
    `erp_expenses`.`description`
  FROM `erp_expenses`
  INNER JOIN (
    SELECT
      `branch_id`,
      `amount`,
      `created_at`,
      `description`
    FROM `erp_expenses`
    WHERE `name` = 'advance'
      AND `kind` = 'expense'
      AND `status` = 'active'
    GROUP BY `branch_id`, `amount`, `created_at`, `description`
    HAVING COUNT(*) = 1
  ) unique_advance_expenses
    ON unique_advance_expenses.`branch_id` = `erp_expenses`.`branch_id`
    AND unique_advance_expenses.`amount` = `erp_expenses`.`amount`
    AND unique_advance_expenses.`created_at` = `erp_expenses`.`created_at`
    AND unique_advance_expenses.`description` = `erp_expenses`.`description`
  WHERE `erp_expenses`.`name` = 'advance'
    AND `erp_expenses`.`kind` = 'expense'
    AND `erp_expenses`.`status` = 'active'
) unique_expense
  ON unique_expense.`amount` = `advances`.`amount`
  AND unique_expense.`created_at` = `advances`.`created_at`
  AND unique_expense.`description` = CONCAT('advance for employee ', `employees`.`full_name`)
  AND unique_expense.`branch_id` = COALESCE((
    SELECT `employee_branch_assignments`.`branch_id`
    FROM `employee_branch_assignments`
    WHERE `employee_branch_assignments`.`employee_id` = `advances`.`employee_id`
      AND `employee_branch_assignments`.`effective_from` <= `advances`.`created_at`
      AND (
        `employee_branch_assignments`.`effective_to` IS NULL
        OR `employee_branch_assignments`.`effective_to` > `advances`.`created_at`
      )
    ORDER BY `employee_branch_assignments`.`effective_from` DESC
    LIMIT 1
  ), `employees`.`branch_id`)
SET `advances`.`expense_id` = unique_expense.`id`
WHERE `advances`.`expense_id` IS NULL;--> statement-breakpoint
ALTER TABLE `advances` ADD CONSTRAINT `advances_expense_id_unique` UNIQUE (`expense_id`);--> statement-breakpoint
ALTER TABLE `advances` ADD CONSTRAINT `advances_expense_fk` FOREIGN KEY (`expense_id`) REFERENCES `erp_expenses` (`id`);
