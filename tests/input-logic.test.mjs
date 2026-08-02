import assert from "node:assert/strict";
import test from "node:test";
import { updateInputText } from "../src/input-logic.mjs";

test("letter input fills a five-letter row", () => {
  let input = "";
  for (const letter of "APPLE") input = updateInputText(input, letter);
  assert.equal(input, "APPLE");
  assert.equal(updateInputText(input, "S"), "APPLE");
});

test("backspace removes letters and unsupported keys do nothing", () => {
  assert.equal(updateInputText("WORD", "BACKSPACE"), "WOR");
  assert.equal(updateInputText("WOR", "⌫"), "WO");
  assert.equal(updateInputText("WO", "ENTER"), "WO");
  assert.equal(updateInputText("WO", "1"), "WO");
});
