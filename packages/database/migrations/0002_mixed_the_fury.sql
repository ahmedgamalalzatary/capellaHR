CREATE TABLE `branches` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`name_normalized` varchar(255) NOT NULL,
	`location` varchar(1000) NOT NULL,
	`latitude` double NOT NULL,
	`longitude` double NOT NULL,
	`gps_accuracy_meters` double NOT NULL,
	`attendance_radius_meters` double NOT NULL,
	`has_ever_been_referenced` boolean NOT NULL DEFAULT false,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `branches_id` PRIMARY KEY(`id`),
	CONSTRAINT `branches_name_normalized_unique` UNIQUE(`name_normalized`)
);
