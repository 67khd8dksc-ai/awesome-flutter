import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ChatAvatar } from "@/components/messages/ChatAvatar";
import {
  createConversation,
  findDirectConversation,
  searchProfiles,
  type Profile,
} from "@/lib/messaging";
import { cn } from "@/lib/utils";

export function NewConversation({
  meId,
  onClose,
  onCreated,
}: {
  meId: string;
  onClose: () => void;
  onCreated: (conversationId: string) => void;
}) {
  const [term, setTerm] = useState("");
  const [people, setPeople] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<Profile[]>([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Held in a ref so the mount effect below doesn't re-run — the parent passes a
  // fresh arrow function every render, which would re-steal focus on every keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // A dialog needs focus moved into it, Escape wherever focus sits, and focus
  // handed back to whatever opened it.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(() => {
      void searchProfiles(term, meId)
        .then((res) => {
          if (cancelled) return;
          setPeople(res);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!cancelled) setError(e instanceof Error ? e.message : "Could not load people.");
        })
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [term, meId]);

  function toggle(p: Profile) {
    setSelected((prev) =>
      prev.some((s) => s.id === p.id) ? prev.filter((s) => s.id !== p.id) : [...prev, p],
    );
  }

  async function start() {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      const isGroup = selected.length > 1;
      if (!isGroup) {
        const existing = await findDirectConversation(meId, selected[0]!.id);
        if (existing) {
          onCreated(existing);
          return;
        }
      }
      const id = await createConversation({
        meId,
        memberIds: selected.map((s) => s.id),
        isGroup,
        title: isGroup ? title.trim() || null : null,
      });
      onCreated(id);
    } catch (e) {
      toast.error("Couldn't start the conversation", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Start a new conversation"
      className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 sm:items-center sm:p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-border bg-card p-5 shadow-[var(--shadow-card)] sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-foreground">New message</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick one person for a direct chat, or several for a group.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {selected.length > 0 && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {selected.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s)}
                  className="flex min-h-9 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-xs font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  aria-label={`Remove ${s.display_name}`}
                >
                  {s.display_name}
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected.length > 1 && (
          <div className="mt-4">
            <label htmlFor="group-title" className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Group name (optional)
            </label>
            <input
              id="group-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Weekend hike crew"
              className="mt-1 min-h-12 w-full rounded-2xl bg-surface-2 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
          </div>
        )}

        <div className="mt-4">
          <label htmlFor="people-search" className="sr-only">
            Search people
          </label>
          <input
            id="people-search"
            ref={searchRef}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search people"
            className="min-h-12 w-full rounded-2xl bg-surface-2 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          />
        </div>

        <div className="mt-3" aria-live="polite">
          {loading && (
            <p className="flex items-center gap-2 px-1 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
              Looking for people…
            </p>
          )}
          {error && (
            <p role="alert" className="px-1 py-3 text-sm text-muted-foreground">
              {error}
            </p>
          )}
          {!loading && !error && people.length === 0 && (
            <p className="rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
              Nobody else has signed in yet. Once a friend signs in with Apple or Google they'll show
              up here.
            </p>
          )}
          <ul className="space-y-1">
            {people.map((p) => {
              const on = selected.some((s) => s.id === p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => toggle(p)}
                    aria-pressed={on}
                    className={cn(
                      "flex min-h-14 w-full items-center gap-3 rounded-2xl px-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      on ? "bg-primary/12" : "hover:bg-surface-2",
                    )}
                  >
                    <ChatAvatar name={p.display_name} url={p.avatar_url} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {p.display_name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <button
          type="button"
          onClick={() => void start()}
          disabled={selected.length === 0 || busy}
          className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
          {selected.length > 1 ? "Create group" : "Start chat"}
        </button>
      </div>
    </div>
  );
}
