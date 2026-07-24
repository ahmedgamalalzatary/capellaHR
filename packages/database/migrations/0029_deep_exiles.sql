ALTER TABLE `advance_installments` DROP CONSTRAINT `advance_installments_ordinal_range`;--> statement-breakpoint
ALTER TABLE `advances` DROP CONSTRAINT `advances_installment_count_range`;--> statement-breakpoint
ALTER TABLE `advance_installments` ADD CONSTRAINT `advance_installments_ordinal_range` CHECK (`advance_installments`.`ordinal` between 1 and 12);--> statement-breakpoint
ALTER TABLE `advances` ADD CONSTRAINT `advances_installment_count_range` CHECK (`advances`.`installment_count` between 1 and 12);