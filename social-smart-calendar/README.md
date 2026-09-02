# Social Smart Calendar — messaging fixes

Drop-in replacements for the messaging feature exported from Lovable, plus the
SQL migrations behind them. Copy each file over the matching path in your app.

```
src/lib/messaging.ts                     replaces yours
src/hooks/useChat.ts                     replaces yours
src/components/messages/Composer.tsx     replaces yours
src/routes/messages/$id.tsx              replaces yours
supabase/migrations/0001_messaging_schema.sql
supabase/migrations/0002_messaging_hardening.sql
supabase/migrations/0003_conversation_overview.sql
```

Unchanged and not included: `ChatAvatar.tsx`, `MessageBubble.tsx`,
`NewConversation.tsx`, `lib/message-kit.ts`, `routes/messages/index.tsx`,
`integrations/supabase/types.ts`, `routeTree.gen.ts`.

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

## Not verified here

These files were syntax-checked with esbuild, not type-checked or run — the
surrounding project (`package.json`, `tsconfig`, `@/` aliases,
`@/hooks/useSession`, `@/integrations/supabase/client`) lives in your Lovable
app, not in this repo. Run `tsc --noEmit` and the dev server after copying them
in, and apply the three migrations against your Supabase project.
