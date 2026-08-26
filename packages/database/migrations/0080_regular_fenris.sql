ALTER TABLE `erp_booking_services` DROP FOREIGN KEY `erp_booking_services_preferred_employee_id_employees_id_fk`;
--> statement-breakpoint
ALTER TABLE `erp_bookings` DROP FOREIGN KEY `erp_bookings_invoice_id_erp_invoices_id_fk`;
--> statement-breakpoint
ALTER TABLE `erp_booking_services` ADD CONSTRAINT `erp_booking_services_preferred_employee_branch_fk` FOREIGN KEY (`preferred_employee_id`,`branch_id`) REFERENCES `employees`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_bookings` ADD CONSTRAINT `erp_bookings_invoice_branch_fk` FOREIGN KEY (`invoice_id`,`branch_id`) REFERENCES `erp_invoices`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;