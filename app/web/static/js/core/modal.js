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
