CREATE TABLE `service_item_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `service_item_groups_service_idx` ON `service_item_groups` (`service_id`,`position`);--> statement-breakpoint
CREATE TABLE `service_items` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`group_id` text,
	`position` integer NOT NULL,
	`item_type` text NOT NULL,
	`ref_id` text,
	`options_json` text NOT NULL,
	`label` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `service_item_groups`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "service_items_type_ck" CHECK("service_items"."item_type" IN ('presentation','song','scripture','video','image','countdown','announcement','blank','camera_placeholder'))
);
--> statement-breakpoint
CREATE INDEX `service_items_service_idx` ON `service_items` (`service_id`,`position`);--> statement-breakpoint
CREATE INDEX `service_items_ref_idx` ON `service_items` (`ref_id`);--> statement-breakpoint
CREATE TABLE `service_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`name` text NOT NULL,
	`definition_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`title` text NOT NULL,
	`service_type` text,
	`service_date` text,
	`start_time` text,
	`theme` text,
	`description` text,
	`assigned_user_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "services_status_ck" CHECK("services"."status" IN ('draft','ready','live','completed','archived'))
);
--> statement-breakpoint
CREATE INDEX `services_church_date_idx` ON `services` (`church_id`,`service_date`);--> statement-breakpoint
ALTER TABLE `songs` ADD `is_favourite` integer DEFAULT false NOT NULL;