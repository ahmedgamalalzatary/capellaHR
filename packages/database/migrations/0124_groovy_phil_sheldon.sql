ALTER TABLE `erp_products` DROP CONSTRAINT `erp_products_selling_price_positive`;--> statement-breakpoint
ALTER TABLE `erp_products` ADD `awaiting_first_stock` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `erp_products_awaiting_is_inactive` CHECK (`erp_products`.`awaiting_first_stock` = false or `erp_products`.`is_active` = false);--> statement-breakpoint
ALTER TABLE `erp_products` ADD CONSTRAINT `erp_products_selling_price_positive` CHECK (`erp_products`.`selling_price` > 0 or `erp_products`.`awaiting_first_stock` = true);