import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchConversation,
  fetchConversations,
  markRead,
  type ConversationSummary,
  type Member,
  type Message,
  type Reaction,
} from "@/lib/messaging";

type Status = "idle" | "loading" | "ready" | "error";

const REALTIME_COALESCE_MS = 400;
const MARK_READ_THROTTLE_MS = 1500;
const TYPING_TTL_MS = 6000;

/**
 * Collapses a burst of realtime events into one trailing call, so an active
 * conversation refetches once per window instead of once per event.
 */
function useCoalesced(fn: () => void, delay: number) {
  const latest = useRef(fn);
  latest.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      latest.current();
    }, delay);
  }, [delay]);
}

/** Inbox list with realtime refresh. */
export function useInbox(meId: string | null) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!meId) {
        setConversations([]);
        setStatus("idle");
        return;
      }
      if (!quiet) setStatus("loading");
      try {
        setConversations(await fetchConversations(meId));
        setError(null);
        setStatus("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load your messages.");
        setStatus("error");
      }
    },
    [meId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCoalesced(() => void load(true), REALTIME_COALESCE_MS);

  useEffect(() => {
    if (!meId) return;
    const channel = supabase
      .channel(`inbox-${meId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations" }, refresh)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meId, refresh]);

  return { conversations, status, error, reload: load };
}

export type TypingUser = { userId: string; at: number };

/** One conversation: messages, reactions, typing indicators, read receipts. */
export function useConversationView(conversationId: string, meId: string | null) {
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [typing, setTyping] = useState<TypingUser[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const lastMarked = useRef(0);
  const visibleMessageIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    visibleMessageIds.current = new Set(messages.map((m) => m.id));
  }, [messages]);

  const load = useCallback(
    async (quiet = false) => {
      if (!meId) return;
      if (!quiet) setStatus("loading");
      try {
        const res = await fetchConversation(conversationId, meId);
        if (!res) {
          setError("This conversation isn't available.");
          setStatus("error");
          return;
        }
        setConversation(res.conversation);
        setMessages(res.messages);
        setReactions(res.reactions);
        setError(null);
        setStatus("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load this conversation.");
        setStatus("error");
      }
    },
    [conversationId, meId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Mark read whenever the newest message changes (throttled). Keyed on the id
  // rather than the count, so an edit-plus-arrival that leaves the length
  // unchanged still registers.
  const newestMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    if (!meId || status !== "ready" || !newestMessageId) return;
    const now = Date.now();
    if (now - lastMarked.current < MARK_READ_THROTTLE_MS) return;
    lastMarked.current = now;
    void markRead(conversationId, meId);
  }, [newestMessageId, meId, conversationId, status]);

  const refresh = useCoalesced(() => void load(true), REALTIME_COALESCE_MS);

  useEffect(() => {
    if (!meId) return;
    const here = `conversation_id=eq.${conversationId}`;
    const channel = supabase
      .channel(`conversation-${conversationId}`)
      // Rows arrive complete (REPLICA IDENTITY FULL), so message events are applied
      // straight to state instead of refetching the whole conversation each time.
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: here },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "messages", filter: here },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) => prev.map((m) => (m.id === row.id ? row : m)));
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "messages", filter: here },
        (payload) => {
          const row = payload.old as Partial<Message>;
          if (row.id) setMessages((prev) => prev.filter((m) => m.id !== row.id));
        },
      )
      // Reactions can't be filtered by conversation, so ignore any that belong to
      // messages this view isn't showing.
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "message_reactions" },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const old = payload.old as Partial<Reaction>;
            if (!old.message_id || !visibleMessageIds.current.has(old.message_id)) return;
            setReactions((prev) =>
              prev.filter(
                (r) =>
                  !(
                    r.message_id === old.message_id &&
                    r.user_id === old.user_id &&
                    r.emoji === old.emoji
                  ),
              ),
            );
            return;
          }
          const row = payload.new as Reaction;
          if (!row.message_id || !visibleMessageIds.current.has(row.message_id)) return;
          setReactions((prev) =>
            prev.some(
              (r) =>
                r.message_id === row.message_id &&
                r.user_id === row.user_id &&
                r.emoji === row.emoji,
            )
              ? prev
              : [...prev, row],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_members", filter: here },
        (payload) => {
          // A read receipt is just last_read_at moving; only joins and leaves need
          // the profile lookup that a full reload does.
          if (payload.eventType !== "UPDATE") {
            refresh();
            return;
          }
          const row = payload.new as Pick<Member, "user_id" | "last_read_at">;
          setConversation((prev) =>
            prev
              ? {
                  ...prev,
                  members: prev.members.map((m) =>
                    m.user_id === row.user_id ? { ...m, last_read_at: row.last_read_at } : m,
                  ),
                }
              : prev,
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "typing_indicators", filter: here },
        (payload) => {
          const row = (payload.eventType === "DELETE" ? payload.old : payload.new) as
            | { user_id?: string }
            | undefined;
          const userId = row?.user_id;
          if (!userId || userId === meId) return;
          if (payload.eventType === "DELETE") {
            setTyping((prev) => prev.filter((t) => t.userId !== userId));
            return;
          }
          setTyping((prev) => [...prev.filter((t) => t.userId !== userId), { userId, at: Date.now() }]);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
        refresh,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, meId, refresh]);

  // Expire stale typing state, keeping the same array when nothing aged out so
  // the interval doesn't re-render the conversation every two seconds.
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((prev) => {
        const fresh = prev.filter((x) => Date.now() - x.at < TYPING_TTL_MS);
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return { conversation, messages, reactions, typing, status, error, reload: load, setMessages };
}
