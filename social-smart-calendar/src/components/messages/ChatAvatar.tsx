import { useEffect, useState } from "react";
import { initials, type Member, type Profile } from "@/lib/messaging";
import { cn } from "@/lib/utils";

export function ChatAvatar({
  name,
  url,
  size = "md",
  className,
}: {
  name: string;
  url?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  // OAuth avatar URLs from Apple and Google expire and start 404ing, which would
  // otherwise leave a broken-image icon in the chat list.
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);

  const dim = size === "sm" ? "h-8 w-8 text-[11px]" : size === "lg" ? "h-14 w-14 text-base" : "h-11 w-11 text-sm";
  return url && !broken ? (
    <img
      src={url}
      alt=""
      onError={() => setBroken(true)}
      className={cn("shrink-0 rounded-2xl object-cover", dim, className)}
      loading="lazy"
    />
  ) : (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-2xl bg-surface-2 font-bold text-foreground",
        dim,
        className,
      )}
    >
      {initials(name) || "?"}
    </span>
  );
}

export function MemberAvatars({ members, meId }: { members: Member[]; meId: string | null }) {
  const others = members.filter((m) => m.user_id !== meId);
  const list: Profile[] = others.map(
    (m) => m.profile ?? { id: m.user_id, display_name: "Member", avatar_url: null },
  );
  if (list.length <= 1) {
    const one = list[0];
    return <ChatAvatar name={one?.display_name ?? "You"} url={one?.avatar_url ?? null} />;
  }
  const extra = list.length - 2;
  return (
    <span className="relative flex h-11 w-11 shrink-0">
      {list.slice(0, 2).map((p, i) => (
        <ChatAvatar
          key={p.id}
          name={p.display_name}
          url={p.avatar_url}
          size="sm"
          className={cn("absolute", i === 0 ? "left-0 top-0" : "bottom-0 right-0 ring-2 ring-card")}
        />
      ))}
      {extra > 0 && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-foreground px-1 text-[9px] font-bold text-background"
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
