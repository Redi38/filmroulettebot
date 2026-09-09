// Post-pick actions: confirm/sequel/delete flow after a spin result.

function confirmPick() {
  const prompt = document.getElementById("sequel-prompt");
  prompt.innerHTML = `
    <p>Добавить продолжение (сиквел)?</p>
    <div class="card-actions">
      <button class="btn btn-success btn" onclick="sequelYes()">Да, сиквел</button>
      <button class="btn btn-danger btn" onclick="sequelNo()">Нет, удалить</button>
    </div>`;
  prompt.style.display = "block";
  prompt.classList.remove("fade-in");
  void prompt.offsetWidth; // restart animation if confirmPick() is ever called twice
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

function rerollPick(cat) { doSpin(cat); }
