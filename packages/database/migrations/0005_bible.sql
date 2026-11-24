CREATE TABLE `bible_book_aliases` (
	`book_id` integer NOT NULL,
	`alias` text NOT NULL,
	PRIMARY KEY(`book_id`, `alias`),
	FOREIGN KEY (`book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `bible_books` (
	`id` integer PRIMARY KEY NOT NULL,
	`translation_code` text NOT NULL,
	`name` text NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`translation_code`) REFERENCES `bible_translations`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bible_books_position_uq` ON `bible_books` (`translation_code`,`position`);--> statement-breakpoint
CREATE TABLE `bible_translations` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`licence` text NOT NULL,
	`attribution` text NOT NULL,
	`versification` text NOT NULL,
	`checksum` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `bible_verses` (
	`id` integer PRIMARY KEY NOT NULL,
	`book_id` integer NOT NULL,
	`chapter` integer NOT NULL,
	`verse` integer NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `bible_books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bible_verses_reference_uq` ON `bible_verses` (`book_id`,`chapter`,`verse`);--> statement-breakpoint
CREATE TABLE `scripture_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripture_collections_name_unique` ON `scripture_collections` (`name`);--> statement-breakpoint
CREATE TABLE `scripture_passages` (
	`id` text PRIMARY KEY NOT NULL,
	`translation_code` text NOT NULL,
	`reference` text NOT NULL,
	`collection_id` text,
	FOREIGN KEY (`translation_code`) REFERENCES `bible_translations`(`code`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`collection_id`) REFERENCES `scripture_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scripture_passages_reference_uq` ON `scripture_passages` (`translation_code`,`reference`,`collection_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE bible_verses_fts USING fts5(text, content='bible_verses', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
--> statement-breakpoint
CREATE TRIGGER bible_verses_fts_insert AFTER INSERT ON bible_verses BEGIN
  INSERT INTO bible_verses_fts(rowid, text) VALUES (new.id, new.text);
END;
--> statement-breakpoint
CREATE TRIGGER bible_verses_fts_delete AFTER DELETE ON bible_verses BEGIN
  INSERT INTO bible_verses_fts(bible_verses_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
--> statement-breakpoint
CREATE UNIQUE INDEX scripture_favourites_uq ON scripture_passages(translation_code, reference) WHERE collection_id IS NULL;
