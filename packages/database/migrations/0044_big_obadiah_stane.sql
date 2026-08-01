CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`branch_id` int NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`phone` varchar(11) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`),
	CONSTRAINT `clients_branch_phone_unique` UNIQUE(`branch_id`,`phone`),
	CONSTRAINT `clients_phone_format` CHECK(`clients`.`phone` regexp '^01[0125][0-9]{8}$')
);
--> statement-breakpoint
ALTER TABLE `clients` ADD CONSTRAINT `clients_branch_id_branches_id_fk` FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `clients_branch_name_idx` ON `clients` (`branch_id`,`full_name`);