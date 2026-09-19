INSERT INTO `erp_expenses` (
  `branch_id`,
  `name`,
  `amount`,
  `expense_date`,
  `description`,
  `acting_account_id`,
  `kind`,
  `status`,
  `created_at`
)
SELECT
  COALESCE((
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
  ), `employees`.`branch_id`),
  'advance',
  `advances`.`amount`,
  DATE(CONVERT_TZ(`advances`.`created_at`, @@session.time_zone, 'Africa/Cairo')),
  CONCAT('advance for employee ', `employees`.`full_name`),
  (
    SELECT `accounts`.`id`
    FROM `accounts`
    WHERE `accounts`.`role` = 'admin'
      AND `accounts`.`archived_at` IS NULL
      AND `accounts`.`active` = true
    ORDER BY `accounts`.`id`
    LIMIT 1
  ),
  'expense',
  'active',
  `advances`.`created_at`
FROM `advances`
INNER JOIN `employees` ON `employees`.`id` = `advances`.`employee_id`
WHERE NOT EXISTS (
  SELECT 1
  FROM `erp_expenses`
  WHERE `erp_expenses`.`name` = 'advance'
    AND `erp_expenses`.`amount` = `advances`.`amount`
    AND `erp_expenses`.`created_at` = `advances`.`created_at`
    AND `erp_expenses`.`description` = CONCAT('advance for employee ', `employees`.`full_name`)
);
