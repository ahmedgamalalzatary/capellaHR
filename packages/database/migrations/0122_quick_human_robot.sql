ALTER TABLE `erp_products` ADD `match_key` varchar(64) DEFAULT '' NOT NULL;--> statement-breakpoint
-- Every existing product gets the same key a create would have written. The
-- normalization must match `normalizeMatchName` exactly: lower-case, drop the
-- Arabic diacritics, fold أ/إ/آ to ا, ة to ه and ى to ي, then collapse runs of
-- whitespace. MySQL's REGEXP_REPLACE replaces every occurrence, like the /g flag.
UPDATE `erp_products`
SET `match_key` = SHA2(
	TRIM(
		REGEXP_REPLACE(
			REGEXP_REPLACE(
				REGEXP_REPLACE(
					REGEXP_REPLACE(
						REGEXP_REPLACE(
							LOWER(TRIM(`name`)),
							'[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06ED]',
							''
						),
						'[أإآ]',
						'ا'
					),
					'ة',
					'ه'
				),
				'ى',
				'ي'
			),
			'[[:space:]]+',
			' '
		)
	),
	256
);--> statement-breakpoint
CREATE INDEX `erp_products_branch_match_key_idx` ON `erp_products` (`branch_id`,`match_key`);
