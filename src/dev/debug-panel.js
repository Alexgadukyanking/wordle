import "./debug-panel.css";

function formatState(state) {
  return JSON.stringify(
    {
      answer: state.answer,
      guesses: state.guesses,
      current: state.current,
      finished: state.finished,
      hardcoreMode: state.hardcoreMode
    },
    null,
    2
  );
}

export function mountDebugPanel({ getState, resetGame }) {
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
          <button type="button" data-dev-action="reset">Reset game</button>
        </div>
        <output class="dev-panel-output" aria-live="polite">Debug panel ready.</output>
        <pre class="dev-panel-state" hidden></pre>
      </div>
    </details>
  `;

  const output = panel.querySelector(".dev-panel-output");
  const stateView = panel.querySelector(".dev-panel-state");

  panel.addEventListener("click", (event) => {
    const action = event.target.closest("[data-dev-action]")?.dataset.devAction;
    if (!action) return;

    if (action === "reveal") {
      output.textContent = `Current word: ${getState().answer}`;
      stateView.hidden = true;
      return;
    }

    if (action === "state") {
      stateView.textContent = formatState(getState());
      stateView.hidden = false;
      output.textContent = "Game state refreshed.";
      return;
    }

    if (action === "reset") {
      resetGame();
      output.textContent = `Game reset. Current word: ${getState().answer}`;
      stateView.hidden = true;
    }
  });

  document.body.prepend(panel);
  document.documentElement.dataset.build = "dev";
}
