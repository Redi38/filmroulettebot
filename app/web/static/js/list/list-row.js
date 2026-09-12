// Shared row renderer for "title + edit + delete-with-undo" lists.
// Used by list-items.js (per-category lists) and upcoming-list.js.
// All API calls stay in the caller (endpoints differ), this only owns
// the DOM + optimistic-delete/undo wiring so it's written once.

function createEditableRow(title, opts) {
  const row = document.createElement("div");
  row.className = "list-row fade-in";

  if (opts.posterUrl) {
    const poster = document.createElement("img");
    poster.className = "list-row-poster";
    poster.src = opts.posterUrl;
    poster.alt = "";
    poster.loading = "lazy";
    row.appendChild(poster);
  } else if (opts.showPosterSlot) {
    const posterEmpty = document.createElement("div");
    posterEmpty.className = "list-row-poster list-row-poster-empty";
    row.appendChild(posterEmpty);
  }

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
      const save = async (finalTitle, suggestion) => {
        try {
          await opts.onRename(finalTitle, suggestion);
          opts.onReload();
        } catch (e) {
          showToast(e.message || "Не удалось изменить название", "error");
        }
      };
      if (opts.searchEndpoint) {
        openAddSearchModal(opts.searchEndpoint, newTitle, {
          onPick: save,
          onFallback: () => save(newTitle),
        });
      } else {
        save(newTitle);
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
    const showUndo = () => {
      showInlineUndo(rowParent, rowNext, `«${title}» удалён`, "Отменить", async () => {
        try {
          await opts.onRestore();
          if (opts.onCountChange) opts.onCountChange(1);
          opts.onReload();
        } catch (e) {
          showToast("Не удалось восстановить");
        }
      }, opts.onUndoSettled);
    };
    removeRowOptimistically(row, opts.onDelete, () => {
      if (opts.onCountChange) opts.onCountChange(-1);
    }, {onCollapseStart: showUndo});
  };
  row.appendChild(del);

  return row;
}
