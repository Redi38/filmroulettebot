// Shared row renderer for "title + edit + delete-with-undo" lists.
// Used by list-items.js (per-category lists) and upcoming-list.js.
// All API calls stay in the caller (endpoints differ), this only owns
// the DOM + optimistic-delete/undo wiring so it's written once.

function createEditableRow(title, opts) {
  const row = document.createElement("div");
  row.className = "list-row";

  const span = document.createElement("span");
  span.className = "copy-title";
  span.textContent = title;
  span.title = "Нажмите, чтобы скопировать";
  span.onclick = () => copyToClipboard(title, span);
  row.appendChild(span);

  const edit = document.createElement("button");
  edit.className = "edit-btn";
  edit.innerHTML = PENCIL_ICON_SVG;
  edit.setAttribute("aria-label", "Изменить название");
  edit.onclick = (ev) => {
    ev.stopPropagation();
    openRenameModal(title, async (newTitle) => {
      try {
        await opts.onRename(newTitle);
        opts.onReload();
      } catch (e) {
        showToast(e.message || "Не удалось изменить название");
      }
    });
  };
  row.appendChild(edit);

  const del = document.createElement("button");
  del.className = "del-btn";
  del.innerHTML = TRASH_ICON_SVG;
  del.setAttribute("aria-label", "Удалить");
  del.onclick = (ev) => {
    ev.stopPropagation();
    const rowParent = row.parentNode;
    const rowNext = row.nextSibling;
    removeRowOptimistically(row, opts.onDelete, () => {
      showInlineUndo(rowParent, rowNext, `«${title}» удалён`, "Отменить", async () => {
        try {
          await opts.onRestore();
          opts.onReload();
        } catch (e) {
          showToast("Не удалось восстановить");
        }
      }, opts.onUndoSettled);
    });
  };
  row.appendChild(del);

  return row;
}
