/**
 * Unit checks for AI model selection heuristics.
 * Run: npm run test:ai
 */
import assert from "node:assert/strict";
import {
  GEMINI_FALLBACK_MODELS,
  mergeModelLists,
  normalizeModelId,
  isRetiredModel,
  scoreGeminiModel,
  scoreOpenAiModel,
  sortGeminiModels,
  sortOpenAiModels,
  shouldTryNextModel,
  openAiSupportsChat,
} from "../server/ai/modelSelection.ts";

function testNormalizeModelId() {
  assert.equal(normalizeModelId("models/gemini-2.5-flash"), "gemini-2.5-flash");
}

function testRetiredModels() {
  assert.equal(isRetiredModel("gemini", "gemini-1.5-flash"), true);
  assert.equal(isRetiredModel("gemini", "gemini-2.5-flash"), false);
}

function testMergeModelLists() {
  const list = mergeModelLists(
    "gemini",
    ["gemini-2.0-flash", "gemini-2.5-flash"],
    GEMINI_FALLBACK_MODELS,
    "gemini-1.5-flash"
  );
  assert.equal(list[0], "gemini-2.0-flash");
  assert.ok(!list.includes("gemini-1.5-flash"));
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

function testSortOpenAiPrefersMini() {
  const sorted = sortOpenAiModels(["gpt-4o", "gpt-4o-mini", "text-embedding-3-small"]);
  assert.equal(sorted[0], "gpt-4o-mini");
  assert.ok(!openAiSupportsChat("text-embedding-3-small"));
}

function testShouldTryNextModel() {
  const notFound = new Error('{"error":{"code":404,"message":"model not found"}}');
  assert.equal(shouldTryNextModel(notFound, "gemini"), true);

  const auth = new Error('{"error":{"code":403,"message":"API key invalid"}}');
  assert.equal(shouldTryNextModel(auth, "gemini"), false);

  const quota = new Error('{"error":{"code":429,"message":"quota exceeded"}}');
  assert.equal(shouldTryNextModel(quota, "openai"), true);
}

function main() {
  testNormalizeModelId();
  testRetiredModels();
  testMergeModelLists();
  testSortGeminiPrefersFlashLite();
  testSortOpenAiPrefersMini();
  testShouldTryNextModel();
  console.log("test-model-selection: all passed");
}

main();
