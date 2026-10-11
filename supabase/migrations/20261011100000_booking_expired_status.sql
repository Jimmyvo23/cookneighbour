-- T-042 (D-19): a `requested` booking that nobody answers in time becomes `expired`.
-- This file only adds the enum value. It is a separate migration on purpose: a new enum value
-- cannot be used in the transaction that adds it, and the next migration uses it.
alter type public.booking_status add value if not exists 'expired';
