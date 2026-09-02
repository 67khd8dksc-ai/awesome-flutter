import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import { useConversationView } from "@/hooks/useChat";
import { MemberAvatars } from "@/components/messages/ChatAvatar";
import { Composer } from "@/components/messages/Composer";
import { MessageBubble } from "@/components/messages/MessageBubble";
import {
  clearTyping,
  conversationTitle,
  deleteForEveryone,
  editMessage,
  markRead,
  removeMember,
  renameConversation,
  sendMessage,
  setTyping,
  toggleReaction,
  type Message,
  type Reaction,
} from "@/lib/messaging";

/** How close to the bottom counts as "following along". */
const STICK_TO_BOTTOM_PX = 160;
const TYPING_PING_MS = 2500;

export const Route = createFileRoute("/messages/$id")({
  head: () => ({
    meta: [
      { title: "Conversation · Social Smart Calendar" },
      {
        name: "description",
        content:
          "A realtime conversation with replies, emoji reactions, GIFs, stickers, read receipts and typing indicators.",
      },
      { property: "og:title", content: "Conversation · Social Smart Calendar" },
      {
        property: "og:description",
        content: "Chat live with the people you're making plans with.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConversationPage,
});

function ConversationPage() {
  const { id } = Route.useParams();
  const { user, loading } = useSession();
  const meId = user?.id ?? null;
  const { conversation, messages, reactions, typing, status, error, reload } = useConversationView(
    id,
    meId,
  );
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [editing, setEditing] = useState<Message | null>(null);
  const [manage, setManage] = useState(false);
  const [title, setTitle] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const typedAt = useRef(0);
  const jumpedToBottom = useRef(false);
  const navigate = useNavigate();

  const newestMessageId = messages[messages.length - 1]?.id;

  useEffect(() => {
    jumpedToBottom.current = false;
  }, [id]);

  // Land at the newest message on open, then only follow along if the reader is
  // already near the bottom — scrolling back through history shouldn't get yanked
  // away by someone else's message.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || messages.length === 0) return;
    if (!jumpedToBottom.current) {
      jumpedToBottom.current = true;
      endRef.current?.scrollIntoView({ block: "end" });
      return;
    }
    const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
    if (distance < STICK_TO_BOTTOM_PX) {
      endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [newestMessageId, messages.length]);

  useEffect(() => {
    if (conversation) setTitle(conversation.title ?? "");
  }, [conversation?.id, conversation?.title]);

  // Leaving the page shouldn't leave a "typing…" behind for everyone else.
  useEffect(() => {
    if (!meId) return;
    return () => {
      void clearTyping(id, meId);
    };
  }, [id, meId]);

  const nameOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of conversation?.members ?? []) {
      map.set(m.user_id, m.user_id === meId ? "You" : (m.profile?.display_name ?? "Member"));
    }
    return map;
  }, [conversation, meId]);

  // Indexed once per change instead of scanning every message for every other
  // message's reply target and reactions.
  const messageById = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages]);
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, Reaction[]>();
    for (const r of reactions) {
      const list = map.get(r.message_id);
      if (list) list.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const seenCutoff = useMemo(() => {
    const others = (conversation?.members ?? []).filter((m) => m.user_id !== meId);
    if (others.length === 0) return 0;
    return Math.max(...others.map((m) => new Date(m.last_read_at).getTime()));
  }, [conversation, meId]);

  const typingNames = typing
    .map((t) => nameOf.get(t.userId))
    .filter((n): n is string => Boolean(n) && n !== "You");

  async function handleSend(m: { kind: "text" | "gif" | "sticker"; body?: string; mediaUrl?: string }) {
    if (!meId) return;
    try {
      if (editing && m.kind === "text") {
        await editMessage(editing.id, m.body ?? "");
        setEditing(null);
      } else {
        await sendMessage({
          conversationId: id,
          senderId: meId,
          kind: m.kind,
          body: m.body ?? null,
          mediaUrl: m.mediaUrl ?? null,
          replyToId: replyTo?.id ?? null,
        });
        setReplyTo(null);
      }
      // The realtime subscription applies the new row, so there's no reload here.
      void clearTyping(id, meId);
      void markRead(id, meId);
    } catch (e) {
      toast.error("Message not sent", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    }
  }

  if (!loading && !user) {
    return (
      <main className="min-h-screen bg-background px-5 pt-16">
        <div className="mx-auto max-w-md rounded-3xl border border-border bg-card p-6 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-lg font-bold text-foreground">Sign in to open this chat</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conversations are private to their participants.
          </p>
          <Link
            to="/auth"
            className="mt-4 flex min-h-12 items-center justify-center rounded-2xl bg-primary text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Sign in
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <Link
          to="/messages"
          aria-label="Back to messages"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        {conversation && <MemberAvatars members={conversation.members} meId={meId} />}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-bold text-foreground">
            {conversationTitle(conversation, meId)}
          </h1>
          <p className="truncate text-xs text-muted-foreground" aria-live="polite">
            {typingNames.length > 0
              ? `${typingNames.join(", ")} ${typingNames.length === 1 ? "is" : "are"} typing…`
              : conversation?.is_group
                ? `${conversation.members.length} people`
                : "Direct message"}
          </p>
        </div>
        {conversation?.is_group && (
          <button
            type="button"
            onClick={() => setManage((v) => !v)}
            aria-expanded={manage}
            aria-label="Manage group"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <Users className="h-5 w-5" aria-hidden />
          </button>
        )}
      </header>

      {manage && conversation && meId && (
        <section aria-label="Group settings" className="border-b border-border bg-card px-4 py-4">
          <label htmlFor="rename" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Group name
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="rename"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="min-h-11 flex-1 rounded-2xl bg-surface-2 px-4 text-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            <button
              type="button"
              onClick={() =>
                void renameConversation(id, title)
                  .then(() => reload(true))
                  .then(() => toast.success("Group renamed"))
                  .catch(() => toast.error("Only group admins can rename this chat"))
              }
              className="min-h-11 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              Save
            </button>
          </div>
          <ul className="mt-3 space-y-1">
            {conversation.members.map((m) => (
              <li key={m.user_id} className="flex min-h-11 items-center gap-2 rounded-2xl bg-surface-2 px-3">
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {nameOf.get(m.user_id)}
                  {m.role === "admin" && (
                    <span className="ml-2 text-[11px] uppercase text-muted-foreground">admin</span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void removeMember(id, m.user_id)
                      .then(() =>
                        m.user_id === meId ? navigate({ to: "/messages" }) : reload(true),
                      )
                      .catch(() => toast.error("Only admins can remove members"))
                  }
                  className="min-h-9 rounded-xl px-3 text-xs font-semibold text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {m.user_id === meId ? "Leave" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-4">
        <div className="mx-auto w-full max-w-xl">
          {status === "loading" && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Loading conversation…
            </p>
          )}
          {status === "error" && (
            <div role="alert" className="rounded-3xl border border-border bg-card p-5 text-center">
              <p className="text-sm font-bold text-foreground">Can't open this conversation</p>
              <p className="mt-1 text-sm text-muted-foreground">{error}</p>
              <button
                type="button"
                onClick={() => void reload()}
                className="mt-4 min-h-11 rounded-2xl bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Try again
              </button>
            </div>
          )}
          {status === "ready" && messages.length === 0 && (
            <p className="rounded-3xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No messages yet — say hello 👋
            </p>
          )}
          {status === "ready" && meId && (
            <ul className="space-y-3">
              {messages.map((m, i) => {
                const replied = m.reply_to_id ? (messageById.get(m.reply_to_id) ?? null) : null;
                return (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    mine={m.sender_id === meId}
                    meId={meId}
                    senderName={nameOf.get(m.sender_id) ?? "Member"}
                    showSender={messages[i - 1]?.sender_id !== m.sender_id}
                    replied={replied}
                    repliedName={replied ? (nameOf.get(replied.sender_id) ?? "Member") : "Member"}
                    reactions={reactionsByMessage.get(m.id) ?? []}
                    seen={new Date(m.created_at).getTime() <= seenCutoff}
                    onReply={() => setReplyTo(m)}
                    onEdit={() => setEditing(m)}
                    onDelete={() =>
                      void deleteForEveryone(m.id).catch(() =>
                        toast.error("Couldn't delete that message"),
                      )
                    }
                    onReact={(emoji, on) =>
                      void toggleReaction(m.id, meId, emoji, on).catch(() =>
                        toast.error("Reaction failed"),
                      )
                    }
                  />
                );
              })}
            </ul>
          )}
          <div ref={endRef} />
        </div>
      </div>

      <div className="sticky bottom-0">
        <Composer
          disabled={status !== "ready"}
          onSend={handleSend}
          onTyping={() => {
            if (!meId) return;
            const now = Date.now();
            if (now - typedAt.current < TYPING_PING_MS) return;
            typedAt.current = now;
            void setTyping(id, meId);
          }}
          onStopTyping={() => {
            if (!meId) return;
            typedAt.current = 0;
            void clearTyping(id, meId);
          }}
          replyTo={replyTo}
          replyLabel={replyTo?.body ?? replyTo?.kind ?? ""}
          onCancelReply={() => setReplyTo(null)}
          editing={editing}
          onCancelEdit={() => setEditing(null)}
        />
      </div>
    </main>
  );
}
