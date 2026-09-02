-- Inbox summary in one round trip.
--
-- The client used to pull the most recent 400 messages across every conversation
-- and count unread ones in JavaScript. That window silently under-counts once one
-- busy chat fills it, and it grows with the mailbox rather than with the screen.
--
-- SECURITY INVOKER on purpose: row level security still applies inside the
-- function, so a caller only ever sees their own memberships and the messages
-- they are allowed to read. auth.uid() drives the whole query, so there is no
-- parameter to point at somebody else.

CREATE OR REPLACE FUNCTION public.conversation_overview()
RETURNS TABLE (
  conversation_id UUID,
  unread INTEGER,
  last_message_id UUID
) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    cm.conversation_id,
    (
      SELECT count(*)
      FROM public.messages m
      WHERE m.conversation_id = cm.conversation_id
        AND m.sender_id <> auth.uid()
        AND m.created_at > cm.last_read_at
    )::int AS unread,
    (
      SELECT m2.id
      FROM public.messages m2
      WHERE m2.conversation_id = cm.conversation_id
      ORDER BY m2.created_at DESC
      LIMIT 1
    ) AS last_message_id
  FROM public.conversation_members cm
  WHERE cm.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.conversation_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conversation_overview() TO authenticated;
