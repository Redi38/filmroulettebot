// Post-pick actions: confirm/sequel/delete/watched flow after a spin result.

function confirmPick() {
  const prompt = document.getElementById("sequel-prompt");
  prompt.innerHTML = `
    <p>Добавить продолжение (сиквел)?</p>
    <div class="card-actions">
      <button class="btn btn-success btn" data-card-action="sequel-yes">Да, сиквел</button>
      <button class="btn btn-danger btn" data-card-action="sequel-no">Нет, удалить</button>
      <button class="btn btn-primary btn" data-card-action="watched" title="Просмотрено — без сиквела и без удаления из списка">Подтвердить</button>
    </div>`;
  prompt.style.display = "block";
  prompt.classList.remove("fade-in");
  void prompt.offsetWidth;
  prompt.classList.add("fade-in");
}

function markCurrentPickResolved(outcome) {
  if (!currentCardData || currentCardData.history_timestamp == null) return;
  const key = `${currentCardData.category}|${currentCardData.original_title}|${currentCardData.history_timestamp}`;
  markResolved(key, outcome);
  resolveOnServer(
    currentCardData.category,
    currentCardData.original_title,
    currentCardData.history_timestamp,
    outcome.type,
    outcome.newTitle || null
  );
}

async function sequelYes() {
  if (!currentCardData) return;
  try {
    const newTitle = await performSequel(currentCardData.category, currentCardData.original_title);
    markCurrentPickResolved({ type: "sequel", newTitle });
    const container = resultEl();
    await fadeOut(container);
    container.innerHTML =
      `<div class="card card-simple"><div class="title">🔄 ${escapeHtml(currentCardData.original_title)} → ${escapeHtml(newTitle)}</div></div>`;
    fadeIn(container);
    currentCardData = null;
  } catch (e) { showToast(e.message); }
}

async function sequelNo() {
  if (!currentCardData) return;
  try {
    await performDelete(currentCardData.category, currentCardData.original_title);
    markCurrentPickResolved({ type: "delete" });
    const container = resultEl();
    await fadeOut(container);
    container.innerHTML =
      `<div class="card card-simple"><div class="title">❌ ${escapeHtml(currentCardData.original_title)} удалён</div></div>`;
    fadeIn(container);
    currentCardData = null;
  } catch (e) { showToast(e.message); }
}

async function pickWatched() {
  if (!currentCardData) return;
  markCurrentPickResolved({ type: "watched" });
  const container = resultEl();
  await fadeOut(container);
  container.innerHTML =
    `<div class="card card-simple"><div class="title">✅ ${escapeHtml(currentCardData.original_title)} просмотрено</div></div>`;
  fadeIn(container);
  currentCardData = null;
}

function rerollPick() { doSpin(); }

// Cards are rendered as HTML strings in several places (spin result, list
// featured card, poster modal), so their buttons dispatch through one
// delegated listener keyed on `data-card-action` rather than inline
// handler attributes.
const CARD_ACTIONS = {
  "confirm": () => confirmPick(),
  "reroll": () => rerollPick(),
  "sequel-yes": () => sequelYes(),
  "sequel-no": () => sequelNo(),
  "watched": () => pickWatched(),
  "copy-title": (el) => {
    const card = el.closest(".card");
    copyToClipboard(card ? card.dataset.title : el.textContent, el);
  },
};
document.addEventListener("click", (ev) => {
  const el = ev.target.closest("[data-card-action]");
  if (!el) return;
  const handler = CARD_ACTIONS[el.dataset.cardAction];
  if (handler) handler(el);
});
