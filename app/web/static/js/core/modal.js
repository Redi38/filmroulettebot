function openCategoryModal(titleText, onPick, allowedCats) {
  const overlay = document.getElementById("modal-overlay");
  const optionsEl = document.getElementById("modal-options");
  document.getElementById("modal-title").textContent = titleText;
  optionsEl.innerHTML = "";
  const cats = allowedCats
    ? Object.fromEntries(Object.entries(CATS).filter(([code]) => allowedCats.includes(code)))
    : CATS;
  for (const [code, label] of Object.entries(cats)) {
    const b = document.createElement("button");
    b.className = "btn btn-primary";
    b.textContent = label;
    b.onclick = () => { closeModal(); onPick(code); };
    optionsEl.appendChild(b);
  }
  overlay.classList.add("open");
}
function closeModal() { document.getElementById("modal-overlay").classList.remove("open"); }
document.getElementById("modal-cancel").onclick = closeModal;
document.getElementById("modal-overlay").onclick = (ev) => { if (ev.target.id === "modal-overlay") closeModal(); };

function openRenameModal(currentTitle, onSave) {
  const overlay = document.getElementById("rename-modal-overlay");
  const input = document.getElementById("rename-modal-input");
  input.value = currentTitle;
  overlay.classList.add("open");
  requestAnimationFrame(() => { input.focus(); input.select(); });

  const close = () => { overlay.classList.remove("open"); cleanup(); };
  const save = () => {
    const value = input.value.trim();
    if (!value || value === currentTitle) { close(); return; }
    close();
    onSave(value);
  };
  const onKeydown = (ev) => {
    if (ev.key === "Enter") save();
    else if (ev.key === "Escape") close();
  };
  const onOverlayClick = (ev) => { if (ev.target === overlay) close(); };

  function cleanup() {
    saveBtn.removeEventListener("click", save);
    cancelBtn.removeEventListener("click", close);
    input.removeEventListener("keydown", onKeydown);
    overlay.removeEventListener("click", onOverlayClick);
  }

  const saveBtn = document.getElementById("rename-modal-save");
  const cancelBtn = document.getElementById("rename-modal-cancel");
  saveBtn.addEventListener("click", save);
  cancelBtn.addEventListener("click", close);
  input.addEventListener("keydown", onKeydown);
  overlay.addEventListener("click", onOverlayClick);
}
