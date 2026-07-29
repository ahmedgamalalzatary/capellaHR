DELETE `employee_phone_reservations`
FROM `employee_phone_reservations`
INNER JOIN `employees`
	ON `employees`.`id` = `employee_phone_reservations`.`employee_id`
WHERE `employees`.`deleted_at` IS NOT NULL;
