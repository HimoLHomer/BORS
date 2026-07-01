import {
  isInvalidStoryField,
  isRawTopStoriesPayload,
  parseTopStoriesJson,
  parseTopStoriesJsonLenient,
  sanitizeTopStories,
  sanitizeTopStoriesFallback,
  type MarketTopStory,
} from "../src/marketTopStories.ts";
import { dedupeTopStories, validateTopStories } from "../src/marketTopStoriesValidation.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const ctx = { variant: "us" as const, marketDate: "2026-05-20", indexLabel: "S&P 500" };

const json = `{"stories":[
  {"headline":"Fed holds rates steady at 5.25%","source":"Reuters"},
  {"headline":"Fed leaves rates unchanged at 5.25%","source":"Bloomberg"},
  {"headline":"Apple reports Q2 revenue beat","source":"CNBC"}
]}`;

const parsed = parseTopStoriesJson(json);
assert(parsed !== null && parsed.length === 3, "parse JSON");

const dupes = dedupeTopStories([
  { headline: "Fed holds rates steady at 5.25%", source: "Reuters" },
  { headline: "Fed holds rates steady at 5.25%", source: "Bloomberg" },
]);
assert(dupes.length === 1, "dedupe identical headlines");

const badFuture: MarketTopStory[] = [
  { headline: "Microsoft will report earnings tomorrow", source: "WSJ" },
];
const badCheck = validateTopStories(badFuture, ctx);
assert(!badCheck.ok, "reject future tense");

const good: MarketTopStory[] = [
  { headline: "S&P 500 rises as CPI cools more than expected", source: "Reuters" },
  { headline: "Nvidia jumps after data-center revenue beat", source: "Bloomberg" },
];
const goodCheck = validateTopStories(good, ctx);
assert(goodCheck.ok && goodCheck.stories.length === 2, "accept valid stories");

const tooMany = Array.from({ length: 6 }, (_, i) => ({
  headline: `Market event number ${i + 1} reported today`,
  source: "Reuters",
}));
const manyCheck = validateTopStories(tooMany, ctx);
assert(!manyCheck.ok, "reject more than 5 stories");

const truncated = `{"stories":[{"headline":"Neste shares rise 3.5% following earnings","source":"Kauppalehti"},{"headline":"Elisa shares decline 1.1% amid sector weakness","source":"Nordnet"},{"headline":"OMX Helsinki PI gains 0.4% as`;
const lenient = parseTopStoriesJsonLenient(truncated);
assert(lenient.length === 2, "lenient parse recovers complete stories from truncated JSON");
assert(parseTopStoriesJson(truncated) === null, "strict parse fails on truncated JSON");
assert(isRawTopStoriesPayload(truncated), "truncated JSON is raw payload");
assert(
  sanitizeTopStoriesFallback(truncated).includes("No top stories found"),
  "sanitize hides truncated JSON"
);

const prettyTruncated = `{
"stories": [
{
"headline": "Micron Technology reports qua
"source": "Reuters"`;
assert(isRawTopStoriesPayload(prettyTruncated), "pretty-printed truncated JSON is raw payload");
assert(
  sanitizeTopStoriesFallback(prettyTruncated).includes("No top stories found"),
  "sanitize hides pretty-printed truncated JSON"
);

const fenced = '```json\n{"stories":[{"headline":"Fed holds rates","source":"Reuters"}]}\n```';
assert(isRawTopStoriesPayload(fenced), "fenced JSON is raw payload");

assert(isInvalidStoryField("{"), "reject lone JSON brace as source");
const garbage = sanitizeTopStories([
  {
    headline: "Nokia shares continue decline amid fading AI enthusiasm",
    source: "{",
  },
  { headline: "Elisa reports stable Q2 revenue", source: "Kauppalehti" },
]);
assert(garbage.length === 2, "keep stories with recoverable fields");
assert(garbage.every((s) => !isInvalidStoryField(s.source)), "no JSON garbage in sources");

console.log("test-top-stories-validation: all passed");
