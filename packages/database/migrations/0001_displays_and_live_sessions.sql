CREATE TABLE `display_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`name` text NOT NULL,
	`fingerprint` text NOT NULL,
	`role` text DEFAULT 'main' NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`church_id`) REFERENCES `churches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `display_profiles_church_fingerprint_uq` ON `display_profiles` (`church_id`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `live_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`church_id` text NOT NULL,
	`service_id` text,
	`display_profile_id` text,
	`current_item_id` text,
	`current_slide_index` integer DEFAULT 0 NOT NULL,
	`overlay_stack_json` text DEFAULT '[]' NOT NULL,
	`playback_state_json` text,
	`started_at` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `live_sessions_ended_at_idx` ON `live_sessions` (`ended_at`);