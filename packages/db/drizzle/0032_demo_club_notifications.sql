-- Deliveries of a demo club (`club.is_demo`, ADR 0055) are skipped with their own reason (#177).
ALTER TYPE "public"."notification_skip_reason" ADD VALUE 'demo_club';
