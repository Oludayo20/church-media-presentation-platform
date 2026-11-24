CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`name` text NOT NULL,
	`document_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_church_name_uq` ON `templates` (`church_id`,`name`);