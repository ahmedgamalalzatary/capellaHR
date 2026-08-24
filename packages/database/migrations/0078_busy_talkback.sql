CREATE TABLE `erp_booking_services` (
	`id` int AUTO_INCREMENT NOT NULL,
	`booking_id` int NOT NULL,
	`branch_id` int NOT NULL,
	`service_id` int NOT NULL,
	`preferred_employee_id` int,
	CONSTRAINT `erp_booking_services_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_booking_services_booking_service_unique` UNIQUE(`booking_id`,`service_id`)
);
--> statement-breakpoint
CREATE TABLE `erp_bookings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`client_id` int NOT NULL,
	`scheduled_at` timestamp(3) NOT NULL,
	`status` enum('booked','arrived','converted','cancelled','no_show') NOT NULL DEFAULT 'booked',
	`note` varchar(1000),
	`acting_account_id` int NOT NULL,
	`invoice_id` int,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `erp_bookings_id` PRIMARY KEY(`id`),
	CONSTRAINT `erp_bookings_id_branch_unique` UNIQUE(`id`,`branch_id`),
	CONSTRAINT `erp_bookings_invoice_unique` UNIQUE(`invoice_id`)
);
--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_preferred_employee_id_employees_id_fk` FOREIGN KEY (`preferred_employee_id`) REFERENCES `employees`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_booking_branch_fk` FOREIGN KEY (`booking_id`,`branch_id`) REFERENCES `erp_bookings`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_service_branch_fk` FOREIGN KEY (`service_id`,`branch_id`) REFERENCES `erp_services`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_acting_account_id_accounts_id_fk` FOREIGN KEY (`acting_account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_invoice_id_erp_invoices_id_fk` FOREIGN KEY (`invoice_id`) REFERENCES `erp_invoices`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_client_branch_fk` FOREIGN KEY (`client_id`,`branch_id`) REFERENCES `clients`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `erp_booking_services_preferred_employee_idx` ON `erp_booking_services` (`preferred_employee_id`,`booking_id`);--> statement-breakpoint
CREATE INDEX `erp_bookings_branch_scheduled_idx` ON `erp_bookings` (`branch_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `erp_bookings_branch_status_scheduled_idx` ON `erp_bookings` (`branch_id`,`status`,`scheduled_at`);