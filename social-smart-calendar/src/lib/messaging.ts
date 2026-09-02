import { supabase } from "@/integrations/supabase/client";

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type MessageKind = "text" | "gif" | "sticker";

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  kind: MessageKind;
  body: string | null;
  media_url: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
};

export type Reaction = {
  message_id: string;
  user_id: string;
  emoji: string;
};

export type Member = {
  conversation_id: string;
  user_id: string;
  role: string;
  last_read_at: string;
  profile: Profile | null;
};

export type Conversation = {
  id: string;
  is_group: boolean;
  title: string | null;
  created_by: string;
  created_at: string;
  last_message_at: string;
};

export type ConversationSummary = Conversation & {
  members: Member[];
  lastMessage: Message | null;
  unread: number;
};

/** Newest messages loaded when a conversation is opened. */
const HISTORY_LIMIT = 300;

export function conversationTitle(c: ConversationSummary | null, meId: string | null) {
  if (!c) return "Conversation";
  if (c.title) return c.title;
  const others = c.members.filter((m) => m.user_id !== meId);
  if (others.length === 0) return "Just you";
  const names = others.map((m) => m.profile?.display_name ?? "Member");
  if (!c.is_group) return names[0] ?? "Direct message";
  return names.slice(0, 3).join(", ") + (names.length > 3 ? ` +${names.length - 3}` : "");
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("");
}

export function messagePreview(m: Message | null): string {
  if (!m) return "No messages yet";
  if (m.deleted_at) return "Message deleted";
  if (m.kind === "gif") return "GIF";
  if (m.kind === "sticker") return m.body ?? "Sticker";
  return m.body ?? "";
}

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "now";
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = Math.round(hr / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function clockTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function fetchConversations(meId: string): Promise<ConversationSummary[]> {
  const { data: mine, error: mineErr } = await supabase
    .from("conversation_members")
    .select("conversation_id, last_read_at")
    .eq("user_id", meId);
  if (mineErr) throw mineErr;
  const ids = (mine ?? []).map((m) => m.conversation_id);
  if (ids.length === 0) return [];

  const [convRes, memberRes, overview] = await Promise.all([
    supabase.from("conversations").select("*").in("id", ids).order("last_message_at", { ascending: false }),
    supabase.from("conversation_members").select("*").in("conversation_id", ids),
    inboxOverview(ids, meId),
  ]);
  if (convRes.error) throw convRes.error;
  if (memberRes.error) throw memberRes.error;

  const memberRows = memberRes.data ?? [];
  const profiles = await fetchProfiles([...new Set(memberRows.map((m) => m.user_id))]);

  return (convRes.data ?? []).map((c) => {
    const members: Member[] = memberRows
      .filter((m) => m.conversation_id === c.id)
      .map((m) => ({ ...m, profile: profiles.get(m.user_id) ?? null }));
    const summary = overview.get(c.id);
    return {
      ...(c as Conversation),
      members,
      lastMessage: summary?.lastMessage ?? null,
      unread: summary?.unread ?? 0,
    };
  });
}

type InboxSummary = { unread: number; lastMessage: Message | null };

type OverviewRow = {
  conversation_id: string;
  unread: number;
  last_message_id: string | null;
};

/**
 * Last message and unread count per conversation.
 *
 * Prefers the `conversation_overview` RPC, which counts in the database and stays
 * correct however long the history gets. Falls back to a windowed client-side scan
 * when that migration hasn't been applied yet — that window can under-count once a
 * busy conversation pushes older unread messages out of it, so applying the
 * migration is worth doing.
 */
async function inboxOverview(ids: string[], meId: string): Promise<Map<string, InboxSummary>> {
  // Typed loosely on purpose: `conversation_overview` only lands in the generated
  // Database types after `supabase gen types` is re-run against migration 0003.
  const rpc = supabase.rpc as unknown as (
    fn: "conversation_overview",
  ) => Promise<{ data: OverviewRow[] | null; error: { message: string } | null }>;

  let rows: OverviewRow[];
  try {
    const { data, error } = await rpc("conversation_overview");
    if (error) return windowedOverview(ids, meId);
    rows = data ?? [];
  } catch {
    return windowedOverview(ids, meId);
  }

  const map = new Map<string, InboxSummary>();
  const lastIds = rows.map((r) => r.last_message_id).filter((v): v is string => Boolean(v));
  const lastMessages = new Map<string, Message>();
  if (lastIds.length > 0) {
    const { data } = await supabase.from("messages").select("*").in("id", lastIds);
    for (const m of (data ?? []) as Message[]) lastMessages.set(m.id, m);
  }
  for (const r of rows) {
    map.set(r.conversation_id, {
      unread: r.unread ?? 0,
      lastMessage: r.last_message_id ? (lastMessages.get(r.last_message_id) ?? null) : null,
    });
  }
  return map;
}

async function windowedOverview(ids: string[], meId: string): Promise<Map<string, InboxSummary>> {
  const map = new Map<string, InboxSummary>();
  const [{ data: mine }, { data: msgs }] = await Promise.all([
    supabase
      .from("conversation_members")
      .select("conversation_id, last_read_at")
      .eq("user_id", meId)
      .in("conversation_id", ids),
    supabase
      .from("messages")
      .select("*")
      .in("conversation_id", ids)
      .order("created_at", { ascending: false })
      .limit(400),
  ]);

  const lastRead = new Map(
    (mine ?? []).map((m) => [m.conversation_id, new Date(m.last_read_at).getTime()]),
  );
  for (const m of (msgs ?? []) as Message[]) {
    const current = map.get(m.conversation_id) ?? { unread: 0, lastMessage: null };
    if (!current.lastMessage) current.lastMessage = m;
    if (m.sender_id !== meId && new Date(m.created_at).getTime() > (lastRead.get(m.conversation_id) ?? 0)) {
      current.unread += 1;
    }
    map.set(m.conversation_id, current);
  }
  return map;
}

export async function fetchProfiles(ids: string[]): Promise<Map<string, Profile>> {
  const map = new Map<string, Profile>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", ids);
  for (const p of data ?? []) map.set(p.id, p as Profile);
  return map;
}

export async function searchProfiles(term: string, meId: string): Promise<Profile[]> {
  let q = supabase.from("profiles").select("id, display_name, avatar_url").neq("id", meId).limit(20);
  if (term.trim()) q = q.ilike("display_name", `%${term.trim()}%`);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function fetchConversation(id: string, meId: string) {
  const [convRes, memberRes, msgRes] = await Promise.all([
    supabase.from("conversations").select("*").eq("id", id).maybeSingle(),
    supabase.from("conversation_members").select("*").eq("conversation_id", id),
    // Newest first, then flipped below. Ordering ascending with a limit would have
    // returned the OLDEST messages and hidden everything recent in a long history.
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT),
  ]);
  if (convRes.error) throw convRes.error;
  if (memberRes.error) throw memberRes.error;
  if (msgRes.error) throw msgRes.error;
  if (!convRes.data) return null;

  const memberRows = memberRes.data ?? [];
  const profiles = await fetchProfiles([...new Set(memberRows.map((m) => m.user_id))]);
  const members: Member[] = memberRows.map((m) => ({
    ...m,
    profile: profiles.get(m.user_id) ?? null,
  }));
  const messages = ((msgRes.data ?? []) as Message[]).reverse();

  const reactions: Reaction[] = messages.length
    ? (((
        await supabase
          .from("message_reactions")
          .select("message_id, user_id, emoji")
          .in(
            "message_id",
            messages.map((m) => m.id),
          )
      ).data ?? []) as Reaction[])
    : [];

  const summary: ConversationSummary = {
    ...(convRes.data as Conversation),
    members,
    lastMessage: messages[messages.length - 1] ?? null,
    unread: 0,
  };
  return { conversation: summary, messages, reactions, meId };
}

export async function createConversation(opts: {
  meId: string;
  memberIds: string[];
  isGroup: boolean;
  title?: string | null;
}) {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ is_group: opts.isGroup, title: opts.title ?? null, created_by: opts.meId })
    .select("id")
    .single();
  if (error) throw error;
  const rows = [
    { conversation_id: data.id, user_id: opts.meId, role: "admin" },
    ...opts.memberIds
      .filter((id) => id !== opts.meId)
      .map((id) => ({ conversation_id: data.id, user_id: id, role: "member" })),
  ];
  const { error: memErr } = await supabase.from("conversation_members").insert(rows);
  if (memErr) {
    // Without members the conversation is invisible to everyone, including its
    // creator — drop it rather than leaving an orphan row behind.
    await supabase.from("conversations").delete().eq("id", data.id);
    throw memErr;
  }
  return data.id as string;
}

export async function findDirectConversation(meId: string, otherId: string) {
  const { data } = await supabase
    .from("conversation_members")
    .select("conversation_id, conversations!inner(is_group)")
    .eq("user_id", meId);
  const candidates = (data ?? [])
    .filter((r) => !(r.conversations as unknown as { is_group: boolean }).is_group)
    .map((r) => r.conversation_id);
  if (candidates.length === 0) return null;
  const { data: others } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", otherId)
    .in("conversation_id", candidates);
  return others?.[0]?.conversation_id ?? null;
}

export async function sendMessage(input: {
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  body?: string | null;
  mediaUrl?: string | null;
  replyToId?: string | null;
}) {
  const { data, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      kind: input.kind,
      body: input.body ?? null,
      media_url: input.mediaUrl ?? null,
      reply_to_id: input.replyToId ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Message;
}

export async function editMessage(id: string, body: string) {
  const { error } = await supabase
    .from("messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteForEveryone(id: string) {
  const { error } = await supabase
    .from("messages")
    .update({ deleted_at: new Date().toISOString(), body: null, media_url: null })
    .eq("id", id);
  if (error) throw error;
}

export async function toggleReaction(messageId: string, userId: string, emoji: string, on: boolean) {
  if (on) {
    const { error } = await supabase
      .from("message_reactions")
      .insert({ message_id: messageId, user_id: userId, emoji });
    if (error && error.code !== "23505") throw error;
  } else {
    const { error } = await supabase
      .from("message_reactions")
      .delete()
      .eq("message_id", messageId)
      .eq("user_id", userId)
      .eq("emoji", emoji);
    if (error) throw error;
  }
}

export async function markRead(conversationId: string, userId: string) {
  await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

export async function setTyping(conversationId: string, userId: string) {
  await supabase
    .from("typing_indicators")
    .upsert(
      { conversation_id: conversationId, user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "conversation_id,user_id" },
    );
}

export async function clearTyping(conversationId: string, userId: string) {
  await supabase
    .from("typing_indicators")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
}

export async function addMembers(conversationId: string, ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase
    .from("conversation_members")
    .insert(ids.map((id) => ({ conversation_id: conversationId, user_id: id, role: "member" })));
  if (error) throw error;
}

export async function removeMember(conversationId: string, userId: string) {
  const { error } = await supabase
    .from("conversation_members")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function renameConversation(conversationId: string, title: string) {
  const { error } = await supabase
    .from("conversations")
    .update({ title: title.trim() || null })
    .eq("id", conversationId);
  if (error) throw error;
}
