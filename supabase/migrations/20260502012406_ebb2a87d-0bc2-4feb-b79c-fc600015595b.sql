-- Phase 4A-1.1: Reclassify milestone/workflow action types and bulk-complete stale system events.

-- 1. Extend workflow_action_type enum with 'system_event' (workflow_steps.action_type uses this enum).
ALTER TYPE workflow_action_type ADD VALUE IF NOT EXISTS 'system_event';