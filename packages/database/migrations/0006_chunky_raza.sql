UPDATE `branches` SET `name_normalized` = SHA2(`name_normalized`, 256);--> statement-breakpoint
ALTER TABLE `branches` MODIFY COLUMN `name_normalized` varchar(64) NOT NULL;--> statement-breakpoint
ALTER TABLE `employees` ADD `credential_version` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_latitude_range` CHECK (`branches`.`latitude` between -90 and 90);--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_longitude_range` CHECK (`branches`.`longitude` between -180 and 180);--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_accuracy_nonnegative` CHECK (`branches`.`gps_accuracy_meters` >= 0);--> statement-breakpoint
ALTER TABLE `branches` ADD CONSTRAINT `branches_radius_positive` CHECK (`branches`.`attendance_radius_meters` > 0);--> statement-breakpoint
ALTER TABLE `employee_code_sequence` ADD CONSTRAINT `employee_code_sequence_singleton` CHECK (`employee_code_sequence`.`id` = 1);--> statement-breakpoint
ALTER TABLE `employee_code_sequence` ADD CONSTRAINT `employee_code_sequence_positive` CHECK (`employee_code_sequence`.`next_code` > 0);--> statement-breakpoint
ALTER TABLE `employee_images` ADD CONSTRAINT `employee_images_size_range` CHECK (`employee_images`.`size_bytes` between 1 and 16777216);--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_code_positive` CHECK (`employees`.`employee_code` > 0);--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_personal_phone_format` CHECK (`employees`.`personal_phone` regexp '^01[0125][0-9]{8}$');--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_whatsapp_phone_format` CHECK (`employees`.`whatsapp_phone` regexp '^01[0125][0-9]{8}$');
