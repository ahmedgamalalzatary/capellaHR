ALTER TABLE `erp_booking_payments` ADD `client_id_snapshot` int;--> statement-breakpoint
ALTER TABLE `erp_booking_payments` ADD `client_name_snapshot` varchar(255);--> statement-breakpoint
ALTER TABLE `erp_booking_payments` ADD `client_phone_snapshot` varchar(11);
--> statement-breakpoint
UPDATE erp_booking_payments p JOIN erp_bookings b ON b.id = p.booking_id JOIN clients c ON c.id = b.client_id SET p.client_id_snapshot = c.id, p.client_name_snapshot = c.full_name, p.client_phone_snapshot = c.phone;
