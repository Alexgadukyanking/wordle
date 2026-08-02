import "./debug-panel.css";

function formatState(state) {
  return JSON.stringify(
    {
      gameId: state.gameId,
      guesses: state.guesses,
      guessResults: state.guessResults,
      current: state.current,
      finished: state.finished,
      gameStatus: state.gameStatus,
      hardcoreMode: state.hardcoreMode,
      allowAnyGuess: state.allowAnyGuess
    },
    null,
    2
  );
}

export function mountDebugPanel({ getState, revealAnswer, toggleAnyGuess, resetDatabase }) {
  const panel = document.createElement("aside");
  panel.className = "dev-panel";
  panel.setAttribute("aria-label", "Development tools");
  panel.innerHTML = `
    <details open>
      <summary>
        <span>Development build</span>
        <small>Debug tools</small>
      </summary>
      <div class="dev-panel-content">
        <p class="dev-panel-warning">Development data may be reset at any time.</p>
        <div class="dev-panel-actions">
          <button type="button" data-dev-action="reveal">Reveal current word</button>
          <button type="button" data-dev-action="state">Refresh game state</button>
          <button type="button" data-dev-action="any-guess" aria-pressed="false">Allow any 5 letters: Off</button>
          <a href="/dev/accounts.html">Account database</a>
          <button type="button" data-dev-action="reset-database">Reset entire database</button>
        </div>
        <output class="dev-panel-output" aria-live="polite">Debug panel ready.</output>
        <pre class="dev-panel-state" hidden></pre>
      </div>
    </details>
  `;

  const output = panel.querySelector(".dev-panel-output");
  const stateView = panel.querySelector(".dev-panel-state");

  panel.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-dev-action]")?.dataset.devAction;
    if (!action) return;
    const buttons = [...panel.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });

    try {
      if (action === "reveal") {
        output.textContent = `Current word: ${await revealAnswer()}`;
        stateView.hidden = true;
      } else if (action === "state") {
        stateView.textContent = formatState(getState());
        stateView.hidden = false;
        output.textContent = "Client game state refreshed.";
      } else if (action === "any-guess") {
        const enabled = toggleAnyGuess();
        const toggle = panel.querySelector('[data-dev-action="any-guess"]');
        toggle.setAttribute("aria-pressed", String(enabled));
        toggle.textContent = `Allow any 5 letters: ${enabled ? "On" : "Off"}`;
        output.textContent = enabled
          ? "Dictionary validation disabled for dev guesses."
          : "Dictionary validation restored.";
        stateView.hidden = true;
      } else if (action === "reset-database") {
        const confirmed = window.confirm(
          "This permanently deletes every local development account, session, game, guess, hint, and statistic. Reset the entire database?"
        );
        if (!confirmed) {
          output.textContent = "Database reset cancelled.";
          return;
        }
        output.textContent = "Resetting the entire database…";
        await resetDatabase();
      }
    } catch (error) {
      output.textContent = `Debug request failed: ${error.message}`;
      stateView.hidden = true;
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  });

  document.body.prepend(panel);
  document.documentElement.dataset.build = "dev";
}
