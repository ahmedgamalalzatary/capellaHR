ALTER TABLE `erp_services` DROP FOREIGN KEY `erp_services_category_id_erp_categories_id_fk`;
--> statement-breakpoint
ALTER TABLE `erp_categories` ADD CONSTRAINT `erp_categories_id_branch_unique` UNIQUE(`id`,`branch_id`);--> statement-breakpoint
ALTER TABLE `erp_services` ADD CONSTRAINT `erp_services_category_branch_fk` FOREIGN KEY (`category_id`,`branch_id`) REFERENCES `erp_categories`(`id`,`branch_id`) ON DELETE no action ON UPDATE no action;