ALTER TABLE workify.profiles
    ADD COLUMN middle_name varchar(100),
    ADD COLUMN gender varchar(10) CHECK (gender IN ('Male', 'Female', 'Other'));

CREATE OR REPLACE VIEW workify.v_public_profiles AS
SELECT u.id AS user_id, u.username, p.first_name, p.last_name, p.headline, p.description,
    p.city, p.country, pf.file_id AS avatar_file_id,
    r.customer_rating, r.customer_review_count, r.freelancer_rating, r.freelancer_review_count,
    p.middle_name, p.gender, u.last_online_at
FROM workify.users u
JOIN workify.profiles p ON p.user_id = u.id
JOIN workify.v_user_ratings r ON r.user_id = u.id
LEFT JOIN workify.profile_files pf ON pf.user_id = u.id
WHERE u.role = 'CLIENT'
    AND (u.status = 'ACTIVE' OR (u.blocked_until IS NOT NULL AND u.blocked_until <= now()));
