// Supabase Edge Function: chat
// Holds the Anthropic API key server-side. The static GitHub Pages frontend
// never sees it. Deploy with: supabase functions deploy chat
//
// Required secrets (set with `supabase secrets set KEY=value`):
//   ANTHROPIC_API_KEY      - your Anthropic API key
//   SUPABASE_URL           - project URL (auto-available as env var already)
//   SUPABASE_SERVICE_ROLE_KEY - service role key, from Project Settings > API
//
// The function verifies the caller's Supabase auth JWT before doing anything,
// so no one else can use it even though the URL is public.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ADD_TASK_TOOL = {
  name: "add_task",
  description:
    "Add a task to the user's Bench task list for a given date. Call this once per task the user wants tracked.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Short task title." },
      est_minutes: {
        type: "integer",
        description: "Estimated minutes to complete. Pick the closest of: 15, 30, 45, 60, 90, 120.",
      },
      date: {
        type: "string",
        description: "Date the task belongs to, as YYYY-MM-DD. Default to today if not specified.",
      },
    },
    required: ["title", "est_minutes", "date"],
  },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace("Bearer ", "");
    if (!jwt) {
      return json({ error: "Missing auth token" }, 401);
    }

    // Verify the caller and get their user id — this is what stops a stranger
    // who finds the function URL from using your Anthropic key.
    const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await authClient.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return json({ error: "Invalid session" }, 401);
    }
    const userId = userData.user.id;

    const { message, history, today } = await req.json();
    if (!message || typeof message !== "string") {
      return json({ error: "message is required" }, 400);
    }

    const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const anthroMessages = [
      ...(Array.isArray(history) ? history : []).map((m: any) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content ?? ""),
      })),
      { role: "user", content: message },
    ];

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: `You are the assistant embedded in Bench, a personal daily planner. ` +
          `Today's date is ${today}. Be brief and direct. When the user mentions something ` +
          `that sounds like a task or commitment, call add_task to add it rather than just ` +
          `acknowledging it in text. Don't call add_task for things that are already clearly ` +
          `on their list unless they ask to change it.`,
        tools: [ADD_TASK_TOOL],
        messages: anthroMessages,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return json({ error: `Anthropic API error: ${errText}` }, 502);
    }

    const data = await resp.json();

    let replyText = "";
    const addedTasks: any[] = [];

    for (const block of data.content ?? []) {
      if (block.type === "text") {
        replyText += block.text;
      } else if (block.type === "tool_use" && block.name === "add_task") {
        const { title, est_minutes, date } = block.input ?? {};
        const taskDate = date || today;

        // Find or create the day row for this user + date.
        let { data: dayRow } = await db
          .from("days")
          .select("id")
          .eq("user_id", userId)
          .eq("date", taskDate)
          .maybeSingle();

        if (!dayRow) {
          const { data: newDay, error: dayErr } = await db
            .from("days")
            .insert({ user_id: userId, date: taskDate })
            .select("id")
            .single();
          if (dayErr) continue;
          dayRow = newDay;
        }

        const { data: inserted } = await db
          .from("tasks")
          .insert({
            day_id: dayRow.id,
            user_id: userId,
            title,
            est_minutes: est_minutes || 30,
          })
          .select()
          .single();

        if (inserted) addedTasks.push(inserted);
      }
    }

    if (!replyText.trim()) {
      replyText = addedTasks.length
        ? `Added ${addedTasks.length} task${addedTasks.length > 1 ? "s" : ""}.`
        : "Got it.";
    }

    // Persist the exchange so chat history survives reloads.
    await db.from("chat_messages").insert([
      { user_id: userId, role: "user", content: message },
      { user_id: userId, role: "assistant", content: replyText },
    ]);

    return json({ reply: replyText, addedTasks });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "content-type": "application/json" },
  });
}
