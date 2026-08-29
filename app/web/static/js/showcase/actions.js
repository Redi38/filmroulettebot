// Builds the action area on the right of a showcase row: either the
// tracked-series edit/delete button pair, an "already in list" label, or
// an add button (optionally paired with a skip button). Split out of
// row.js — this was the bulk of that file's line count.

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
          await api("/api/tracked-series/rename", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({old_title: item.title, new_title: finalTitle}),
          });
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
    removeRowOptimistically(wrap, () => api("/api/tracked-series/delete", {
      method: "POST", headers: {"Content-Type": "application/json"},
      body: JSON.stringify({title: item.title}),
    }), () => {
      showInlineUndo(rowParent, rowNext, `«${item.title}» больше не отслеживается`, "Отменить", async () => {
        try {
          await api("/api/tracked-series/add", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({title: item.title}),
          });
          if (onSkipSettled) onSkipSettled();
        } catch (e) {
          showToast("Не удалось восстановить");
        }
      });
    });
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

  const btn = document.createElement("button");
  btn.className = "btn btn-primary";
  btn.textContent = "Добавить";
  const addTo = async (endpointCat) => {
    btn.disabled = true;
    try {
      await api(`/api/${endpointCat}/add`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: item.title}),
      });
      item.in_list = true;
      actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
      showToast(`«${item.title}» добавлен`);
    } catch (e) {
      btn.disabled = false;
      showToast(e.message || "Не удалось добавить");
    }
  };
  const addToUpcoming = async () => {
    btn.disabled = true;
    try {
      await api(`/api/upcoming/add`, {
        method: "POST", headers: {"Content-Type": "application/json"},
        body: JSON.stringify({title: item.title}),
      });
      item.in_list = true;
      actionSlot.innerHTML = `<span class="muted">✓ В списке</span>`;
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
    skipBtn.textContent = "Скип";
    let confirmTimer = null;
    const doSkip = async () => {
      skipBtn.disabled = true;
      try {
        await api("/api/skip", {
          method: "POST", headers: {"Content-Type": "application/json"},
          body: JSON.stringify({scope: skipScope, title: item.title}),
        });
        const rowParent = wrap.parentNode;
        const rowNext = wrap.nextSibling;
        wrap.remove();
        showInlineUndo(rowParent, rowNext, `«${item.title}» скрыт`, "Отменить", async () => {
          try {
            await api("/api/unskip", {
              method: "POST", headers: {"Content-Type": "application/json"},
              body: JSON.stringify({scope: skipScope, title: item.title}),
            });
            skipBtn.disabled = false;
            skipBtn.classList.remove("confirming");
            skipBtn.textContent = "Скип";
            if (rowParent && rowParent.isConnected) {
              rowParent.insertBefore(wrap, rowNext && rowNext.isConnected ? rowNext : null);
            } else if (onSkipSettled) {
              onSkipSettled();
            }
          } catch (e) {
            showToast("Не удалось отменить скип");
          }
        });
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
          skipBtn.textContent = "Скип";
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

function buildShowcaseActionSlot(item, cat, addMode, skipScope, wrap, onSkipSettled) {
  return addMode === "tracked-series"
    ? buildTrackedSeriesActions(item, wrap, onSkipSettled)
    : buildAddActionSlot(item, cat, addMode, skipScope, wrap, onSkipSettled);
}
