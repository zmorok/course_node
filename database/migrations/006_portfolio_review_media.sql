ALTER TABLE workify.portfolio_items
    ADD COLUMN experience text NOT NULL DEFAULT '' CHECK (length(experience) <= 5000),
    ADD COLUMN skills text[] NOT NULL DEFAULT '{}' CHECK (cardinality(skills) <= 50 AND array_position(skills,NULL) IS NULL);
CREATE TABLE workify.review_files (
    review_id uuid NOT NULL REFERENCES workify.reviews(id) ON DELETE CASCADE,
    file_id uuid NOT NULL REFERENCES workify.stored_files(id) ON DELETE RESTRICT,
    PRIMARY KEY (review_id,file_id)
);
CREATE INDEX review_files_file_idx ON workify.review_files(file_id);
