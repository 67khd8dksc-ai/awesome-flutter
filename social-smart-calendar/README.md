# Social Smart Calendar — messaging fixes

Drop-in replacements for the messaging feature exported from Lovable, plus the
SQL migrations behind them. Copy each file over the matching path in your app.

```
src/lib/messaging.ts                          replaces yours
src/hooks/useChat.ts                          replaces yours
src/components/messages/Composer.tsx          replaces yours
src/components/messages/ChatAvatar.tsx        replaces yours
src/components/messages/MessageBubble.tsx     replaces yours
src/components/messages/NewConversation.tsx   replaces yours
src/routes/messages/$id.tsx                   replaces yours
src/routes/index.tsx                          replaces yours
supabase/migrations/0001_messaging_schema.sql
supabase/migrations/0002_messaging_hardening.sql
supabase/migrations/0003_conversation_overview.sql
```

Unchanged and not included: `lib/message-kit.ts`, `routes/messages/index.tsx`,
`integrations/supabase/types.ts`, `routeTree.gen.ts`.

**Check one thing before building:** `src/routes/index.tsx` now sets RSVP with the
literals `"going"` and `"maybe"`. Those match the button labels, but the `Rsvp`
union lives in `@/data/events`, which wasn't available here — if it spells them
differently, TypeScript will point at the two `setRsvp` calls.

After applying migration `0003`, re-run `supabase gen types typescript` so
`conversation_overview` lands in the generated `Database` type. The client works
either way — it falls back to the old client-side counting when the RPC is
missing — but the generated types are what remove the local cast in
`inboxOverview`.

## Bugs fixed

**Conversations opened at the wrong end of the history.**
`fetchConversation` ordered messages ascending with `.limit(300)`, which returns
the *oldest* 300 messages. Any conversation longer than that opened on ancient
history with nothing recent visible. Now ordered newest-first and reversed.

**Typing indicators never appeared.**
The payload picker read
`(payload.new ?? payload.eventType === "DELETE" ? payload.old : payload.new)`.
`??` binds tighter than `?:`, so the condition was `payload.new` itself — always
truthy on INSERT and UPDATE — and the code took `payload.old`, which is `{}` for
those events. `user_id` came back undefined and every typing event was dropped.

**Unread counts drifted.**
The inbox pulled a single 400-message window across *all* conversations and
counted in JavaScript. One busy chat could push another chat's unread messages —
or its last message entirely — out of the window. Replaced with the
`conversation_overview` RPC, which counts per conversation in Postgres.

**Anyone could join any conversation.** *(schema)*
The `conversation_members` INSERT policy allowed `auth.uid() = user_id` with no
constraint on which conversation, so a signed-in user could insert themselves
into any conversation whose UUID they knew and read its whole history. Only the
creator or an admin can add members now.

**`SECURITY DEFINER` helpers answered questions about other users.** *(schema)*
`is_conversation_member(conv, someone_else)` was callable over RPC by any signed-in
user, making a membership oracle. All three helpers now require
`_user_id = auth.uid()`.

**Migration `0002` could not run.**
It revoked `update_updated_at_column()`, a function nothing created. `REVOKE` on a
missing function aborts the migration. It is now defined (and wired to `profiles`)
before the revoke.

**Orphaned conversations.**
If the member insert failed in `createConversation`, the conversation row stayed
behind, visible to nobody. It is now cleaned up before the error is rethrown.

**Double-sent stickers and GIFs.**
Those buttons called `onSend` with no in-flight guard, so a double tap posted
twice. All sends now go through one guarded path, and both pickers are disabled
mid-edit where they'd have silently created a new message instead.

## Performance

**Every realtime event refetched everything.** A single incoming message ran the
full conversation query — conversation, members, profiles, 300 messages,
reactions — and every message anywhere refetched the entire inbox. Message,
reaction and read-receipt events now apply the row from the payload directly
(the tables are `REPLICA IDENTITY FULL`, so rows arrive complete); only joins,
leaves and renames still reload, coalesced into one call per 400 ms.

**Quadratic rendering.** The message list ran `messages.find()` twice and
`reactions.filter()` once *per message* — roughly 900 scans per render at 300
messages. Now indexed into maps once per change.

**Typing expiry re-rendered on a timer.** The 2-second sweep always built a new
array; it now returns the same reference when nothing has expired.

**Redundant round trips on send.** Sending awaited a full reload that realtime
was about to deliver anyway.

## Behaviour

- Scroll sticks to the newest message only when you're already near the bottom,
  so reading back through history isn't yanked away by an incoming message.
- The typing indicator clears after 3 seconds idle and when you leave the page,
  instead of lingering until your next send.
- The composer textarea grows with its content up to its `max-h-32`.

## Second pass — the remaining files

**Message actions were unreachable on phones.**
React, reply, edit and delete lived behind `opacity-0 group-hover:opacity-100`.
Touch devices have no hover, so on the mobile layout this app is built for, the
only way to reach them was a hardware keyboard. They're now visible by default
and only hover-revealed from `sm` up.

**Delete for everyone had no confirmation.** One stray tap destroyed a message
for every participant, permanently. It now asks through a sonner toast.

**Broken avatars.** Apple and Google avatar URLs expire; `<img>` had no `onError`,
so the chat list filled with broken-image icons. Falls back to initials now.

**The new-conversation dialog wasn't really a dialog.** `role="dialog"
aria-modal="true"` with no focus moved into it, no focus returned to the opener
on close, and an Escape handler on a non-focusable `<div>` that did nothing until
you'd already clicked inside. Focus, Escape and backdrop-click all work now, and
the Escape listener is registered once on mount — hanging it off the `onClose`
prop would have re-run on every render and stolen focus mid-keystroke.

**"Going" and "Maybe" on invite cards did nothing.** They were `<span>`s inside
the card's own button, so tapping either just opened the detail sheet. They're
real buttons that set the RSVP now.

**Home screen greeted everyone as Joel on September 2.** Both the name and the
date were hardcoded; the name now comes from the session and the date from the
clock.

**Avatar stack computed a third avatar it never rendered** (`slice(0, 3)` then
`slice(0, 2)`). Trimmed, and groups larger than two now show a `+N` badge.

**Reaction picker ignored Escape.** It does now.

## Known issues left alone

These need decisions or code that isn't in these files:

- **`Add to calendar`, `Save` and the create-event `+` button have no handlers.**
  Dead controls on the home screen.
- **RSVPs are `useState` only** — never written to Supabase, so they reset on
  navigation and are invisible to anyone else. The calendar half of the app still
  runs entirely on the `EVENTS`/`DISCOVER` constants in `@/data/events`.
- **`imported_events` and `user_preferences` have no RLS in any migration seen
  here.** They exist in the generated types, and the migrations you have cover
  only messaging and `profiles`. If those two tables were created without
  policies, every user's calendar imports and settings are readable by any
  signed-in user — worth checking in the Supabase dashboard.
- **`"Seen"` in a group means "at least one other person read it"**, since the
  cutoff is the max of the others' `last_read_at`. Fine for a DM, generous for a
  group.
- **GIFs are hotlinked from `media.giphy.com`** as a fixed list of eight. No
  attribution, and the URLs can rot; Giphy's SDK/API is the supported route if
  this becomes more than a demo.
- **`findDirectConversation`** matches on `is_group = false` alone, so a DM that
  ever had a third member added would still resolve as that pair's direct chat.

## Not verified here

These files were syntax-checked with esbuild, not type-checked or run — the
surrounding project (`package.json`, `tsconfig`, `@/` aliases,
`@/hooks/useSession`, `@/integrations/supabase/client`) lives in your Lovable
app, not in this repo. Run `tsc --noEmit` and the dev server after copying them
in, and apply the three migrations against your Supabase project.
