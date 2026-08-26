// Wheel hub image: click the center circle to pick a custom picture/gif.
// Stored client-side (localStorage) — no server upload endpoint needed.
const WHEEL_HUB_STORAGE_KEY = "wheelHubImage";
function getWheelHubImage() {
  try {
    return localStorage.getItem(WHEEL_HUB_STORAGE_KEY) || WHEEL_HUB_GIF_URL || "";
  } catch (e) {
    return WHEEL_HUB_GIF_URL || "";
  }
}
function setWheelHubImage(url) {
  try {
    if (url) localStorage.setItem(WHEEL_HUB_STORAGE_KEY, url);
    else localStorage.removeItem(WHEEL_HUB_STORAGE_KEY);
  } catch (e) { }
  document.querySelectorAll(".wheel-hub-media").forEach((hub) => {
    hub.classList.remove("wheel-hub-empty");
    hub.querySelector("img")?.remove();
    const overlay = hub.querySelector(".wheel-hub-overlay");
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.onerror = () => { img.remove(); hub.classList.add("wheel-hub-empty"); };
      hub.insertBefore(img, overlay);
    } else {
      hub.classList.add("wheel-hub-empty");
    }
  });
}
let hubPopoverEl = null;
let hubModalEl = null;
const HUB_EMOTE_PRESETS = [
  { name: "catKISS", id: "60a1babb3c3362f9a4b8b33a" },
  { name: "GIGACHAD", id: "01F6MZGCNG000255K4X1K7NTHR" },
  { name: "catJAM", id: "01F6MQ33FG000FFJ97ZB8MWV52" },
  { name: "donowall", id: "60c34553ba21ed451b50582b" },
  { name: "GaySex", id: "01F7GT7BCR0006EAS00X46F8JC" },
  { name: "roundzzPivo", id: "01JTXGX823BXHG75VBV0H0XQ2T" },
  { name: "kok", id: "01FSNYHXZ80000JPZ36BHMFSD4" },
  { name: "PartyParrot", id: "01FKSDK14G0008TM5NY9QEG0QV" },
];
const hubEmoteThumbUrl = (id) => `https://cdn.7tv.app/emote/${id}/2x.webp`;
const hubEmoteFullUrl = (id) => `https://cdn.7tv.app/emote/${id}/4x.webp`;
function ensureHubUploadDom() {
  if (!hubPopoverEl) {
    hubPopoverEl = document.createElement("div");
    hubPopoverEl.className = "wheel-hub-popover";
    hubPopoverEl.innerHTML = `
      <div class="wheel-hub-emote-grid">
        ${HUB_EMOTE_PRESETS.map((e) => `<button type="button" class="wheel-hub-emote-btn" data-url="${hubEmoteFullUrl(e.id)}" title="${e.name}"><img src="${hubEmoteThumbUrl(e.id)}" alt="${e.name}" loading="lazy"></button>`).join("")}
      </div>
      <button type="button" id="wheel-hub-open-modal">Добавить изображение</button>
      <button type="button" id="wheel-hub-remove" class="wheel-hub-remove-btn">Убрать изображение</button>`;
    document.body.appendChild(hubPopoverEl);
    hubPopoverEl.querySelectorAll(".wheel-hub-emote-btn").forEach((btn) => {
      btn.onclick = () => { setWheelHubImage(btn.dataset.url); closeHubPopover(); };
    });
    hubPopoverEl.querySelector("#wheel-hub-open-modal").onclick = () => {
      closeHubPopover();
      openHubModal();
    };
    const removeBtnEl = hubPopoverEl.querySelector("#wheel-hub-remove");
    removeBtnEl.onclick = () => {
      setWheelHubImage("");
      closeHubPopover();
    };
    const addBtnEl = hubPopoverEl.querySelector("#wheel-hub-open-modal");
    const addBtnStyles = getComputedStyle(addBtnEl);
    ["display", "width", "boxSizing", "padding", "margin", "border", "borderRadius",
      "font", "fontSize", "fontWeight", "fontFamily", "lineHeight", "textAlign",
      "cursor", "boxShadow"].forEach((prop) => {
      removeBtnEl.style[prop] = addBtnStyles[prop];
    });
    removeBtnEl.style.background = "#e5484d";
    removeBtnEl.style.color = "#fff";
    removeBtnEl.style.marginTop = "8px";
  }
  if (!hubModalEl) {
    hubModalEl = document.createElement("div");
    hubModalEl.className = "wheel-hub-modal-overlay";
    hubModalEl.innerHTML = `
      <div class="wheel-hub-modal-box">
        <button type="button" class="wheel-hub-modal-close" aria-label="Закрыть">✕</button>
        <h3>Добавьте изображение для колеса</h3>
        <div class="wheel-hub-dropzone" id="wheel-hub-dropzone" tabindex="0">
          Перетащите файл сюда или нажмите
        </div>
        <input type="file" accept="image/*" id="wheel-hub-file-input" style="display:none">
        <div class="wheel-hub-modal-sep">или ссылкой</div>
        <div class="wheel-hub-url-row">
          <input type="text" id="wheel-hub-url-input" placeholder="Ссылка на картинку или гифку">
          <button type="button" id="wheel-hub-url-apply">ОК</button>
        </div>
      </div>`;
    document.body.appendChild(hubModalEl);
    const dropzone = hubModalEl.querySelector("#wheel-hub-dropzone");
    const fileInput = hubModalEl.querySelector("#wheel-hub-file-input");
    const urlInput = hubModalEl.querySelector("#wheel-hub-url-input");
    dropzone.onclick = () => fileInput.click();
    dropzone.onkeydown = (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fileInput.click(); } };
    dropzone.ondragover = (ev) => { ev.preventDefault(); dropzone.classList.add("dragover"); };
    dropzone.ondragleave = () => dropzone.classList.remove("dragover");
    dropzone.ondrop = (ev) => {
      ev.preventDefault();
      dropzone.classList.remove("dragover");
      const file = ev.dataTransfer.files && ev.dataTransfer.files[0];
      if (file) readHubFile(file);
    };
    fileInput.onchange = () => { if (fileInput.files[0]) readHubFile(fileInput.files[0]); };
    const applyUrl = () => {
      const val = urlInput.value.trim();
      if (!val) return;
      setWheelHubImage(val);
      closeHubModal();
    };
    hubModalEl.querySelector("#wheel-hub-url-apply").onclick = applyUrl;
    urlInput.onkeydown = (ev) => { if (ev.key === "Enter") applyUrl(); };
    hubModalEl.querySelector(".wheel-hub-modal-close").onclick = closeHubModal;
    hubModalEl.onclick = (ev) => { if (ev.target === hubModalEl) closeHubModal(); };
  }
}
function readHubFile(file) {
  if (!file.type.startsWith("image/")) return;
  const reader = new FileReader();
  reader.onload = () => { setWheelHubImage(reader.result); closeHubModal(); };
  reader.readAsDataURL(file);
}
function openHubPopover(anchorEl) {
  ensureHubUploadDom();
  const removeBtn = hubPopoverEl.querySelector("#wheel-hub-remove");
  if (removeBtn) removeBtn.style.display = getWheelHubImage() ? "" : "none";
  const rect = anchorEl.getBoundingClientRect();
  hubPopoverEl.classList.add("open");
  const popRect = hubPopoverEl.getBoundingClientRect();
  let left = rect.right + 10;
  let top = rect.top + rect.height / 2 - popRect.height / 2;
  if (left + popRect.width > window.innerWidth - 8) left = rect.left - popRect.width - 10;
  if (left < 8 || left + popRect.width > window.innerWidth - 8) {
    left = Math.max(8, Math.min(rect.left + rect.width / 2 - popRect.width / 2, window.innerWidth - popRect.width - 8));
    top = rect.bottom + 10;
    if (top + popRect.height > window.innerHeight - 8) top = rect.top - popRect.height - 10;
  }
  left = Math.max(8, Math.min(left, window.innerWidth - popRect.width - 8));
  top = Math.max(8, Math.min(top, window.innerHeight - popRect.height - 8));
  hubPopoverEl.style.left = left + "px";
  hubPopoverEl.style.top = top + "px";
}
function closeHubPopover() { if (hubPopoverEl) hubPopoverEl.classList.remove("open"); }
function openHubModal() {
  ensureHubUploadDom();
  hubModalEl.querySelector("#wheel-hub-url-input").value = "";
  hubModalEl.classList.add("open");
}
function closeHubModal() { if (hubModalEl) hubModalEl.classList.remove("open"); }
document.addEventListener("click", (ev) => {
  const hub = ev.target.closest(".wheel-hub-media");
  if (hub) { ev.stopPropagation(); openHubPopover(hub); return; }
  if (hubPopoverEl && !ev.target.closest(".wheel-hub-popover")) closeHubPopover();
});
document.addEventListener("keydown", (ev) => {
  const hub = document.activeElement && document.activeElement.classList?.contains("wheel-hub-media");
  if (hub && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openHubPopover(document.activeElement); }
  if (ev.key === "Escape") { closeHubPopover(); closeHubModal(); }
});
window.addEventListener("resize", closeHubPopover);
window.addEventListener("scroll", closeHubPopover, true);
