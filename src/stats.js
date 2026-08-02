const status = document.querySelector("#stats-status");
const signedOut = document.querySelector("#stats-signed-out");
const signedIn = document.querySelector("#stats-signed-in");
const distribution = document.querySelector("#stats-guess-distribution");

function setText(selector, value) {
  document.querySelector(selector).textContent = String(value);
}

function renderStatistics(user, statistics) {
  setText("#stats-username", `@${user.username}`);
  setText("#stats-games-no-hints", statistics.gamesNoHints.toLocaleString());
  setText("#stats-wins-no-hints", statistics.winsNoHints.toLocaleString());
  setText("#stats-win-rate-no-hints", `${statistics.winRateNoHints}%`);

  const maximum = Math.max(1, ...statistics.guessDistribution);
  distribution.replaceChildren();
  statistics.guessDistribution.forEach((wins, index) => {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const bar = document.createElement("div");
    const value = document.createElement("strong");
    label.textContent = String(index + 1);
    label.setAttribute("aria-label", `${index + 1} guesses`);
    bar.className = "distribution-bar";
    bar.style.setProperty("--bar-width", `${Math.max(7, (wins / maximum) * 100)}%`);
    value.textContent = wins.toLocaleString();
    bar.appendChild(value);
    item.append(label, bar);
    distribution.appendChild(item);
  });
}

async function loadStatistics() {
  try {
    const response = await fetch("/api/auth/me", {
      headers: { accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);

    status.hidden = true;
    if (!payload.user) {
      signedOut.hidden = false;
      return;
    }

    renderStatistics(payload.user, payload.statistics);
    signedIn.hidden = false;
  } catch (error) {
    status.textContent = `Statistics unavailable: ${error.message}`;
  }
}

loadStatistics();
