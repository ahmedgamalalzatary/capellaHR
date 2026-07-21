CREATE INDEX `device_pairings_status_created_idx` ON `device_pairing_requests` (`status`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `devices_active_employee_assignment_idx` ON `devices` (`status`,`assignment_type`,`employee_id`);--> statement-breakpoint
CREATE INDEX `devices_active_branch_assignment_idx` ON `devices` (`status`,`assignment_type`,`branch_id`);