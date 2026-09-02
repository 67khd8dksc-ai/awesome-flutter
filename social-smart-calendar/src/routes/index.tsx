import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarDays, Compass, MessageCircle, Plus, Settings, Sparkles, Upload, Users } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSession } from "@/hooks/useSession";
import {
  CATEGORY_META,
  DISCOVER,
  EVENTS,
  ME,
  dayLabel,
  fmtTime,
  goingCount,
  leaveBy,
  type CalEvent,
  type Rsvp,
} from "@/data/events";
import { WeekStrip } from "@/components/calendar/WeekStrip";
import { DayTimeline } from "@/components/calendar/DayTimeline";
import { EventCard, RsvpPill } from "@/components/calendar/EventCard";
import { EventDetail } from "@/components/calendar/EventDetail";
import { CAT_DOT, CAT_TINT } from "@/components/calendar/category";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Social Smart Calendar — Plan, invite, arrive on time" },
      {
        name: "description",
        content:
          "An offline-first social calendar: daily and weekly views, RSVP tracking, travel-time cues and shared event plans in one mobile-first app.",
      },
      { property: "og:title", content: "Social Smart Calendar" },
      {
        property: "og:description",
        content:
          "Daily and weekly views, RSVP tracking, travel-time cues and shared plans — a mobile-first social calendar.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Tab = "day" | "week" | "discover";

function Index() {
  const [tab, setTab] = useState<Tab>("day");
  const [day, setDay] = useState(0);
  const [open, setOpen] = useState<CalEvent | null>(null);
  const [rsvp, setRsvp] = useState<Record<string, Rsvp>>({});
  const { user } = useSession();

  // Was a hardcoded "Tuesday, September 2" and "Hey Joel" — every signed-in user
  // saw the same date and the same name.
  const todayLabel = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    [],
  );
  const account = user as unknown as
    | { email?: string; user_metadata?: { full_name?: string; name?: string } }
    | null;
  const firstName = (
    account?.user_metadata?.full_name ??
    account?.user_metadata?.name ??
    account?.email?.split("@")[0] ??
    ""
  )
    .trim()
    .split(/\s+/)[0];

  const dayEvents = useMemo(
    () => EVENTS.filter((e) => e.day === day).sort((a, b) => a.start - b.start),
    [day],
  );
  const upcoming = useMemo(
    () => [...EVENTS].sort((a, b) => a.day - b.day || a.start - b.start).slice(0, 5),
    [],
  );
  const invites = EVENTS.filter((e) => (rsvp[e.id] ?? e.myStatus) === "invited");
  const next = upcoming.find((e) => e.day > 0 || e.start > 11 * 60 + 20) ?? upcoming[0];

  return (
    <div className="min-h-screen bg-background pb-28">
      <main id="main" className="mx-auto w-full max-w-xl">
        <header className="flex items-center justify-between gap-3 px-5 pb-4 pt-6">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {todayLabel}
            </p>
            <h1 className="mt-1 truncate text-[26px] font-bold leading-tight text-foreground">
              Hey {firstName || "there"}
            </h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle compact />
            <Link
              to="/messages"
              aria-label="Messages"
              className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-card text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              to="/import"
              aria-label="Import a calendar file"
              className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-card text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Upload className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              to="/settings"
              aria-label="Settings and reminders"
              className="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-card text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <Settings className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              to="/auth"
              aria-label={user ? "Account" : "Sign in"}
              className="grid h-11 w-11 place-items-center rounded-full border border-border bg-card text-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span aria-hidden>{ME.emoji}</span>
            </Link>
          </div>
        </header>

        {/* Up next hero */}
        {next && (
          <section className="px-5">
            <button
              type="button"
              onClick={() => setOpen(next)}
              className="w-full rounded-3xl bg-foreground p-5 text-left text-background shadow-[var(--shadow-card)] transition-transform active:scale-[0.99]"
            >
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-background/60">
                <Sparkles className="h-3.5 w-3.5" aria-hidden />
                Up next
              </div>
              <h2 className="mt-2 text-pretty text-xl font-bold leading-snug">{next.title}</h2>
              <p className="mt-1 text-sm text-background/70">
                {dayLabel(next.day)} · {fmtTime(next.start)} · {next.place}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold">
                {next.travel.minutes > 0 && (
                  <span className="rounded-full bg-background/15 px-3 py-1.5">
                    Leave by {leaveBy(next)} · {next.travel.minutes} min
                  </span>
                )}
                <span className="rounded-full bg-background/15 px-3 py-1.5">
                  {goingCount(next)} going
                </span>
              </div>
            </button>
          </section>
        )}

        {/* Invites needing a reply */}
        {invites.length > 0 && (
          <section className="mt-5">
            <h2 className="px-5 text-sm font-bold text-foreground">
              Waiting on you · {invites.length}
            </h2>
            <div className="mt-2 flex snap-x gap-3 overflow-x-auto px-5 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {invites.map((e) => (
                <div
                  key={e.id}
                  className="w-[240px] shrink-0 snap-start rounded-3xl border border-border bg-card p-4 text-left shadow-[var(--shadow-card)]"
                >
                  <button
                    type="button"
                    onClick={() => setOpen(e)}
                    className="w-full text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  >
                    <span
                      className={cn(
                        "inline-grid h-9 w-9 place-items-center rounded-2xl text-base",
                        CAT_TINT[e.category],
                      )}
                      aria-hidden
                    >
                      {CATEGORY_META[e.category].emoji}
                    </span>
                    <span className="mt-2 block truncate text-base font-bold text-foreground">
                      {e.title}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                      {e.host.name} invited you · {dayLabel(e.day)}
                    </span>
                  </button>
                  {/* Real buttons: these looked tappable but were spans inside the
                      card button, so tapping "Going" just opened the detail sheet. */}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRsvp((r) => ({ ...r, [e.id]: "going" }))}
                      className="min-h-11 flex-1 rounded-xl bg-foreground px-3 text-center text-xs font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Going
                    </button>
                    <button
                      type="button"
                      onClick={() => setRsvp((r) => ({ ...r, [e.id]: "maybe" }))}
                      className="min-h-11 flex-1 rounded-xl bg-surface-2 px-3 text-center text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      Maybe
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Views */}
        <section className="mt-5 px-5">
          {tab !== "discover" && <WeekStrip selected={day} onSelect={setDay} />}

          {tab === "day" && (
            <div className="mt-5">
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-lg font-bold text-foreground">{dayLabel(day)}</h2>
                <span className="text-sm text-muted-foreground">
                  {dayEvents.length} {dayEvents.length === 1 ? "event" : "events"}
                </span>
              </div>
              <DayTimeline events={dayEvents} showNow={day === 0} onOpen={setOpen} />
            </div>
          )}

          {tab === "week" && <WeekAgenda onOpen={setOpen} />}

          {tab === "discover" && <Discover />}
        </section>

        {tab === "day" && (
          <section className="mt-8 px-5">
            <h2 className="text-lg font-bold text-foreground">Coming up</h2>
            <ul className="mt-3 space-y-3">
              {upcoming
                .filter((e) => e.day !== day)
                .map((e) => (
                  <li key={e.id}>
                    <EventCard event={e} onOpen={setOpen} compact />
                  </li>
                ))}
            </ul>
          </section>
        )}
      </main>

      <EventDetail
        event={open}
        rsvp={rsvp}
        onRsvp={(id, s) => setRsvp((r) => ({ ...r, [id]: s }))}
        onClose={() => setOpen(null)}
      />

      <TabBar tab={tab} setTab={setTab} />
    </div>
  );
}

function WeekAgenda({ onOpen }: { onOpen: (e: CalEvent) => void }) {
  const days = [0, 1, 2, 3, 4, 5, 6];
  return (
    <div className="mt-5 space-y-6">
      {days.map((d) => {
        const list = EVENTS.filter((e) => e.day === d).sort((a, b) => a.start - b.start);
        return (
          <div key={d}>
            <div className="mb-2 flex items-center gap-3">
              <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">
                {dayLabel(d)}
              </h3>
              <span className="h-px flex-1 bg-border" aria-hidden />
              <span className="text-xs text-muted-foreground">{list.length}</span>
            </div>
            {list.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                Free day
              </p>
            ) : (
              <ul className="space-y-2">
                {list.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(e)}
                      className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 text-left"
                    >
                      <span className="w-16 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                        {fmtTime(e.start)}
                      </span>
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className={cn("h-2 w-2 shrink-0 rounded-full", CAT_DOT[e.category])}
                          aria-hidden
                        />
                        <span className="truncate text-sm font-semibold text-foreground">
                          {e.title}
                        </span>
                      </span>
                      <RsvpPill status={e.myStatus} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Discover() {
  return (
    <div className="mt-5 space-y-3">
      <p className="text-sm text-muted-foreground">
        Nearby this week, ranked by how many friends are already in.
      </p>
      {DISCOVER.map((d) => (
        <article
          key={d.id}
          className="rounded-3xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
        >
          <div className="flex items-start gap-3">
            <span
              className={cn(
                "grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg",
                CAT_TINT[d.category],
              )}
              aria-hidden
            >
              {CATEGORY_META[d.category].emoji}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-base font-bold text-foreground">{d.name}</h3>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {d.when} · {d.place} · {d.distanceMi} mi
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-foreground">
                  {d.price}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-foreground">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {d.friends} friends interested
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              className="min-h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
            >
              Add to calendar
            </button>
            <button
              type="button"
              className="min-h-11 rounded-2xl border border-border bg-surface-2 px-4 text-sm font-semibold text-foreground"
            >
              Save
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function TabBar({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
  const items: { id: Tab; label: string; icon: typeof CalendarDays }[] = [
    { id: "day", label: "Today", icon: CalendarDays },
    { id: "week", label: "Week", icon: Users },
    { id: "discover", label: "Discover", icon: Compass },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 backdrop-blur">
      <div className="mx-auto grid w-full max-w-xl grid-cols-[1fr_1fr_auto_1fr] items-center gap-1 px-5 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2">
        {items.slice(0, 2).map((i) => (
          <TabButton key={i.id} item={i} active={tab === i.id} onClick={() => setTab(i.id)} />
        ))}
        <button
          type="button"
          aria-label="Create event"
          className="grid h-12 w-12 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-card)]"
        >
          <Plus className="h-5 w-5" aria-hidden />
        </button>
        <TabButton
          item={{ id: "discover", label: "Discover", icon: Compass }}
          active={tab === "discover"}
          onClick={() => setTab("discover")}
        />
      </div>
    </nav>
  );
}

function TabButton({
  item,
  active,
  onClick,
}: {
  item: { id: Tab; label: string; icon: typeof CalendarDays };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="h-5 w-5" aria-hidden />
      {item.label}
    </button>
  );
}
