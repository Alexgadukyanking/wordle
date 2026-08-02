import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const wordnet = require("wordnet-db");
const lemmatizer = require("wink-lemmatizer");
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const answers = JSON.parse(await readFile(path.join(projectRoot, "data", "answers.json"), "utf8"));
const answerSet = new Set(answers.map((word) => word.toLowerCase()));

const PART_ORDER = [
  "Adjective",
  "Adverb",
  "Conjunction",
  "Determiner",
  "Interjection",
  "Noun",
  "Preposition",
  "Pronoun",
  "Verb"
];

const MANUAL_PARTS = {
  ABLED: ["Adjective", "Verb"],
  ADMIN: ["Noun", "Verb"],
  AIDER: ["Noun"],
  AMONG: ["Preposition"],
  ARTSY: ["Adjective"],
  ASTRO: ["Adjective", "Noun"],
  AXION: ["Noun"],
  BALER: ["Noun"],
  BICEP: ["Noun"],
  CHEMO: ["Noun"],
  CIRCA: ["Adverb", "Preposition"],
  CREME: ["Noun"],
  CUTIE: ["Noun"],
  CYBER: ["Adjective"],
  DILLY: ["Noun"],
  DROID: ["Noun"],
  DROIT: ["Adjective", "Noun"],
  EBOOK: ["Noun"],
  EKING: ["Verb"],
  FEMME: ["Adjective", "Noun"],
  FRITZ: ["Noun"],
  GAZER: ["Noun"],
  GEEKY: ["Adjective"],
  GIRLY: ["Adjective"],
  GOLLY: ["Interjection"],
  HAUTE: ["Adjective"],
  HOMIE: ["Noun"],
  HUMPH: ["Interjection"],
  HUNKY: ["Adjective"],
  HYDRO: ["Adjective", "Noun"],
  HYPER: ["Adjective"],
  INBOX: ["Noun", "Verb"],
  KNEED: ["Verb"],
  LOGIN: ["Adjective", "Noun"],
  NERDY: ["Adjective"],
  OMBRE: ["Adjective", "Noun"],
  OUGHT: ["Verb"],
  PALEO: ["Adjective", "Noun"],
  PINEY: ["Adjective"],
  POUTY: ["Adjective"],
  QUOTH: ["Verb"],
  RALPH: ["Verb"],
  RAMEN: ["Noun"],
  REBAR: ["Noun"],
  RECUT: ["Noun", "Verb"],
  REHAB: ["Noun", "Verb"],
  ROGER: ["Interjection", "Verb"],
  SHALL: ["Verb"],
  SHALT: ["Verb"],
  SINCE: ["Adverb", "Conjunction", "Preposition"],
  SYNTH: ["Noun"],
  TASER: ["Noun", "Verb"],
  TERRA: ["Noun"],
  THEIR: ["Determiner"],
  THESE: ["Determiner", "Pronoun"],
  THOSE: ["Determiner", "Pronoun"],
  TURBO: ["Adjective", "Noun"],
  TWIXT: ["Preposition"],
  UNMET: ["Adjective"],
  UNSET: ["Adjective", "Verb"],
  UNTIL: ["Conjunction", "Preposition"],
  VOILA: ["Interjection"],
  WHERE: ["Adverb", "Conjunction"],
  WHICH: ["Determiner", "Pronoun"],
  WHOSE: ["Determiner", "Pronoun"],
  WILLY: ["Noun"]
};

const wordTypes = new Map(answers.map((word) => [word, new Set()]));
const lemmaSets = {};
for (const [file, label] of [
  ["index.adj", "Adjective"],
  ["index.adv", "Adverb"],
  ["index.noun", "Noun"],
  ["index.verb", "Verb"]
]) {
  const lemmas = new Set();
  const contents = await readFile(path.join(wordnet.path, file), "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const lemma = line.split(" ", 1)[0];
    if (!/^[a-z]+$/.test(lemma)) continue;
    lemmas.add(lemma);
    if (answerSet.has(lemma)) wordTypes.get(lemma.toUpperCase()).add(label);
  }
  lemmaSets[label] = lemmas;
}

for (const word of answers) {
  const lower = word.toLowerCase();
  for (const [label, lemmatize] of [
    ["Adjective", lemmatizer.adjective],
    ["Noun", lemmatizer.noun],
    ["Verb", lemmatizer.verb]
  ]) {
    const lemma = lemmatize(lower);
    if (lemma !== lower && lemmaSets[label].has(lemma)) wordTypes.get(word).add(label);
  }
  for (const part of MANUAL_PARTS[word] || []) wordTypes.get(word).add(part);
}

const missing = answers.filter((word) => wordTypes.get(word).size === 0);
if (missing.length) {
  throw new Error(`Missing part-of-speech metadata for: ${missing.join(", ")}`);
}

const metadata = Object.fromEntries(answers.map((word) => [
  word,
  [...wordTypes.get(word)].sort((left, right) => PART_ORDER.indexOf(left) - PART_ORDER.indexOf(right))
]));
await writeFile(
  path.join(projectRoot, "data", "word-metadata.json"),
  `${JSON.stringify(metadata, null, 2)}\n`
);
console.log(`Generated local part-of-speech metadata for ${answers.length} answers.`);
