const WORDS = Array.isArray(window.FIVE_LETTER_WORDS)
  ? window.FIVE_LETTER_WORDS
  : [];
const validWords = new Set(WORDS);

const VICTORY_REACTION_SPECS = [
  {
    name: "Success Kid",
    fallback: "https://i.imgflip.com/1bhk.jpg"
  },
  {
    name: "Leonardo Dicaprio Cheers",
    fallback: "https://i.imgflip.com/39t1o.jpg"
  },
  {
    name: "Oprah You Get A",
    fallback: "https://i.imgflip.com/gtj5t.jpg"
  },
  {
    name: "Third World Success Kid",
    fallback: "https://i.imgflip.com/265j.jpg"
  },
  {
    name: "Laughing Leo",
    fallback: "https://i.imgflip.com/4acd7j.jpg"
  }
];

let victoryReactions = VICTORY_REACTION_SPECS.map((reaction) => ({
  ...reaction,
  image: reaction.fallback
}));

const KEY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["ENTER", "Z", "X", "C", "V", "B", "N", "M", "⌫"]
];

const STORAGE_KEY = "five-word-state-v1";
const board = document.querySelector("#board");
const keyboard = document.querySelector("#keyboard");
const message = document.querySelector("#message");
const helpDialog = document.querySelector("#help-dialog");
const hardcoreButton = document.querySelector("#hardcore-button");
const hardcoreLabel = document.querySelector("#hardcore-label");
const hardcoreNote = document.querySelector("#hardcore-note");
const possibleCount = document.querySelector("#possible-count");
const cameraCard = document.querySelector(".camera-card");
const cameraVideo = document.querySelector("#camera-video");
const cameraButton = document.querySelector("#camera-button");
const cameraStatus = document.querySelector("#camera-status");
const victoryDialog = document.querySelector("#victory-dialog");
const victoryImage = document.querySelector("#victory-image");
const victoryWord = document.querySelector("#victory-word");
const hintFirstLetter = document.querySelector("#hint-first-letter");
const hintLastLetter = document.querySelector("#hint-last-letter");
const hintDouble = document.querySelector("#hint-double");
const hintVowels = document.querySelector("#hint-vowels");
const hintPartOfSpeech = document.querySelector("#hint-part-of-speech");

let answer;
let guesses;
let current;
let finished;
let hardcoreMode = false;
let audioContext;
let cameraStream;
let lastVictoryReactionIndex = -1;
let hintLookupToken = 0;

const ADJECTIVE_WORDS = new Set(
  "ACUTE AWARE BASIC BLACK BLIND BROAD BROWN CIVIL CLEAN CLEAR EAGER EARLY ELITE EMPTY EQUAL EXACT FALSE FINAL FIXED FRESH FUNNY GRAND GREAT GREEN GROSS HAPPY HEAVY IDEAL INNER LARGE LEGAL LOCAL LOOSE LUCKY MAJOR MINOR MORAL OTHER PLAIN PRIME PROUD QUICK QUIET RAPID READY RIGHT ROUGH ROYAL RURAL SHARP SHORT SMALL SMART SOLID SORRY SWEET THICK TIGHT TIRED TOUGH UPPER URBAN USUAL VALID VITAL WHITE WHOLE WRONG YOUNG".split(" ")
);

const VERB_WORDS = new Set(
  "ADMIT ADOPT AGREE ALLOW APPLY ARGUE ARISE AVOID BEGIN BREAK BRING BUILD CARRY CATCH CHASE CHECK CLAIM CLICK COVER CRASH DRINK DRIVE ENJOY ENTER EXIST FIGHT FOCUS FORCE GUARD GUESS GUIDE LEARN LEAVE MATCH MOUNT OCCUR OFFER PAINT PROVE RAISE REACH REFER SERVE SHARE SHINE SHOOT SLEEP SOLVE SPEAK SPEND SPLIT STAND START STICK STUDY TEACH THINK THROW TOUCH TRAIN TREAT TRUST VISIT WATCH WRITE YIELD".split(" ")
);

function playLetterSound() {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  audioContext ||= new AudioContext();
  if (audioContext.state === "suspended") audioContext.resume();
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(520, now);
  oscillator.frequency.exponentialRampToValueAtTime(360, now + 0.045);
  gain.gain.setValueAtTime(0.055, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.05);
}

function stopCamera() {
  cameraStream?.getTracks().forEach((track) => track.stop());
  cameraStream = undefined;
  cameraVideo.srcObject = null;
  cameraCard.classList.remove("camera-on");
  cameraButton.textContent = "Enable camera";
  cameraStatus.textContent = "Camera is off";
}

async function loadVictoryReactions() {
  try {
    const response = await fetch("https://api.imgflip.com/get_memes");
    const payload = await response.json();
    const popular = payload?.data?.memes;
    if (!Array.isArray(popular)) return;

    victoryReactions = VICTORY_REACTION_SPECS.map((reaction) => {
      const current = popular.find((meme) => meme.name === reaction.name);
      return { ...reaction, image: current?.url || reaction.fallback };
    });
  } catch {
    // The curated fallback URLs remain available when the live list is blocked.
  }
}

function localPartOfSpeech(word) {
  if (ADJECTIVE_WORDS.has(word)) return "Adjective";
  if (VERB_WORDS.has(word)) return "Verb";
  return "Noun";
}

function closeHints() {
  document
    .querySelectorAll(".hints-panel details")
    .forEach((hint) => { hint.open = false; });
}

async function updateHints() {
  const letters = [...answer];
  hintFirstLetter.textContent = letters[0];
  hintLastLetter.textContent = letters.at(-1);
  hintDouble.textContent = new Set(letters).size < letters.length ? "Yes" : "No";
  hintVowels.textContent = String(letters.filter((letter) => "AEIOU".includes(letter)).length);
  hintPartOfSpeech.textContent = localPartOfSpeech(answer);

  const token = ++hintLookupToken;
  try {
    const response = await fetch(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${answer.toLowerCase()}`
    );
    if (!response.ok) return;
    const entries = await response.json();
    const accepted = new Set(["adjective", "noun", "verb"]);
    const parts = [
      ...new Set(
        entries
          .flatMap((entry) => entry.meanings || [])
          .map((meaning) => meaning.partOfSpeech)
          .filter((part) => accepted.has(part))
      )
    ];

    if (token === hintLookupToken && parts.length) {
      hintPartOfSpeech.textContent = parts
        .map((part) => part[0].toUpperCase() + part.slice(1))
        .join(" / ");
    }
  } catch {
    // Keep the local classification when dictionary lookup is unavailable.
  }
}

function showVictory() {
  let index;
  do {
    index = Math.floor(Math.random() * victoryReactions.length);
  } while (
    victoryReactions.length > 1 &&
    index === lastVictoryReactionIndex
  );

  lastVictoryReactionIndex = index;
  const reaction = victoryReactions[index];
  victoryImage.src = reaction.image;
  victoryImage.alt = reaction.name;
  victoryWord.textContent = `The word was ${answer}.`;
  if (!victoryDialog.open) victoryDialog.showModal();
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "Camera needs HTTPS or localhost";
    cameraButton.textContent = "Camera unavailable";
    cameraButton.disabled = true;
    return;
  }

  cameraButton.disabled = true;
  cameraButton.textContent = "Connecting…";
  cameraStatus.textContent = "Waiting for permission";

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 480 },
        height: { ideal: 640 }
      },
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    await cameraVideo.play();
    cameraCard.classList.add("camera-on");
    cameraButton.textContent = "Turn camera off";
    cameraStatus.textContent = "Camera is on";
  } catch {
    cameraStatus.textContent = "Camera permission was not granted";
    cameraButton.textContent = "Try camera again";
  } finally {
    cameraButton.disabled = false;
  }
}

function chooseAnswer() {
  const day = Math.floor(Date.now() / 86400000);
  return WORDS[day % WORDS.length];
}

function chooseDifferentAnswer(previousAnswer) {
  const choices = WORDS.filter((word) => word !== previousAnswer);
  return choices[Math.floor(Math.random() * choices.length)];
}

function buildBoard() {
  board.innerHTML = "";
  for (let row = 0; row < 6; row += 1) {
    const rowElement = document.createElement("div");
    rowElement.className = "row";
    for (let column = 0; column < 5; column += 1) {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.row = row;
      tile.dataset.column = column;
      rowElement.appendChild(tile);
    }
    board.appendChild(rowElement);
  }
}

function renderLetter(element, letter) {
  element.textContent = letter || "";
}

function buildKeyboard() {
  keyboard.innerHTML = "";
  KEY_ROWS.forEach((letters) => {
    const row = document.createElement("div");
    row.className = "keyboard-row";
    letters.forEach((letter) => {
      const key = document.createElement("button");
      key.className = `key ${letter.length > 1 ? "wide" : ""}`;
      renderLetter(key, letter);
      key.dataset.key = letter;
      key.setAttribute("aria-label", letter === "⌫" ? "Backspace" : letter);
      key.addEventListener("click", () => handleKey(letter));
      row.appendChild(key);
    });
    keyboard.appendChild(row);
  });
}

function saveGame() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ answer, guesses, current, finished, hardcoreMode })
  );
}

function renderSavedGame() {
  guesses.forEach((guess, rowIndex) => {
    const result = scoreGuess(guess);
    const row = board.children[rowIndex];
    [...row.children].forEach((tile, columnIndex) => {
      const letter = guess[columnIndex];
      renderLetter(tile, letter);
      tile.classList.add("filled", result[columnIndex]);
      updateKey(letter, result[columnIndex]);
    });
  });

  updateCurrentRow();

  if (finished) {
    const won = guesses.at(-1) === answer;
    message.textContent = won ? "You got it!" : `The word was ${answer}`;
  }
}

function loadGame() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (
      WORDS.includes(saved?.answer) &&
      Array.isArray(saved.guesses) &&
      saved.guesses.length <= 6 &&
      saved.guesses.every((guess) => /^[A-Z]{5}$/.test(guess)) &&
      typeof saved.current === "string" &&
      /^[A-Z]{0,5}$/.test(saved.current)
    ) {
      answer = saved.answer;
      guesses = saved.guesses;
      current = saved.current;
      finished = Boolean(saved.finished);
      hardcoreMode = Boolean(saved.hardcoreMode);
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function startGame(reset = false) {
  const previousAnswer = answer;
  const selectedMode = hardcoreMode;
  if (victoryDialog.open) victoryDialog.close();
  closeHints();
  guesses = [];
  current = "";
  finished = false;
  message.textContent = "";

  if (reset) {
    localStorage.removeItem(STORAGE_KEY);
    answer = chooseDifferentAnswer(previousAnswer);
    hardcoreMode = selectedMode;
  } else {
    answer = chooseAnswer();
    loadGame();
  }

  buildBoard();
  buildKeyboard();
  renderSavedGame();
  updateHardcoreControl();
  updatePossibleWords();
  saveGame();
  updateHints();
}

function showMessage(text) {
  message.textContent = text;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    if (!finished) message.textContent = "";
  }, 1800);
}

function updateCurrentRow() {
  const row = board.children[guesses.length];
  if (!row) return;
  [...row.children].forEach((tile, index) => {
    renderLetter(tile, current[index]);
    tile.classList.toggle("filled", Boolean(current[index]));
  });
}

function scoreAgainst(guess, target) {
  const result = Array(5).fill("absent");
  const remaining = target.split("");

  guess.split("").forEach((letter, index) => {
    if (letter === target[index]) {
      result[index] = "correct";
      remaining[index] = null;
    }
  });

  guess.split("").forEach((letter, index) => {
    if (result[index] === "correct") return;
    const match = remaining.indexOf(letter);
    if (match !== -1) {
      result[index] = "present";
      remaining[match] = null;
    }
  });

  return result;
}

function scoreGuess(guess) {
  return scoreAgainst(guess, answer);
}

function updatePossibleWords() {
  if (guesses.length === 0) {
    possibleCount.textContent = WORDS.length.toLocaleString();
    return;
  }

  const cluePatterns = guesses.map((guess) =>
    scoreGuess(guess).join(",")
  );
  const remaining = WORDS.reduce((count, candidate) => {
    const matchesEveryClue = guesses.every(
      (guess, index) =>
        scoreAgainst(guess, candidate).join(",") === cluePatterns[index]
    );
    return count + Number(matchesEveryClue);
  }, 0);

  possibleCount.textContent = remaining.toLocaleString();
}

function updateKey(letter, status) {
  const key = keyboard.querySelector(`[data-key="${letter}"]`);
  if (!key) return;
  const rank = { absent: 1, present: 2, correct: 3 };
  const oldStatus = ["absent", "present", "correct"].find((name) =>
    key.classList.contains(name)
  );
  if (!oldStatus || rank[status] > rank[oldStatus]) {
    key.classList.remove("absent", "present", "correct");
    key.classList.add(status);
  }
}

function updateHardcoreControl() {
  hardcoreButton.classList.toggle("active", hardcoreMode);
  hardcoreButton.setAttribute("aria-pressed", String(hardcoreMode));
  hardcoreButton.disabled = guesses.length > 0;
  hardcoreLabel.textContent = `Hardcore: ${hardcoreMode ? "On" : "Off"}`;
  hardcoreNote.textContent = guesses.length > 0
    ? "Mode locked for this puzzle"
    : "Revealed clues become mandatory";
}

function getHardcoreConstraints() {
  const fixed = Array(5).fill(null);
  const blocked = Array.from({ length: 5 }, () => new Set());
  const minimums = new Map();
  const maximums = new Map();

  guesses.forEach((guess) => {
    const result = scoreGuess(guess);
    const guessCounts = new Map();
    const matchedCounts = new Map();

    [...guess].forEach((letter, index) => {
      guessCounts.set(letter, (guessCounts.get(letter) || 0) + 1);
      if (result[index] === "correct") {
        fixed[index] = letter;
      } else if (result[index] === "present") {
        blocked[index].add(letter);
      }
      if (result[index] !== "absent") {
        matchedCounts.set(letter, (matchedCounts.get(letter) || 0) + 1);
      }
    });

    guessCounts.forEach((count, letter) => {
      const matched = matchedCounts.get(letter) || 0;
      minimums.set(letter, Math.max(minimums.get(letter) || 0, matched));
      if (matched < count) {
        maximums.set(
          letter,
          Math.min(maximums.get(letter) ?? Infinity, matched)
        );
      }
    });
  });

  return { fixed, blocked, minimums, maximums };
}

function validateHardcoreGuess(guess) {
  if (!hardcoreMode || guesses.length === 0) return "";
  const { fixed, blocked, minimums, maximums } = getHardcoreConstraints();
  const counts = new Map();
  [...guess].forEach((letter) => {
    counts.set(letter, (counts.get(letter) || 0) + 1);
  });

  for (let index = 0; index < fixed.length; index += 1) {
    if (fixed[index] && guess[index] !== fixed[index]) {
      return `Position ${index + 1} must be ${fixed[index]}`;
    }
    if (blocked[index].has(guess[index])) {
      return `${guess[index]} can't be in position ${index + 1}`;
    }
  }

  for (const [letter, minimum] of minimums) {
    if ((counts.get(letter) || 0) < minimum) {
      return minimum === 1
        ? `Guess must contain ${letter}`
        : `Guess must contain ${minimum} ${letter}s`;
    }
  }

  for (const [letter, maximum] of maximums) {
    const count = counts.get(letter) || 0;
    if (count > maximum) {
      return maximum === 0
        ? `${letter} is not in the word`
        : `Use no more than ${maximum} ${letter}`;
    }
  }

  return "";
}

function submitGuess() {
  if (current.length !== 5) {
    showMessage("Not enough letters");
    shakeRow();
    return;
  }
  if (!validWords.has(current)) {
    showMessage("Not in word list");
    shakeRow();
    return;
  }
  const hardcoreError = validateHardcoreGuess(current);
  if (hardcoreError) {
    showMessage(hardcoreError);
    shakeRow();
    return;
  }
  const submittedGuess = current;
  const row = board.children[guesses.length];
  const result = scoreGuess(submittedGuess);
  [...row.children].forEach((tile, index) => {
    window.setTimeout(() => {
      tile.classList.add(result[index]);
      updateKey(submittedGuess[index], result[index]);
    }, index * 120);
  });

  guesses.push(submittedGuess);
  updateHardcoreControl();
  updatePossibleWords();
  const won = submittedGuess === answer;
  current = "";

  if (won) {
    finished = true;
    window.setTimeout(() => { message.textContent = "You got it!"; }, 650);
    window.setTimeout(showVictory, 850);
  } else if (guesses.length === 6) {
    finished = true;
    window.setTimeout(() => { message.textContent = `The word was ${answer}`; }, 650);
  }
  saveGame();
}

function shakeRow() {
  const row = board.children[guesses.length];
  row.classList.remove("shake");
  void row.offsetWidth;
  row.classList.add("shake");
}

function handleKey(key) {
  if (finished) return;
  if (key === "ENTER") {
    submitGuess();
  } else if (key === "⌫" || key === "BACKSPACE") {
    current = current.slice(0, -1);
    updateCurrentRow();
    saveGame();
  } else if (/^[A-Z]$/.test(key) && current.length < 5) {
    current += key;
    playLetterSound();
    updateCurrentRow();
    saveGame();
  }
}

document.addEventListener("keydown", (event) => {
  if (helpDialog.open || victoryDialog.open) return;
  const key = event.key.toUpperCase();
  if (key === "ENTER" || key === "BACKSPACE" || /^[A-Z]$/.test(key)) {
    event.preventDefault();
    handleKey(key);
  }
});

document.querySelector("#help-button").addEventListener("click", () => helpDialog.showModal());
document.querySelector(".close-button").addEventListener("click", () => helpDialog.close());
document.querySelector("#reset-button").addEventListener("click", () => startGame(true));
hardcoreButton.addEventListener("click", () => {
  if (guesses.length > 0) return;
  hardcoreMode = !hardcoreMode;
  updateHardcoreControl();
  saveGame();
});
document.querySelector("#current-year").textContent = new Date().getFullYear();
document.querySelector("#victory-reset-button").addEventListener("click", () => startGame(true));
document.querySelector("#victory-admire-button").addEventListener("click", () => victoryDialog.close());
cameraButton.addEventListener("click", () => {
  if (cameraStream) {
    stopCamera();
  } else {
    startCamera();
  }
});
window.addEventListener("pagehide", () => {
  cameraStream?.getTracks().forEach((track) => track.stop());
});

function initializeGame() {
  if (WORDS.length === 0) {
    message.textContent = "Word database could not be loaded";
    keyboard.setAttribute("aria-disabled", "true");
    return;
  }
  startGame();
  startCamera();
  loadVictoryReactions();
}

initializeGame();
