-- Full-text song search (DOCUMENTATION.md §5.3). A regular (content-storing)
-- FTS5 table so snippet() works; `song_id` is UNINDEXED. The tokenizer
-- folds diacritics, so "olorun" finds "Ọlọ́run" and "anyi" finds "anyị".
-- Rows are maintained by the songs repository on every write.
CREATE VIRTUAL TABLE `songs_fts` USING fts5(
	song_id UNINDEXED,
	title,
	artist,
	lyrics_plain,
	tags,
	tokenize = 'unicode61 remove_diacritics 2'
);
