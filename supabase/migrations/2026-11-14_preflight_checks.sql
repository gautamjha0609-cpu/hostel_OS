-- =====================================================================
-- PREFLIGHT INTEGRITY CHECKS FOR HOSTELOS / SARVLEKH
-- Run this in Supabase SQL Editor BEFORE running production_hardening.sql.
-- ALL 4 queries below should return ZERO rows.
-- If any rows are returned, resolve them before applying constraints.
-- =====================================================================

-- 1. Check for duplicate active/notice residents on the exact same bed
-- If rows appear: multiple active residents occupy the same physical bed.
SELECT 
  hostel_id, 
  room_id, 
  data->>'bed' AS bed_id, 
  count(*) AS resident_count,
  array_agg(id) AS resident_ids, 
  array_agg(data->>'name') AS resident_names
FROM public.docs
WHERE kind = 'res' 
  AND NOT deleted 
  AND (data->>'status') IN ('active', 'notice')
  AND room_id IS NOT NULL 
  AND (data->>'bed') IS NOT NULL 
  AND (data->>'bed') <> ''
GROUP BY hostel_id, room_id, data->>'bed'
HAVING count(*) > 1;

-- 2. Check for active residents with missing/empty room_id
-- If rows appear: assign valid room IDs or mark them as checked out ('left').
SELECT 
  hostel_id, 
  id AS resident_id, 
  data->>'name' AS resident_name, 
  data->>'status' AS status
FROM public.docs
WHERE kind = 'res' 
  AND NOT deleted 
  AND (data->>'status') IN ('active', 'notice')
  AND (room_id IS NULL OR room_id = '' OR (data->>'roomId') IS NULL OR (data->>'roomId') = '');

-- 3. Check for active residents with missing/empty bed identifier
-- If rows appear: assign valid bed identifiers or mark them as checked out ('left').
SELECT 
  hostel_id, 
  id AS resident_id, 
  room_id, 
  data->>'name' AS resident_name, 
  data->>'status' AS status
FROM public.docs
WHERE kind = 'res' 
  AND NOT deleted 
  AND (data->>'status') IN ('active', 'notice')
  AND ((data->>'bed') IS NULL OR (data->>'bed') = '');

-- 4. Check for active residents assigned to non-existent room documents
-- If rows appear: the room document was deleted or ID was misconfigured.
SELECT 
  r.hostel_id, 
  r.id AS resident_id, 
  r.room_id, 
  r.data->>'name' AS resident_name
FROM public.docs r
LEFT JOIN public.docs rm
  ON rm.hostel_id = r.hostel_id 
 AND rm.id = r.room_id 
 AND rm.kind = 'room' 
 AND NOT rm.deleted
WHERE r.kind = 'res' 
  AND NOT r.deleted 
  AND (r.data->>'status') IN ('active', 'notice')
  AND rm.id IS NULL;
