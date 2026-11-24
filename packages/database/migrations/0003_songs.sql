CREATE TABLE `song_arrangements` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`name` text NOT NULL,
	`section_ids_json` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_arrangements_song_idx` ON `song_arrangements` (`song_id`);--> statement-breakpoint
CREATE TABLE `song_collection_items` (
	`collection_id` text NOT NULL,
	`song_id` text NOT NULL,
	PRIMARY KEY(`collection_id`, `song_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `song_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_collection_items_song_idx` ON `song_collection_items` (`song_id`);--> statement-breakpoint
CREATE TABLE `song_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `song_collections_church_name_uq` ON `song_collections` (`church_id`,`name`);--> statement-breakpoint
CREATE TABLE `song_sections` (
	`id` text PRIMARY KEY NOT NULL,
	`song_id` text NOT NULL,
	`section_type` text NOT NULL,
	`label` text NOT NULL,
	`section_order` integer NOT NULL,
	`lyrics` text NOT NULL,
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_sections_song_idx` ON `song_sections` (`song_id`,`section_order`);--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text,
	`language` text DEFAULT 'en' NOT NULL,
	`category` text,
	`copyright_owner` text,
	`copyright_year` integer,
	`ccli_number` text,
	`licence_reference` text,
	`default_background_asset_id` text,
	`default_template_id` text,
	`tags_json` text DEFAULT '[]' NOT NULL,
	`split_json` text,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_background_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `songs_church_title_idx` ON `songs` (`church_id`,`title`);