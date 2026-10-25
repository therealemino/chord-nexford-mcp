/**
 * Discovers undocumented Chord API shapes. Every call is REAL (Chord has no sandbox).
 *
 *   pnpm chord:discover
 *       Lists recent threads for CHORD_WORKSPACE_ID + CHORD_TEAMMATE_ID and prints the raw JSON of the first two.
 *
 *   pnpm chord:discover --thread <thread_id> --try-message "<text>"
 *       Also tries a MESSAGE scheduled task with candidate payload shapes, stopping at the first one accepted.
 *       If one is accepted, that message WILL be delivered to the thread. Use a test thread.
 *       scheduled_at must be in the future, so it is set --delay-seconds ahead (default 15). Each task is
 *       polled until it runs; only a task that runs without error counts.
 *
 *   pnpm chord:discover --task <scheduled_task_id>
 *       Fetches a scheduled task to see its status (did it run? did it fail?).
 *
 *   pnpm chord:discover --thread <thread_id> --try-takeover "<text>"
 *       Take over the thread, post <text> as an operator message, then hand back. Hands back only if this
 *       script did the take-over (a thread already under human control is left with the human).
 *       The customer WILL see Chord's take-over acknowledgement and the message.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { ChordError, createChordClient } from "../src/services/chord.js";
import { buildOperatorMessageBody, extractThreads, getPath } from "../src/config/chord.js";

const { values } = parseArgs({ options: { thread: { type: "string" }, "try-message": { type: "string" }, limit: { type: "string" }, "delay-seconds": { type: "string" }, task: { type: "string" }, "try-takeover": { type: "string" } } });

const missing = ["CHORD_API_KEY", "CHORD_WORKSPACE_ID", "CHORD_TEAMMATE_ID"].filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Set ${missing.join(", ")} in .env first.`);
  process.exit(1);
}
const workspace_id = process.env.CHORD_WORKSPACE_ID!;
const teammate_id = process.env.CHORD_TEAMMATE_ID!;
const chord = createChordClient(process.env.CHORD_API_KEY!);

const show = (label: string, v: unknown) => console.log(`\n=== ${label} ===\n${JSON.stringify(v, null, 2)}`);
const errorInfo = (err: unknown) =>
  err instanceof ChordError ? { status: err.status, body: err.body } : { error: (err as Error).message };

// 1. Threads
try {
  const list = await chord.listThreads({ workspace_id, agent_id: teammate_id, limit: values.limit ?? 5 });
  const threads = extractThreads(list);
  const topKeys = list && typeof list === "object" && !Array.isArray(list) ? Object.keys(list) : [];
  console.log(`Top-level response keys: ${topKeys.join(", ") || "(response is an array)"}`);
  console.log(`Threads found in response: ${threads.length}`);
  if (threads.length === 0) show("Raw list response (no thread array found)", list);
  threads.slice(0, 2).forEach((t, i) => show(`Thread ${i + 1}`, t));
  if (threads[0] && typeof threads[0] === "object" && "id" in threads[0]) {
    show("GET /v1/threads/{id} for thread 1", await chord.getThread(String(threads[0].id)));
  }
} catch (err) {
  show("Listing threads FAILED", errorInfo(err));
  process.exit(1);
}

// 2. Message payload shapes. Chord accepts almost any payload at creation and only fails when the task runs,
// so each candidate is created, then polled until it runs or reports an error, before trying the next.
if (values.thread && values["try-message"]) {
  const thread_id = values.thread;
  const text = values["try-message"];
  const thread = await chord.getThread(thread_id);
  const conversation_id = getPath(thread, "metadata.partner_chat.conversation_id");
  console.log(`\nconversation_id from thread metadata: ${String(conversation_id)}`);
  const candidates: [string, Record<string, unknown>][] = [
    ["{ conversation_id, body }", { conversation_id, body: text }],
    ["{ conversation_id, text }", { conversation_id, text }],
    ["{ conversation_id, thread_id, text }", { conversation_id, thread_id, text }],
    ["{ conversation_id, message }", { conversation_id, message: text }],
    ["{ conversation_id, content }", { conversation_id, content: text }],
  ];
  const delaySeconds = Number(values["delay-seconds"] ?? 15);
  let delivered: string | null = null;
  for (const [name, payload] of candidates) {
    const body = { task_type: "MESSAGE", scheduled_at: new Date(Date.now() + delaySeconds * 1000).toISOString(), workspace_id, teammate_id, payload };
    let taskId: string;
    try {
      const created = await chord.createScheduledTask(body);
      taskId = String(getPath(created, "id"));
      console.log(`\nCreated task ${taskId} with ${name}; waiting for it to run...`);
    } catch (err) {
      show(`Rejected at creation: ${name}`, errorInfo(err));
      continue;
    }
    const deadline = Date.now() + (delaySeconds + 120) * 1000;
    let task: unknown = null;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      task = await chord.getScheduledTask(taskId);
      const status = String(getPath(task, "status"));
      if (getPath(task, "last_error") || !["PENDING", "SCHEDULED", "QUEUED", "RUNNING", "PROCESSING"].includes(status)) break;
    }
    show(`Task ${taskId} (${name})`, task);
    if (!getPath(task, "last_error") && String(getPath(task, "status")) !== "FAILED") {
      delivered = name;
      break;
    }
  }
  console.log(
    delivered
      ? `\nResult: task with ${delivered} ran without error. Confirm the message is in the chat.`
      : "\nResult: every candidate failed or never ran (see last_error above).",
  );
}

// 3. Inspect a scheduled task
if (values.task) {
  try {
    show(`Scheduled task ${values.task}`, await chord.getScheduledTask(values.task));
  } catch (err) {
    show("Fetching scheduled task FAILED", errorInfo(err));
  }
}

// 4. Take over, send, hand back
if (values.thread && values["try-takeover"]) {
  const thread_id = values.thread;
  const before = await chord.getThread(thread_id);
  const wasAgentActive = getPath(before, "control_state") === "agent_active";
  console.log(`\nThread control_state before: ${String(getPath(before, "control_state"))}`);
  let tookOver = false;
  try {
    if (wasAgentActive) {
      show("take-over response", await chord.takeOver(thread_id));
      tookOver = true;
    }
    show("send message response", await chord.sendMessage(thread_id, buildOperatorMessageBody(values["try-takeover"])));
  } catch (err) {
    show("take-over/send FAILED", errorInfo(err));
  } finally {
    if (tookOver) {
      try {
        show("hand-back response", await chord.handBack(thread_id));
      } catch (err) {
        show("hand-back FAILED (hand the thread back in the Chord UI)", errorInfo(err));
      }
    }
    console.log(`Thread control_state after: ${String(getPath(await chord.getThread(thread_id), "control_state"))}`);
  }
}

if (!values.task && !values["try-message"] && !values["try-takeover"] && values.thread) {
  console.error("\n--thread needs --try-message or --try-takeover.");
  process.exit(1);
}
