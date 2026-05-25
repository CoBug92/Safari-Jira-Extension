(() => {
  const SORT_MODE_STORAGE_KEY = "jiraEpicPlatformSortMode";
  const VISIBLE_FIELDS_STORAGE_KEY = "jiraEpicPlatformVisibleFields";
  const DEFAULT_SORT_MODE = "default";
  const DEFAULT_VISIBLE_FIELDS = {
    platform: true,
    storyPoints: true,
    copyIssueLink: true
  };
  const SORT_LABELS = {
    default: "По умолчанию",
    issueKey: "По номеру задачи",
    platform: "По Platform",
    storyPoints: "По Story Points"
  };
  const extensionApi = typeof browser !== "undefined" ? browser : chrome;

  const getSettings = () => new Promise((resolve) => {
    extensionApi.storage.local.get({
      [SORT_MODE_STORAGE_KEY]: DEFAULT_SORT_MODE,
      [VISIBLE_FIELDS_STORAGE_KEY]: DEFAULT_VISIBLE_FIELDS
    }, (items) => {
      resolve({
        sortMode: items[SORT_MODE_STORAGE_KEY] || DEFAULT_SORT_MODE,
        visibleFields: { ...DEFAULT_VISIBLE_FIELDS, ...(items[VISIBLE_FIELDS_STORAGE_KEY] || {}) }
      });
    });
  });

  const setSortMode = (sortMode) => new Promise((resolve) => {
    extensionApi.storage.local.set({ [SORT_MODE_STORAGE_KEY]: sortMode }, resolve);
  });

  const setVisibleFields = (visibleFields) => new Promise((resolve) => {
    extensionApi.storage.local.set({ [VISIBLE_FIELDS_STORAGE_KEY]: visibleFields }, resolve);
  });

  const notifyActiveTab = (settings) => new Promise((resolve) => {
    if (!extensionApi.tabs?.query || !extensionApi.tabs?.sendMessage) {
      resolve();
      return;
    }

    extensionApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs?.[0]?.id;
      if (tabId === undefined) {
        resolve();
        return;
      }

      try {
        extensionApi.tabs.sendMessage(tabId, {
          type: "jiraEpicPlatformSettingsChanged",
          settings
        }, resolve);
      } catch (_) {
        resolve();
      }
    });
  });

  const updateSortLabel = (sortMode) => {
    document.querySelector("[data-sort-current]").textContent = SORT_LABELS[sortMode] || SORT_LABELS[DEFAULT_SORT_MODE];
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const settings = await getSettings();
    updateSortLabel(settings.sortMode);

    document.querySelectorAll('input[name="visibleField"]').forEach((input) => {
      input.checked = settings.visibleFields[input.value] !== false;
      input.addEventListener("change", async () => {
        const visibleFields = Object.fromEntries(Array.from(document.querySelectorAll('input[name="visibleField"]')).map((fieldInput) => [fieldInput.value, fieldInput.checked]));
        await Promise.all([
          setVisibleFields(visibleFields),
          notifyActiveTab({ visibleFields })
        ]);
      });
    });

    const currentInput = document.querySelector(`input[name="sortMode"][value="${settings.sortMode}"]`);
    (currentInput || document.querySelector(`input[name="sortMode"][value="${DEFAULT_SORT_MODE}"]`)).checked = true;

    document.querySelectorAll('input[name="sortMode"]').forEach((input) => {
      input.addEventListener("change", async () => {
        if (input.checked) {
          updateSortLabel(input.value);
          await Promise.all([
            setSortMode(input.value),
            notifyActiveTab({ sortMode: input.value })
          ]);
        }
      });
    });
  });
})();
