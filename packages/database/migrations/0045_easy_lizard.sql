CREATE TABLE `erp_categories` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`type` enum('service','expense') NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_normalized` varchar(64) NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`has_ever_been_referenced` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_categories_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_categories_branch_type_name_unique` UNIQUE(`branch_id`,`type`,`name_normalized`)
);
--> statement-breakpoint
CREATE TABLE `erp_service_commission_overrides` (
	`id` int AUTO_INCREMENT NOT NULL,
	`service_id` int NOT NULL,
	`employee_id` int NOT NULL,
	`commission_percent` decimal(5,2) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_service_commission_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_service_commission_overrides_unique` UNIQUE(`service_id`,`employee_id`),
	CONSTRAINT `erp_service_commission_overrides_range` CHECK(`erp_service_commission_overrides`.`commission_percent` between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE `erp_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`category_id` int NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_normalized` varchar(64) NOT NULL,
	`description` varchar(1000),
	`price` decimal(12,2) NOT NULL,
	`commission_percent` decimal(5,2) NOT NULL DEFAULT '0.00',
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_services_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_services_branch_name_unique` UNIQUE(`branch_id`,`name_normalized`),
	CONSTRAINT `erp_services_price_positive` CHECK(`erp_services`.`price` > 0),
	CONSTRAINT `erp_services_commission_range` CHECK(`erp_services`.`commission_percent` between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE `erp_categories` ADD CONSTRAINT `erp_categories_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_commission_overrides` ADD CONSTRAINT `erp_service_commission_overrides_service_id_erp_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `erp_services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_service_commission_overrides` ADD CONSTRAINT `erp_service_commission_overrides_employee_id_employees_id_fk` FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_services` ADD CONSTRAINT `erp_services_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_services` ADD CONSTRAINT `erp_services_category_id_erp_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `erp_categories`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_categories_branch_type_active_idx` ON `erp_categories` (`branch_id`,`type`,`is_active`);--> statement-breakpoint
CREATE INDEX `erp_service_commission_overrides_employee_idx` ON `erp_service_commission_overrides` (`employee_id`);--> statement-breakpoint
CREATE INDEX `erp_services_branch_category_idx` ON `erp_services` (`branch_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `erp_services_branch_active_idx` ON `erp_services` (`branch_id`,`is_active`);