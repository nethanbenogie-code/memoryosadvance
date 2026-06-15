// Sanity tests for MemoryOS pure logic (everything that doesn't need a browser).
import { uuidv7, timestampOf } from "../js/core/ids.js";
import { EventBus, bus } from "../js/core/events.js";
import { createMemory, createLink, normalizeTags, deriveTitle, MemoryType, TaskStatus } from "../js/data/models.js";
import { SearchIndex, tokenize } from "../js/services/search-service.js";
import { extractTags } from "../js/services/memory-service.js";
import { dayKey, dayBounds } from "../js/services/journal-service.js";
import { computeRewards, pointsFor, POINTS_BASE, POINTS_ON_TIME_BONUS } from "../js/services/rewards-service.js";
import { planMerge, validateSnapshot, backupFilename, BACKUP_FORMAT, BACKUP_SCHEMA } from "../js/services/backup-service.js";
import { renderMarkdown } from "../js/ui/manual-view.js";
import { hashSecret, randomSaltHex, generateRecoveryCode, normalizeRecoveryCode, constantEqual } from "../js/services/lock-service.js";
import { SB_CATEGORIES, getLifeStats, FAMILY_ARCHIVE_ALBUM_NAME, SUGGESTED_ARCHIVES, ARCHIVE_NAME_PATTERN, hasSeenCognitiveLinkingIntro, markCognitiveLinkingIntroSeen, shouldAutoShowCognitiveLinkingIntro } from "../js/services/mnemosyne-service.js";
import { buildContext, getSuggestedPrompts, clearHistory, getHistory } from "../js/ai/ai-service.js";
import { MemoryType as MT2, ImportanceLevel, createMemoryCard, createMediaRef, MediaType } from "../js/data/models.js";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok  " + name); }
  catch (e) { failed++; console.error("FAIL  " + name + " — " + e.message); }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }

// --- ids ---
test("uuidv7 format", () => {
  const id = uuidv7();
  assert(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id), id);
});
test("uuidv7 ids are time-ordered and unique", () => {
  const ids = Array.from({length: 500}, () => uuidv7());
  assert(new Set(ids).size === 500, "duplicates");
  const sorted = [...ids].sort();
  assert(JSON.stringify(sorted) === JSON.stringify(ids), "not monotone-friendly");
});
test("timestampOf round-trip", () => {
  const now = Date.now();
  const t = timestampOf(uuidv7(now)).getTime();
  assert(Math.abs(t - now) <= 1, `delta ${t - now}`);
});

// --- events ---
test("event bus on/emit/off + error isolation", () => {
  const b = new EventBus();
  let hits = 0;
  const off = b.on("x", () => hits++);
  b.on("x", () => { throw new Error("boom"); });
  b.on("x", () => hits++);
  b.emit("x");
  assert(hits === 2, "handlers should run despite one throwing");
  off();
  b.emit("x");
  assert(hits === 3, "unsubscribe failed");
});

// --- models ---
test("createMemory defaults + occurredAt fallback", () => {
  const m = createMemory({ title: "Hello", content: "World" });
  assert(m.type === MemoryType.NOTE && m.occurredAt === m.createdAt && m.deletedAt === null);
});
test("task gets pending status; note gets null", () => {
  assert(createMemory({ type: "task", title: "t" }).status === TaskStatus.PENDING);
  assert(createMemory({ title: "n" }).status === null);
});
test("title derived from content when missing", () => {
  const m = createMemory({ content: "First line here\nmore" });
  assert(m.title === "First line here", m.title);
});
test("rejects empty memory and unknown type", () => {
  let threw = 0;
  try { createMemory({}); } catch { threw++; }
  try { createMemory({ type: "alien", title: "x" }); } catch { threw++; }
  assert(threw === 2);
});
test("normalizeTags dedupes, lowercases, strips #", () => {
  assert(JSON.stringify(normalizeTags(["#Work", "work", " POS "])) === JSON.stringify(["work", "pos"]));
});
test("createLink validates", () => {
  const l = createLink("a", "b");
  assert(l.sourceId === "a" && l.targetId === "b");
  let threw = false;
  try { createLink("a", "a"); } catch { threw = true; }
  assert(threw, "self-link allowed");
});
test("deriveTitle truncates", () => {
  assert(deriveTitle("x".repeat(200)).length === 80);
});

// --- capture parsing ---
test("extractTags pulls inline #tags out of text", () => {
  const { text, tags } = extractTags("Fix the BIR export #apos #urgent\nDetails here");
  assert(JSON.stringify(tags) === JSON.stringify(["apos", "urgent"]), tags.join());
  assert(text.startsWith("Fix the BIR export"), text);
  assert(!text.includes("#"), text);
});

// --- search ---
test("search: AND terms, prefix on last term, filters", () => {
  const idx = new SearchIndex();
  const m1 = createMemory({ title: "APOS BIR transmitter", tags: ["apos"], occurredAt: "2026-06-10T00:00:00Z" });
  const m2 = createMemory({ type: "task", title: "Fix MLEA receipt numbering", tags: ["mlea"], occurredAt: "2026-06-11T00:00:00Z" });
  const m3 = createMemory({ title: "Bible study notes", content: "Strong's concordance", occurredAt: "2026-06-12T00:00:00Z" });
  idx.build([m1, m2, m3]);
  assert(idx.search("bir trans").length === 1, "prefix match");
  assert(idx.search("fix receipt").length === 1, "AND");
  assert(idx.search("", { tag: "mlea" })[0].id === m2.id, "tag filter");
  assert(idx.search("", { type: "task" }).length === 1, "type filter");
  idx.update({ ...m3, deletedAt: "2026-06-12T01:00:00Z" });
  assert(idx.search("concordance").length === 0, "deleted stays indexed");
  const counts = idx.tagCounts();
  assert(counts.length === 2, "tagCounts");
});
test("tokenize is unicode-friendly", () => {
  assert(JSON.stringify(tokenize("Magandang araw, kaibigan!")) === JSON.stringify(["magandang","araw","kaibigan"]));
});

// --- journal day math ---
test("dayKey and dayBounds are consistent", () => {
  const key = dayKey(new Date(2026, 5, 13, 15, 30));
  assert(key === "2026-06-13", key);
  const { startIso, endIso } = dayBounds(key);
  assert(new Date(endIso) - new Date(startIso) === 86400000, "not 24h");
});

// --- import graph of UI modules (no DOM access at import time) ---
test("UI modules import cleanly without a DOM", async () => {
  await import("../js/ui/components.js");
  await import("../js/ui/capture.js");
  await import("../js/ui/timeline-view.js");
  await import("../js/ui/search-view.js");
  await import("../js/ui/tasks-view.js");
  await import("../js/ui/journal-view.js");
  await import("../js/data/db.js");
  await import("../js/data/repository.js");
});

// --- rewards ---
test("pointsFor: base + on-time bonus", () => {
  const base = { dueAt: null, extra: { completedAt: "2026-06-13T01:00:00Z" } };
  assert(pointsFor(base) === POINTS_BASE);
  const onTime = { dueAt: "2026-06-13T02:00:00Z", extra: { completedAt: "2026-06-13T01:00:00Z" } };
  assert(pointsFor(onTime) === POINTS_BASE + POINTS_ON_TIME_BONUS);
  const late = { dueAt: "2026-06-13T00:30:00Z", extra: { completedAt: "2026-06-13T01:00:00Z" } };
  assert(pointsFor(late) === POINTS_BASE, "late tasks still earn base points — no punishment");
});
test("computeRewards: totals, today, level, progress", () => {
  const now = new Date(2026, 5, 13, 12, 0);
  const iso = (d, h) => new Date(2026, 5, d, h).toISOString();
  const done = (d, h) => ({ status: "completed", dueAt: null, extra: { completedAt: iso(d, h) } });
  const tasks = [
    done(13, 9), done(13, 10),               // today: 20 pts
    done(12, 9), done(11, 9),                // streak back to the 11th
    { status: "pending", dueAt: null, extra: {} },
  ];
  const r = computeRewards(tasks, now);
  assert(r.totalPoints === 40, "total " + r.totalPoints);
  assert(r.todayPoints === 20, "today " + r.todayPoints);
  assert(r.streak === 3, "streak " + r.streak);
  assert(r.level === 1 && r.intoLevel === 40 && r.completedCount === 4);
});
test("computeRewards: streak survives an unfinished today", () => {
  const now = new Date(2026, 5, 13, 8, 0);
  const done = (d) => ({ status: "completed", dueAt: null, extra: { completedAt: new Date(2026, 5, d, 9).toISOString() } });
  const r = computeRewards([done(12), done(11)], now);
  assert(r.streak === 2, "yesterday's streak should still stand this morning, streak=" + r.streak);
});
test("computeRewards: empty list is calm, not crashing", () => {
  const r = computeRewards([]);
  assert(r.totalPoints === 0 && r.streak === 0 && r.level === 1);
});
test("new modules import cleanly without a DOM", async () => {
  await import("../js/services/reminder-service.js");
  await import("../js/ui/celebration.js");
});

// --- backup / restore merge ---
test("planMerge: insert new, newer wins, idempotent", () => {
  const mem = (id, mod) => ({ id, modifiedAt: mod, title: id });
  const existing = [mem("a", "2026-06-10T00:00:00Z"), mem("b", "2026-06-12T00:00:00Z")];
  const snapshot = { memories: [
    mem("a", "2026-06-11T00:00:00Z"),   // newer -> update
    mem("b", "2026-06-01T00:00:00Z"),   // older -> skip
    mem("c", "2026-06-13T00:00:00Z"),   // new   -> insert
  ], links: [{ id: "L1" }] };
  const plan = planMerge(existing, [], snapshot);
  assert(plan.report.inserted === 1 && plan.report.updated === 1 && plan.report.unchanged === 1, JSON.stringify(plan.report));
  assert(plan.linksToWrite.length === 1);
  // Idempotence: applying the plan then re-merging the same snapshot = no-op
  const after = [...existing.filter(m => m.id !== "a"), ...plan.memoriesToWrite];
  const again = planMerge(after, snapshot.links, snapshot);
  assert(again.report.inserted === 0 && again.report.updated === 0 && again.report.newLinks === 0, "restore must be safely repeatable");
});
test("planMerge: tombstones travel through backups", () => {
  const dead = { id: "x", modifiedAt: "2026-06-12T00:00:00Z", deletedAt: "2026-06-12T00:00:00Z" };
  const plan = planMerge([{ id: "x", modifiedAt: "2026-06-10T00:00:00Z", deletedAt: null }], [], { memories: [dead], links: [] });
  assert(plan.memoriesToWrite[0].deletedAt !== null, "deletion must propagate on restore");
});
test("validateSnapshot rejects garbage, accepts real backups", () => {
  assert(validateSnapshot(null) !== null);
  assert(validateSnapshot({ format: "other" }) !== null);
  assert(validateSnapshot({ format: BACKUP_FORMAT, schema: BACKUP_SCHEMA + 1, memories: [] }) !== null, "future schema refused politely");
  assert(validateSnapshot({ format: BACKUP_FORMAT, schema: BACKUP_SCHEMA, memories: [], links: [] }) === null);
});
test("backupFilename is dated and filesystem-safe", () => {
  const name = backupFilename(new Date(2026, 5, 13, 14, 5));
  assert(name === "memoryos-backup-2026-06-13-1405.json", name);
});
test("backup modules import cleanly without a DOM", async () => {
  await import("../js/ui/backup-view.js");
  await import("../js/ui/share.js");
});

// --- in-app manual renderer ---
test("renderMarkdown: headings, lists, bold, code, rules", () => {
  const html = renderMarkdown("# Title\n\nHello **world** and `code`.\n\n- one\n- two\n\n---\n\n## Next");
  assert(html.includes("<h1>Title</h1>"), "h1");
  assert(html.includes("<strong>world</strong>") && html.includes("<code>code</code>"), "inline");
  assert(html.includes("<ul>") && html.includes("<li>one</li>"), "list");
  assert(html.includes("<hr/>") && html.includes("<h2>Next</h2>"), "hr + h2");
});
test("renderMarkdown escapes HTML — no script injection via the manual", () => {
  const html = renderMarkdown("Hello <script>alert(1)</script> **<b>bold</b>**");
  assert(!html.includes("<script>"), "script tag must be escaped");
  assert(html.includes("&lt;script&gt;"), "escaped form present");
});
test("renderMarkdown handles the real manual without crashing", async () => {
  const { readFileSync } = await import("node:fs");
  const real = readFileSync(new URL("../docs/USER-MANUAL.md", import.meta.url), "utf8");
  const html = renderMarkdown(real);
  assert(html.includes("<h1>") && html.split("<h2>").length >= 15, "all sections rendered");
  assert(!/<(script|iframe)/i.test(html), "no active content");
});
test("about/manual views import cleanly without a DOM", async () => {
  await import("../js/ui/about-view.js");
});

// --- app lock crypto ---
let asyncChecks = Promise.resolve();
test("lock: PBKDF2 hash is deterministic per salt, distinct across salts", () => {
  asyncChecks = (async () => {
    const salt = randomSaltHex();
    const a = await hashSecret("hunter2", salt);
    const b = await hashSecret("hunter2", salt);
    const c = await hashSecret("hunter2", randomSaltHex());
    const d = await hashSecret("hunter3", salt);
    if (a !== b) throw new Error("same input+salt must match");
    if (a === c) throw new Error("different salts must differ");
    if (a === d) throw new Error("different passwords must differ");
    if (!/^[0-9a-f]{64}$/.test(a)) throw new Error("expected 256-bit hex");
  })();
});
test("lock: recovery code format and forgiving normalization", () => {
  const code = generateRecoveryCode();
  assert(/^[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/.test(code), code);
  assert(normalizeRecoveryCode(" ab cd-EFgh-jkmn ") === "ABCDEFGHJKMN");
  assert(normalizeRecoveryCode(code) === code.replace(/-/g, ""));
});
test("lock: constant-time-style compare", () => {
  assert(constantEqual("abc", "abc") && !constantEqual("abc", "abd") && !constantEqual("abc", "abcd") && !constantEqual("abc", null));
});
test("lock screen module imports cleanly without a DOM", async () => {
  await import("../js/ui/lock-screen.js");
});

// --- Project Mnemosyne ---
test("models: new MemoryTypes exist", () => {
  assert(MT2.MEMORY_CARD === "memory_card");
  assert(MT2.LEARNING === "learning");
  assert(MT2.ARTICLE === "article");
});
test("ImportanceLevel enum is correct", () => {
  assert(ImportanceLevel.MILESTONE === 4 && ImportanceLevel.HIGH === 3);
});
test("createMemoryCard factory sets defaults", () => {
  const card = createMemoryCard({ title: "Family Reunion 2026" });
  assert(card.type === "memory_card");
  assert(Array.isArray(card.extra.people) && card.extra.externalMedia.length === 0);
  assert(card.extra.importanceLevel === ImportanceLevel.MEDIUM);
});
test("createMediaRef produces a valid reference", () => {
  const ref = createMediaRef({ label: "Facebook → Family Archive", type: MediaType.FACEBOOK_ALBUM });
  assert(ref.label === "Facebook → Family Archive" && ref.type === "facebook_album" && ref.id);
});
test("SB_CATEGORIES covers all expected filters", () => {
  const ids = SB_CATEGORIES.map(c => c.id);
  assert(ids.includes("all") && ids.includes("memory_card") && ids.includes("journal") && ids.includes("task"));
});
test("Mnemosyne modules import cleanly", async () => {
  await import("../js/services/mnemosyne-service.js");
  await import("../js/ui/second-brain-view.js");
  await import("../js/ui/memory-card-capture.js");
  await import("../js/ui/memory-detail.js");
  await import("../js/ui/cognitive-linking-onboarding.js");
});
test("Cognitive Linking: onboarding-state API is exposed", () => {
  assert(typeof hasSeenCognitiveLinkingIntro === "function", "hasSeenCognitiveLinkingIntro exported");
  assert(typeof markCognitiveLinkingIntroSeen === "function", "markCognitiveLinkingIntroSeen exported");
  assert(typeof shouldAutoShowCognitiveLinkingIntro === "function", "shouldAutoShowCognitiveLinkingIntro exported");
});
test("Cognitive Linking: suggested archives are universal, not family-only", () => {
  assert(FAMILY_ARCHIVE_ALBUM_NAME === "MemoryOS - Family Archive", "family example kept");
  assert(/<Topic>/.test(ARCHIVE_NAME_PATTERN), "naming pattern exposes a topic slot");
  const topics = SUGGESTED_ARCHIVES.map(a => a.topic);
  assert(topics.includes("Family"), "family is offered");
  assert(topics.includes("Travel") && topics.includes("Learning") && topics.includes("Work"), "non-family archives offered");
  assert(SUGGESTED_ARCHIVES.every(a => a.name.startsWith("MemoryOS - ")), "all follow the convention");
});

test("Time queries: parse periods relative to a fixed date", async () => {
  const { parsePeriod } = await import("../js/services/time-query-service.js");
  const now = new Date(2026, 5, 14); // Sun Jun 14 2026
  const r = (q) => parsePeriod(q, now);
  assert(r("what happened last june?").startIso.slice(0,10) === "2025-06-01", "'last june' → June 2025");
  assert(r("what happened last june?").endIso.slice(0,10) === "2025-07-01", "'last june' end exclusive");
  assert(r("june 2025").startIso.slice(0,10) === "2025-06-01", "explicit June 2025");
  assert(r("this month").startIso.slice(0,10) === "2026-06-01", "this month");
  assert(r("last month").startIso.slice(0,10) === "2026-05-01", "last month");
  assert(r("yesterday").startIso.slice(0,10) === "2026-06-13", "yesterday");
  assert(r("in 2024").startIso.slice(0,10) === "2024-01-01", "year 2024 start");
  assert(r("in 2024").endIso.slice(0,10) === "2025-01-01", "year 2024 end exclusive");
  assert(r("june 12, 2025").startIso.slice(0,10) === "2025-06-12", "specific dated day");
  assert(r("2026-06-12").startIso.slice(0,10) === "2026-06-12", "ISO date");
  assert(r("how are my goals?") === null, "no time expression → null");
});

test("Time queries: detect type filters", async () => {
  const { parseTypeFilters, typeFilterLabel } = await import("../js/services/time-query-service.js");
  assert(parseTypeFilters("show my journal yesterday").includes("journal"), "journal detected");
  assert(parseTypeFilters("my notes from last week").includes("note"), "notes detected");
  assert(parseTypeFilters("tasks this month").includes("task"), "tasks detected");
  assert(parseTypeFilters("what happened last june") === null, "no kind → null (all)");
  assert(typeFilterLabel(null) === "memories", "null label");
  assert(typeFilterLabel(["journal"]) === "journal entries", "journal label");
});

// --- AI service ---
test("AI: getHistory starts empty and clearHistory resets it", () => {
  clearHistory();
  assert(getHistory().length === 0);
});
test("Semantic service exposes its API and imports cleanly", async () => {
  const sem = await import("../js/services/semantic-service.js");
  assert(sem.EMBED_MODEL === "Xenova/all-MiniLM-L6-v2");
  assert(typeof sem.embedText === "function");
  assert(typeof sem.semanticSearch === "function");
  assert(typeof sem.indexAll === "function");
  assert(typeof sem.indexMemory === "function");
  assert(sem.state && sem.state.ready === false && sem.state.indexing === false);
});

test("AI modules import cleanly without a DOM", async () => {
  await import("../js/ai/ai-service.js");
  await import("../js/ai/ai-view.js");
});

await asyncChecks.catch(e => { failed++; console.error("FAIL  lock crypto — " + e.message); });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
