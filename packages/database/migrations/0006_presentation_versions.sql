CREATE TABLE `presentation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`version` integer NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `presentation_versions_number_uq` ON `presentation_versions` (`presentation_id`,`version`);