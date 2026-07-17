CREATE TABLE `employee_code_sequence` (
	`id` int NOT NULL,
	`next_code` int NOT NULL,
	CONSTRAINT `employee_code_sequence_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `employee_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_id` int NOT NULL,
	`kind` enum('personal','idFront','idBack') NOT NULL,
	`storage_path` varchar(500) NOT NULL,
	`original_name` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size_bytes` int NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `employee_images_id` PRIMARY KEY(`id`),
	CONSTRAINT `employee_images_employee_kind_unique` UNIQUE(`employee_id`,`kind`)
);
--> statement-breakpoint
CREATE TABLE `employee_phone_reservations` (
	`phone` varchar(11) NOT NULL,
	`employee_id` int NOT NULL,
	CONSTRAINT `employee_phone_reservations_phone` PRIMARY KEY(`phone`)
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` int AUTO_INCREMENT NOT NULL,
	`employee_code` int NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`personal_phone` varchar(11) NOT NULL,
	`whatsapp_phone` varchar(11) NOT NULL,
	`pin_hash` varchar(255) NOT NULL,
	`age` int NOT NULL,
	`address` varchar(1000) NOT NULL,
	`branch_id` int NOT NULL,
	`shift_duration_minutes` int NOT NULL,
	`monthly_base_salary` decimal(12,2) NOT NULL,
	`deleted_at` timestamp(3),
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `employees_id` PRIMARY KEY(`id`),
	CONSTRAINT `employees_employee_code_unique` UNIQUE(`employee_code`)
);
--> statement-breakpoint
ALTER TABLE `employee_images` ADD CONSTRAINT `employee_images_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employee_phone_reservations` ADD CONSTRAINT `employee_phone_reservations_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `employees` ADD CONSTRAINT `employees_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;