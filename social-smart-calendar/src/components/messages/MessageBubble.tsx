import { useEffect, useState } from "react";
import { Check, CheckCheck, CornerUpLeft, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { QUICK_REACTIONS } from "@/lib/message-kit";
import { clockTime, type Message, type Reaction } from "@/lib/messaging";
import { cn } from "@/lib/utils";

export function MessageBubble({
  message,
  mine,
  senderName,
  replied,
  repliedName,
  reactions,
  meId,
  seen,
  showSender,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: {
  message: Message;
  mine: boolean;
  senderName: string;
  replied: Message | null;
  repliedName: string;
  reactions: Reaction[];
  meId: string;
  seen: boolean;
  showSender: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string, on: boolean) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const grouped = reactions.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.emoji] ??= []).push(r.user_id);
    return acc;
  }, {});
  const deleted = Boolean(message.deleted_at);

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  // Deleting is for everyone and can't be undone, so ask first.
  function confirmDelete() {
    toast("Delete this message for everyone?", {
      action: { label: "Delete", onClick: onDelete },
      cancel: { label: "Keep", onClick: () => undefined },
    });
  }

  return (
    <li className={cn("flex flex-col gap-1", mine ? "items-end" : "items-start")}>
      {showSender && !mine && (
        <span className="px-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          {senderName}
        </span>
      )}

      <div className={cn("group flex max-w-[85%] items-end gap-1", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "rounded-3xl px-4 py-2.5 text-sm leading-relaxed",
            mine ? "bg-primary text-primary-foreground" : "bg-surface-2 text-foreground",
            deleted && "italic opacity-70",
            message.kind !== "text" && !deleted && "bg-transparent px-0 py-0",
          )}
        >
          {replied && !deleted && (
            <p
              className={cn(
                "mb-2 rounded-2xl px-3 py-1.5 text-xs",
                mine ? "bg-primary-foreground/15" : "bg-card",
              )}
            >
              <span className="font-bold">{repliedName}</span>
              <span className="ml-1 opacity-80">
                {replied.deleted_at ? "Message deleted" : (replied.body ?? replied.kind.toUpperCase())}
              </span>
            </p>
          )}

          {deleted ? (
            "This message was deleted"
          ) : message.kind === "gif" && message.media_url ? (
            <img
              src={message.media_url}
              alt="GIF"
              className="max-h-56 w-56 rounded-3xl object-cover"
              loading="lazy"
            />
          ) : message.kind === "sticker" ? (
            <span className="block text-5xl leading-none" role="img" aria-label="sticker">
              {message.body}
            </span>
          ) : (
            <span className="whitespace-pre-wrap break-words">{message.body}</span>
          )}
        </div>

        {!deleted && (
          // Hover-to-reveal leaves these unreachable on touch, where there is no
          // hover at all — so they stay visible on phones and only hide from sm up.
          <div className="flex shrink-0 items-center gap-0.5 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 motion-reduce:transition-none">
            <IconBtn label="React" onClick={() => setPickerOpen((v) => !v)}>
              <SmilePlus className="h-4 w-4" aria-hidden />
            </IconBtn>
            <IconBtn label="Reply" onClick={onReply}>
              <CornerUpLeft className="h-4 w-4" aria-hidden />
            </IconBtn>
            {mine && message.kind === "text" && (
              <IconBtn label="Edit message" onClick={onEdit}>
                <Pencil className="h-4 w-4" aria-hidden />
              </IconBtn>
            )}
            {mine && (
              <IconBtn label="Delete for everyone" onClick={confirmDelete}>
                <Trash2 className="h-4 w-4" aria-hidden />
              </IconBtn>
            )}
          </div>
        )}
      </div>

      {pickerOpen && (
        <div className="flex gap-1 rounded-2xl bg-card p-1 shadow-[var(--shadow-card)]">
          {QUICK_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onReact(e, !(grouped[e] ?? []).includes(meId));
                setPickerOpen(false);
              }}
              className="grid h-9 w-9 place-items-center rounded-xl text-lg hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`React with ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {Object.keys(grouped).length > 0 && (
        <ul className={cn("flex flex-wrap gap-1 px-1", mine && "justify-end")}>
          {Object.entries(grouped).map(([emoji, users]) => {
            const on = users.includes(meId);
            return (
              <li key={emoji}>
                <button
                  type="button"
                  onClick={() => onReact(emoji, !on)}
                  aria-pressed={on}
                  aria-label={`${emoji} ${users.length} ${users.length === 1 ? "reaction" : "reactions"}`}
                  className={cn(
                    "flex min-h-8 items-center gap-1 rounded-full px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    on ? "bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
                  )}
                >
                  <span aria-hidden>{emoji}</span>
                  {users.length}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <span className="flex items-center gap-1 px-2 text-[11px] text-muted-foreground">
        {clockTime(message.created_at)}
        {message.edited_at && !deleted && <span>· edited</span>}
        {mine &&
          !deleted &&
          (seen ? (
            <>
              <CheckCheck className="h-3.5 w-3.5 text-primary" aria-hidden />
              <span className="sr-only">Seen</span>
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">Sent</span>
            </>
          ))}
      </span>
    </li>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {children}
    </button>
  );
}
