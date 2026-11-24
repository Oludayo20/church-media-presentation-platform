CREATE TABLE `media_asset_tags` (
	`asset_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`asset_id`, `tag_id`),
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `media_tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `media_asset_tags_tag_idx` ON `media_asset_tags` (`tag_id`);--> statement-breakpoint
CREATE TABLE `media_licences` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`licence_type` text NOT NULL,
	`source` text,
	`attribution` text,
	`terms` text,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_licences_asset_uq` ON `media_licences` (`asset_id`);--> statement-breakpoint
CREATE TABLE `media_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_tags_church_name_uq` ON `media_tags` (`church_id`,`name`);--> statement-breakpoint
ALTER TABLE `media_assets` ADD `has_audio` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `transcode_reason` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `playback_warning` text;