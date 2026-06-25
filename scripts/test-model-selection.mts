/**
 * Unit checks for Gemini model selection heuristics.
 * Run: npm run test:ai
 */
import assert from "node:assert/strict";
import { generateWithFallback } from "../server/ai/generateWithFallback.ts";
import {
  GEMINI_ALL_MODELS_BUSY_MESSAGE,
  GEMINI_FALLBACK_MODELS,
  isTransientGeminiFailure,
  mergeModelLists,
  normalizeModelId,
  isRetiredGeminiModel,
  scoreGeminiModel,
  sortGeminiModels,
  shouldTryNextModel,
} from "../server/ai/modelSelection.ts";

function testNormalizeModelId() {
  assert.equal(normalizeModelId("models/gemini-2.5-flash"), "gemini-2.5-flash");
}

function testRetiredModels() {
  assert.equal(isRetiredGeminiModel("gemini-1.5-flash"), true);
  assert.equal(isRetiredGeminiModel("gemini-2.5-flash"), false);
}

function testMergeModelLists() {
  const list = mergeModelLists(
    ["gemini-2.0-flash", "gemini-2.5-flash"],
    GEMINI_FALLBACK_MODELS
  );
  assert.equal(list[0], "gemini-2.0-flash");
  assert.ok(list.includes("gemini-2.5-flash"));
}

function testSortGeminiPrefersFlashLite() {
  const sorted = sortGeminiModels([
    "gemini-2.0-flash",
    "gemini-2.5-flash-lite",
    "gemini-embedding-001",
    "gemini-2.5-flash",
  ]);
  assert.equal(sorted[0], "gemini-2.5-flash-lite");
  assert.ok(scoreGeminiModel(sorted[sorted.length - 1]!) < 0);
}

function testIsTransientGeminiFailure() {
  assert.equal(
    isTransientGeminiFailure(
      "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later."
    ),
    true
  );
  assert.equal(isTransientGeminiFailure("Service unavailable (503)"), true);
  assert.equal(isTransientGeminiFailure('{"error":{"code":403,"message":"API key invalid"}}'), false);
}

function testShouldTryNextModel() {
  const notFound = new Error('{"error":{"code":404,"message":"model not found"}}');
  assert.equal(shouldTryNextModel(notFound), true);

  const auth = new Error('{"error":{"code":403,"message":"API key invalid"}}');
  assert.equal(shouldTryNextModel(auth), false);

  const quota = new Error('{"error":{"code":429,"message":"quota exceeded"}}');
  assert.equal(shouldTryNextModel(quota), true);

  const busy = new Error(
    "This model is currently experiencing high demand. Please try again later."
  );
  assert.equal(shouldTryNextModel(busy), true);

  const unavailable = new Error('{"error":{"code":503,"message":"UNAVAILABLE"}}');
  assert.equal(shouldTryNextModel(unavailable), true);
}

async function testGenerateWithFallbackSkipsBusyModel() {
  const busy =
    "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.";
  const storiesJson = JSON.stringify({
    stories: [{ headline: "Fed holds rates steady", source: "Reuters" }],
  });

  const outcome = await generateWithFallback(
    ["gemini-2.5-flash", "gemini-2.0-flash"],
    async (model) => {
      if (model === "gemini-2.5-flash") {
        return { summary: busy };
      }
      return { summary: storiesJson };
    },
    "prompt"
  );

  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("expected success");
  assert.equal(outcome.result.model, "gemini-2.0-flash");
  assert.equal(outcome.result.stories?.[0]?.headline, "Fed holds rates steady");
}

async function testGenerateWithFallbackAllBusy() {
  const busy =
    "This model is currently experiencing high demand. Please try again later.";

  const outcome = await generateWithFallback(
    ["gemini-2.5-flash", "gemini-2.0-flash"],
    async () => ({ summary: busy }),
    "prompt"
  );

  assert.equal(outcome.ok, false);
  if (outcome.ok) throw new Error("expected failure");
  assert.equal(outcome.error.message, GEMINI_ALL_MODELS_BUSY_MESSAGE);
  assert.equal(outcome.error.httpStatus, 503);
}

async function testGenerateWithFallbackEmptyStoriesJson() {
  const outcome = await generateWithFallback(
    ["gemini-2.5-flash"],
    async () => ({ summary: '{"stories":[]}' }),
    "prompt"
  );

  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("expected success");
  assert.equal(outcome.result.summary, "No top stories found for this market date. Try refresh in a few minutes.");
  assert.equal(outcome.result.stories, undefined);
}

async function testGenerateWithFallbackSkipsEmptyStoriesModel() {
  const storiesJson = JSON.stringify({
    stories: [{ headline: "Nokia shares rise on earnings beat", source: "Kauppalehti" }],
  });

  const outcome = await generateWithFallback(
    ["gemini-2.5-flash", "gemini-2.0-flash"],
    async (model) => {
      if (model === "gemini-2.5-flash") {
        return { summary: '{"stories":[]}' };
      }
      return { summary: storiesJson };
    },
    "prompt"
  );

  assert.equal(outcome.ok, true);
  if (!outcome.ok) throw new Error("expected success");
  assert.equal(outcome.result.model, "gemini-2.0-flash");
  assert.equal(outcome.result.stories?.[0]?.headline, "Nokia shares rise on earnings beat");
}

async function main() {
  testNormalizeModelId();
  testRetiredModels();
  testMergeModelLists();
  testSortGeminiPrefersFlashLite();
  testIsTransientGeminiFailure();
  testShouldTryNextModel();
  await testGenerateWithFallbackSkipsBusyModel();
  await testGenerateWithFallbackAllBusy();
  await testGenerateWithFallbackEmptyStoriesJson();
  await testGenerateWithFallbackSkipsEmptyStoriesModel();
  console.log("test-model-selection: all passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
