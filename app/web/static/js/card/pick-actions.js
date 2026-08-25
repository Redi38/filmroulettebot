// Post-pick actions: confirm/sequel/delete flow after a spin result.

function confirmPick() {
  const prompt = document.getElementById("sequel-prompt");
  prompt.style.display = "block";
  prompt.innerHTML = `
    <p>Добавить продолжение (сиквел)?</p>
    <div class="card-actions">
      <button class="btn btn-success btn" onclick="sequelYes()">Да, сиквел</button>
      <button class="btn btn-danger btn" onclick="sequelNo()">Нет, удалить</button>
    </div>`;
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
    resultEl().innerHTML =
      `<div class="card"><div class="title">🔄 ${escapeHtml(currentCardData.original_title)} → ${escapeHtml(newTitle)}</div></div>`;
    currentCardData = null;
  } catch (e) { showToast(e.message); }
}

async function sequelNo() {
  if (!currentCardData) return;
  try {
    await performDelete(currentCardData.category, currentCardData.original_title);
    markCurrentPickResolved({ type: "delete" });
    resultEl().innerHTML =
      `<div class="card"><div class="title">❌ ${escapeHtml(currentCardData.original_title)} удалён</div></div>`;
    currentCardData = null;
  } catch (e) { showToast(e.message); }
}

function rerollPick(cat) { doSpin(cat); }
