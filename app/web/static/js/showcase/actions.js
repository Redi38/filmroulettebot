import { openAddSearchModal } from "../core/add-search.js";
import { apiPost } from "../core/api.js";
import { openCategoryModal, openRenameModal } from "../core/modal.js";
import { PENCIL_ICON_SVG, TRASH_ICON_SVG } from "../core/icons.js";
import { collapseAndRemoveRow, expandRowIn, removeRowOptimistically, resetRowCollapse, showInlineUndo } from "../core/rows.js";
import { showToast } from "../core/toast.js";
import { loadTrackedSeries, markShowcaseTitleInList } from "./showcase.js";

// Builds the action area on the right of a showcase row: either the
// tracked-series edit/delete button pair, an "already in list" label, or
// an add button (optionally paired with a skip button). Split out of
// row.js — this was the bulk of that file's line count.

// The same title can sit in several groups of one screen at once (a series
// that's both under "🔔 Новые сезоны" and "⏳ Скоро выйдет"). The server hands
// back an independent copy of the item per group, so adding it from one row
// used to flip only that row — the twin kept its "Добавить" button until a
// reload. Every add slot registers its item here, keyed by add-scope + title,
// so a successful add can flip all of the twins that are on screen.
const _addSlots = new Map(); // "scope|title" -> Set<{slot, item}>

function _slotKey(scope, title) {
  return `${scope}|${(title || "").trim().toLowerCase()}`;
}

function _registerAddSlot(scope, item, slot) {
  const key = _slotKey(scope, item.title);
  let set = _addSlots.get(key);
  if (!set) _addSlots.set(key, (set = new Set()));
  // Rows get thrown away on every re-render/filter change; forget the ones
  // that are no longer in the document so the registry doesn't grow forever.
  for (const entry of set) if (!entry.slot.isConnected) set.delete(entry);
  set.add({slot, item});
}

function _markAdded(scope, item, slot) {
  item.in_list = true;
  slot.innerHTML = `<span class="muted">✓ В списке</span>`;
  const set = _addSlots.get(_slotKey(scope, item.title));
  if (!set) return;
  for (const entry of set) {
    if (!entry.slot.isConnected) {
      set.delete(entry);
      continue;
    }
    entry.item.in_list = true;
    entry.slot.innerHTML = `<span class="muted">✓ В списке</span>`;
  }
}

function buildTrackedSeriesActions(item, wrap, onSkipSettled) {
  const actionSlot = document.createElement("div");
  actionSlot.className = "showcase-action showcase-action-stack";

  const edit = document.createElement("button");
  edit.className = "edit-btn";
  edit.innerHTML = PENCIL_ICON_SVG;
  edit.setAttribute("aria-label", "Изменить название");
  edit.onclick = (ev) => {
    ev.stopPropagation();
    openRenameModal(item.title, async (newTitle) => {
      const save = async (finalTitle) => {
        try {
          await apiPost("/api/tracked-series/rename", {old_title: item.title, new_title: finalTitle});
          loadTrackedSeries();
        } catch (e) {
          showToast(e.message || "Не удалось изменить название");
        }
      };
      openAddSearchModal("/api/tracked-series/search-suggest", newTitle, {
        onPick: save,
        onFallback: () => save(newTitle),
      });
    });
  };
  actionSlot.appendChild(edit);

  const del = document.createElement("button");
  del.className = "del-btn";
  del.innerHTML = TRASH_ICON_SVG;
  del.setAttribute("aria-label", "Удалить");
  del.onclick = (ev) => {
    ev.stopPropagation();
    const rowParent = wrap.parentNode;
    const rowNext = wrap.nextSibling;
    const showUndo = () => {
      showInlineUndo(rowParent, rowNext, `«${item.title}» больше не отслеживается`, "Отменить", async () => {
        try {
          await apiPost("/api/tracked-series/add", {title: item.title});
          if (onSkipSettled) onSkipSettled();
        } catch (e) {
          showToast("Не удалось восстановить");
        }
      });
    };
    removeRowOptimistically(wrap, () => apiPost("/api/tracked-series/delete", {title: item.title}), null, {onCollapseStart: showUndo});
  };
  actionSlot.appendChild(del);

  return actionSlot;
}

function buildAddActionSlot(item, cat, addMode, skipScope, wrap, onSkipSettled) {
  const actionSlot = document.createElement("div");
  actionSlot.className = "showcase-action";

  if (item.in_list) {
    actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
    return actionSlot;
  }

  // Rows of different screens/modes track "in list" against different
  // lists, so only rows sharing this scope are treated as twins.
  const scope = addMode || cat;
  _registerAddSlot(scope, item, actionSlot);

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Добавить";
  const addTo = async (endpointCat) => {
    btn.disabled = true;
    try {
      await apiPost(`/api/${endpointCat}/add`, {title: item.title});
      _markAdded(scope, item, actionSlot);
      // Filtered-out items have no row to flip, but still live in the
      // loaded catalog the "Показывать" filter reads from.
      if (!addMode) markShowcaseTitleInList(item.title, cat);
      showToast(`«${item.title}» добавлен`);
    } catch (e) {
      btn.disabled = false;
      showToast(e.message || "Не удалось добавить");
    }
  };
  const addToUpcoming = async () => {
    btn.disabled = true;
    try {
      await apiPost(`/api/upcoming/add`, {title: item.title});
      _markAdded(scope, item, actionSlot);
      showToast(`«${item.title}» добавлен в «Скоро в кино»`);
    } catch (e) {
      btn.disabled = false;
      showToast(e.message || "Не удалось добавить");
    }
  };
  btn.onclick = (ev) => {
    ev.stopPropagation();
    if (addMode === "upcoming") {
      addToUpcoming();
    } else if (addMode === "now-playing") {
      openCategoryModal(`Куда добавить «${item.title}»?`, (category) => addTo(category), ["movies", "cartoons"]);
    } else {
      addTo(cat);
    }
  };
  actionSlot.appendChild(btn);

  if (skipScope) {
    actionSlot.classList.add("showcase-action-stack");
    const skipBtn = document.createElement("button");
    skipBtn.className = "btn btn-ghost";
    skipBtn.textContent = "Пропустить";
    let confirmTimer = null;
    const doSkip = async () => {
      skipBtn.disabled = true;
      try {
        await apiPost("/api/skip", {scope: skipScope, title: item.title});
        const rowParent = wrap.parentNode;
        const rowNext = wrap.nextSibling;
        const showUndo = () => showInlineUndo(rowParent, rowNext, `«${item.title}» скрыт`, "Отменить", async () => {
          try {
            await apiPost("/api/unskip", {scope: skipScope, title: item.title});
            skipBtn.disabled = false;
            skipBtn.classList.remove("confirming");
            skipBtn.textContent = "Пропустить";
            if (rowParent && rowParent.isConnected) {
              // The node carries the inline styles its collapse left behind;
              // clear them before it re-enters the flow, then grow it back.
              resetRowCollapse(wrap);
              rowParent.insertBefore(wrap, rowNext && rowNext.isConnected ? rowNext : null);
              expandRowIn(wrap);
            } else if (onSkipSettled) {
              onSkipSettled();
            }
          } catch (e) {
            showToast("Не удалось отменить пропуск");
          }
        });
        collapseAndRemoveRow(wrap, null, {onCollapseStart: showUndo});
      } catch (e) {
        skipBtn.disabled = false;
        showToast(e.message || "Не удалось скрыть");
      }
    };
    skipBtn.onclick = (ev) => {
      ev.stopPropagation();
      if (!skipBtn.classList.contains("confirming")) {
        skipBtn.classList.add("confirming");
        skipBtn.textContent = "Точно? Ещё раз";
        confirmTimer = setTimeout(() => {
          skipBtn.classList.remove("confirming");
          skipBtn.textContent = "Пропустить";
        }, 3000);
        return;
      }
      clearTimeout(confirmTimer);
      doSkip();
    };
    actionSlot.appendChild(skipBtn);
  }

  return actionSlot;
}

export function buildShowcaseActionSlot(item, cat, addMode, skipScope, wrap, onSkipSettled) {
  return addMode === "tracked-series"
    ? buildTrackedSeriesActions(item, wrap, onSkipSettled)
    : buildAddActionSlot(item, cat, addMode, skipScope, wrap, onSkipSettled);
}
