-- Migration 0115 gave every booked service a lifecycle of its own, and left the
-- rows that already existed with the default status. A booking that never sold
-- anything was finished the other way: cancelling it, or recording a no-show,
-- cancelled every service it held. Those rows would otherwise stay 'pending'
-- forever, counting as work still to do and blocking the shift close.
UPDATE `erp_booking_services` `s`
JOIN `erp_bookings` `b` ON `b`.`id` = `s`.`booking_id` AND `b`.`branch_id` = `s`.`branch_id`
SET
	`s`.`status` = 'cancelled',
	`s`.`changed_at` = `b`.`updated_at`
WHERE `b`.`status` IN ('cancelled', 'no_show')
	AND `s`.`status` = 'pending';