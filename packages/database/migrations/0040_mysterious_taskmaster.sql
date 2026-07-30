CREATE TABLE `auth_login_limits` (
	`key` varchar(66) NOT NULL,
	`attempt_count` int NOT NULL DEFAULT 0,
	`window_started_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `auth_login_limits_key` PRIMARY KEY(`key`),
	CONSTRAINT `auth_login_limits_attempt_count_nonnegative` CHECK(`auth_login_limits`.`attempt_count` >= 0)
);
