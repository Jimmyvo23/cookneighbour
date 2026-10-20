-- T-048 round 3 (open point 21, Jimmy: "Close it now"): signed-in users get the same safe review
-- columns as visitors. author_id, booking_id, subject_id and author_display_name (and so `select *`)
-- are not selectable by any browser role. The two parties and the admin read their full review
-- through the server (service role, after the party or admin check). The select policies stay as
-- row filters; the insert grant and policy are unchanged (insert without returning).
revoke select on public.reviews from authenticated;
grant select (id, author_role, rating, comment, created_at) on public.reviews to authenticated;
