ALTER TABLE `advance_installments` DROP FOREIGN KEY `advance_installments_advance_id_advances_id_fk`;
--> statement-breakpoint
ALTER TABLE `advance_installments` DROP FOREIGN KEY `advance_installments_employee_id_employees_id_fk`;
--> statement-breakpoint
ALTER TABLE `advances` ADD CONSTRAINT `advances_id_employee_unique` UNIQUE(`id`,`employee_id`);--> statement-breakpoint
ALTER TABLE `advance_installments` ADD CONSTRAINT `advance_installments_advance_employee_fk` FOREIGN KEY (`advance_id`,`employee_id`) REFERENCES `advances`(`id`,`employee_id`) ON DELETE no action ON UPDATE no action;