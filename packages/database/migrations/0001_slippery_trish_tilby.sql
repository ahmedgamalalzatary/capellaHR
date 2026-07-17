CREATE TABLE `admin_credentials` (
	`id` int NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `admin_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_credentials_email_unique` UNIQUE(`email`)
);
