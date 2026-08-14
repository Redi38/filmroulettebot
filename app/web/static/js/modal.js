function openCategoryModal(titleText, onPick) {
  const overlay = document.getElementById("modal-overlay");
  const optionsEl = document.getElementById("modal-options");
  document.getElementById("modal-title").textContent = titleText;
  optionsEl.innerHTML = "";
  for (const [code, label] of Object.entries(CATS)) {
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
