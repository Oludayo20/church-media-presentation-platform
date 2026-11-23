CREATE TABLE `church_members` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'media_operator' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "church_members_role_ck" CHECK("church_members"."role" IN ('owner','media_admin','media_operator','content_editor','viewer'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `church_members_church_user_uq` ON `church_members` (`church_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `churches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`logo_asset_id` text,
	`default_language` text DEFAULT 'en',
	`default_translation_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`folder_id` text,
	`name` text NOT NULL,
	`original_name` text,
	`media_type` text NOT NULL,
	`category` text,
	`mime_type` text,
	`file_path` text NOT NULL,
	`file_size` integer DEFAULT 0 NOT NULL,
	`checksum` text NOT NULL,
	`duration_ms` integer,
	`width` integer,
	`height` integer,
	`codec` text,
	`thumbnail_path` text,
	`is_favourite` integer DEFAULT false NOT NULL,
	`is_missing` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `media_folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "media_assets_media_type_ck" CHECK("media_assets"."media_type" IN ('image','video','audio','document','font'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_church_checksum_uq` ON `media_assets` (`church_id`,`checksum`);--> statement-breakpoint
CREATE INDEX `media_assets_church_category_idx` ON `media_assets` (`church_id`,`category`);--> statement-breakpoint
CREATE INDEX `media_assets_checksum_idx` ON `media_assets` (`checksum`);--> statement-breakpoint
CREATE TABLE `media_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `media_folders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `presentations` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`aspect_ratio` text DEFAULT '16:9' NOT NULL,
	`width` integer DEFAULT 1920 NOT NULL,
	`height` integer DEFAULT 1080 NOT NULL,
	`schema_version` text DEFAULT 'cmp.presentation/v1' NOT NULL,
	`is_favourite` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`church_id` text NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	PRIMARY KEY(`church_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `slide_objects` (
	`id` text PRIMARY KEY NOT NULL,
	`slide_id` text NOT NULL,
	`object_type` text NOT NULL,
	`z_index` integer DEFAULT 0 NOT NULL,
	`properties_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`slide_id`) REFERENCES `slides`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "slide_objects_object_type_ck" CHECK("slide_objects"."object_type" IN ('text','image','video','shape','bible','countdown'))
);
--> statement-breakpoint
CREATE INDEX `slide_objects_slide_idx` ON `slide_objects` (`slide_id`,`z_index`);--> statement-breakpoint
CREATE TABLE `slides` (
	`id` text PRIMARY KEY NOT NULL,
	`presentation_id` text NOT NULL,
	`position` integer NOT NULL,
	`slide_type` text NOT NULL,
	`background_type` text DEFAULT 'color' NOT NULL,
	`background_value` text,
	`background_options_json` text,
	`transition_type` text DEFAULT 'cut' NOT NULL,
	`transition_ms` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer,
	`notes` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`presentation_id`) REFERENCES `presentations`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "slides_background_type_ck" CHECK("slides"."background_type" IN ('color','gradient','image','video','transparent'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slides_presentation_position_uq` ON `slides` (`presentation_id`,`position`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`pin_hash` text,
	`created_at` text NOT NULL
);
