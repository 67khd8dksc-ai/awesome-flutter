import { useEffect, useRef, useState } from "react";
import { Image, Send, Smile, Sticker, X } from "lucide-react";
import { EMOJI_GROUPS, GIFS, STICKERS } from "@/lib/message-kit";
import type { Message } from "@/lib/messaging";
import { cn } from "@/lib/utils";

type Panel = "emoji" | "gif" | "sticker" | null;
type Outgoing = { kind: "text" | "gif" | "sticker"; body?: string; mediaUrl?: string };

/** Matches the textarea's max-h-32 so the auto-grow stops where the CSS does. */
const MAX_INPUT_HEIGHT = 128;
const TYPING_IDLE_MS = 3000;

export function Composer({
  onSend,
  onTyping,
  onStopTyping,
  replyTo,
  replyLabel,
  onCancelReply,
  editing,
  onCancelEdit,
  disabled,
}: {
  onSend: (m: Outgoing) => Promise<void>;
  onTyping: () => void;
  onStopTyping?: () => void;
  replyTo: Message | null;
  replyLabel: string;
  onCancelReply: () => void;
  editing: Message | null;
  onCancelEdit: () => void;
  disabled?: boolean;
}) {
  const [text, setText] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (editing) {
      setText(editing.body ?? "");
      setPanel(null);
      inputRef.current?.focus();
    }
  }, [editing]);

  // Grow with the content instead of staying stuck at one row.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }, [text]);

  useEffect(
    () => () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
    },
    [],
  );

  function handleChange(value: string) {
    setText(value);
    onTyping();
    if (idleTimer.current) clearTimeout(idleTimer.current);
    // Clear the indicator when typing stops, rather than leaving the row behind
    // until the next send.
    idleTimer.current = setTimeout(() => onStopTyping?.(), TYPING_IDLE_MS);
  }

  /** Single send path so a double tap can't post the same sticker or GIF twice. */
  async function send(payload: Outgoing) {
    if (busy || disabled) return;
    setBusy(true);
    try {
      await onSend(payload);
      setPanel(null);
    } finally {
      setBusy(false);
    }
  }

  async function submitText() {
    const value = text.trim();
    if (!value || busy) return;
    await send({ kind: "text", body: value });
    setText("");
    if (idleTimer.current) clearTimeout(idleTimer.current);
    onStopTyping?.();
  }

  // Stickers and GIFs create a new message, so they have no meaning mid-edit.
  const mediaDisabled = disabled || busy || Boolean(editing);

  return (
    <div className="border-t border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
      {(replyTo || editing) && (
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <span className="h-8 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            <span className="font-bold text-foreground">{editing ? "Editing" : "Replying to"}</span>{" "}
            {editing ? (editing.body ?? "") : replyLabel}
          </p>
          <button
            type="button"
            onClick={editing ? onCancelEdit : onCancelReply}
            className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={editing ? "Cancel editing" : "Cancel reply"}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {panel && (
        <div className="max-h-56 overflow-y-auto border-b border-border px-4 py-3" role="group" aria-label={`${panel} picker`}>
          {panel === "emoji" &&
            EMOJI_GROUPS.map((g) => (
              <div key={g.label} className="mb-3 last:mb-0">
                <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {g.label}
                </p>
                <div className="flex flex-wrap gap-1">
                  {g.emojis.map((e) => (
                    <button
                      key={e}
                      type="button"
                      aria-label={`Insert ${e}`}
                      onClick={() => handleChange(text + e)}
                      className="grid h-10 w-10 place-items-center rounded-xl text-xl hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>
            ))}

          {panel === "sticker" && (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {STICKERS.map((s) => (
                <button
                  key={s.emoji}
                  type="button"
                  disabled={mediaDisabled}
                  onClick={() => void send({ kind: "sticker", body: s.emoji })}
                  className="grid aspect-square place-items-center rounded-2xl bg-surface-2 text-3xl hover:bg-surface disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`Send ${s.label} sticker`}
                >
                  {s.emoji}
                </button>
              ))}
            </div>
          )}

          {panel === "gif" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {GIFS.map((g) => (
                <button
                  key={g.url}
                  type="button"
                  disabled={mediaDisabled}
                  onClick={() => void send({ kind: "gif", mediaUrl: g.url })}
                  className="overflow-hidden rounded-2xl bg-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`Send ${g.label} GIF`}
                >
                  <img src={g.url} alt={g.label} className="h-24 w-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-end gap-2 px-3 py-3">
        <PanelButton label="Emoji" active={panel === "emoji"} onClick={() => setPanel(panel === "emoji" ? null : "emoji")}>
          <Smile className="h-5 w-5" aria-hidden />
        </PanelButton>
        <PanelButton
          label="Stickers"
          active={panel === "sticker"}
          disabled={Boolean(editing)}
          onClick={() => setPanel(panel === "sticker" ? null : "sticker")}
        >
          <Sticker className="h-5 w-5" aria-hidden />
        </PanelButton>
        <PanelButton
          label="GIFs"
          active={panel === "gif"}
          disabled={Boolean(editing)}
          onClick={() => setPanel(panel === "gif" ? null : "gif")}
        >
          <Image className="h-5 w-5" aria-hidden />
        </PanelButton>

        <label className="sr-only" htmlFor="composer-input">
          Write a message
        </label>
        <textarea
          id="composer-input"
          ref={inputRef}
          rows={1}
          value={text}
          disabled={disabled}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submitText();
            }
          }}
          placeholder={editing ? "Update your message…" : "Message…"}
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl bg-surface-2 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        />
        <button
          type="button"
          onClick={() => void submitText()}
          disabled={disabled || busy || !text.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={editing ? "Save changes" : "Send message"}
        >
          <Send className="h-5 w-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PanelButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      className={cn(
        "grid h-11 w-11 shrink-0 place-items-center rounded-2xl disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        active ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
