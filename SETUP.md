# Bench — setup

This turns Bench from a localStorage toy into a real app: Supabase for
accounts + history, an Edge Function for chat (so your Anthropic key never
sits in the public frontend).

## 1. Create the Supabase project

1. https://supabase.com → New project. Pick any name/region, save the DB password somewhere.
2. Project Settings → API. Copy the **Project URL** and the **anon public** key.

## 2. Create the tables

1. Supabase dashboard → SQL Editor → New query.
2. Paste in the contents of `supabase/schema.sql` and run it.

This creates `days`, `tasks`, and `chat_messages`, with Row Level Security
so each account can only ever see its own rows.

## 3. Turn on email auth, lock out signups

1. Authentication → Providers → make sure **Email** is enabled.
2. Authentication → Sign in with your own email once the app is live, to create your account.
3. **Then** go to Authentication → Settings and turn off "Allow new users to sign up."
   The RLS policies mean a stranger couldn't see your data even without this step,
   but there's no reason to leave signups open on a public repo.

## 4. Deploy the chat Edge Function

You need the Supabase CLI (`npm install -g supabase`, or see their docs for other install methods).

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF   # found in the project URL
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy chat
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are automatically available
inside Edge Functions — you don't need to set those yourself. The
**service role key** is different from the anon key; never put it in
`index.html`. It only ever lives in the function's environment.

After deploying, your chat endpoint is:
`https://YOUR_PROJECT_REF.supabase.co/functions/v1/chat`

## 5. Wire the frontend

Open `index.html` and fill in the three constants near the top:

```js
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "your anon public key";
const CHAT_FUNCTION_URL = "https://YOUR_PROJECT_REF.supabase.co/functions/v1/chat";
```

The anon key is safe to ship in a public file — RLS is what actually
protects your rows.

## 6. Push and enable Pages

```bash
git add .
git commit -m "Real backend: Supabase auth, history, Claude chat"
git push
```

Repo → Settings → Pages → Deploy from branch → `main` / root. Give it a
minute, then open the Pages URL, sign in with the magic link, and you're in.

## What's actually different from the old version

- Tasks and days live in Postgres, not `localStorage` — cross-device, and
  survive clearing your browser.
- `history` tab shows every past day, pulled from the database.
- `chat` panel talks to Claude through the Edge Function. When you mention
  something task-shaped, it calls a tool to add it directly to today's list
  and the reply lands in the chat.
- Auth means the public GitHub Pages URL isn't an open door to your planner.

## Known limitations, so you're not surprised later

- The chat function's task-detection depends on Claude reading intent
  correctly — it will occasionally add something you didn't mean as a task,
  or miss one that was phrased obliquely. Worth glancing at what got added.
- No offline support — if you lose network mid-edit, the debounced autosave
  (900ms) won't have fired. This mirrors the original app's behavior, not a
  regression, but it's now a network call instead of a local write.
- I haven't run this against a live Supabase project — I don't have
  credentials to create one on your behalf. Test the auth flow and one full
  day's plan → shutdown → history cycle before you trust it with real data.
