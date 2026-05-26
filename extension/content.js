(() => {
  const FIELD_CLASS = "jira-epic-platform-field";
  const FIELD_COLUMN_CLASS = "jira-epic-platform-column";
  const COPY_LINK_BUTTON_CLASS = "jira-epic-platform-copy-link";
  const FIELD_LOADING_CLASS = "jira-epic-platform-field-loading";
  const INJECTED_FIELD_SELECTOR = `.${FIELD_CLASS},.${COPY_LINK_BUTTON_CLASS}`;
  const REFRESH_DELAY_MS = 300;
  const SETTINGS_POLL_INTERVAL_MS = 500;
  const ISSUE_KEY_PATTERN = /[A-Z][A-Z0-9]+-\d+/g;
  const CELL_SELECTOR = 'td,th,[role="cell"],[role="gridcell"],[data-testid*="cell" i]';
  const SORT_MODE_STORAGE_KEY = "jiraEpicPlatformSortMode";
  const VISIBLE_FIELDS_STORAGE_KEY = "jiraEpicPlatformVisibleFields";
  const DEFAULT_SORT_MODE = "default";
  const SORT_MODES = new Set([DEFAULT_SORT_MODE, "issueKey", "platform", "storyPoints"]);
  const SORT_FIELD_BY_MODE = {
    platform: "platform",
    storyPoints: "storyPoints"
  };
  const FIELD_DEFINITIONS = [
    { key: "platform", label: "Platform", names: ["Platform"], insertAfter: "issueKey", insertMode: "inline" },
    { key: "storyPoints", label: "Story Points", names: ["Story Points", "Story point estimate", "Story Points Estimate"], insertAfter: "column", insertMode: "column", columnPosition: 5 }
  ];
  const DISPLAY_OPTION_DEFINITIONS = [
    ...FIELD_DEFINITIONS,
    { key: "copyIssueLink" }
  ];
  const DEFAULT_VISIBLE_FIELDS = Object.fromEntries(DISPLAY_OPTION_DEFINITIONS.map((field) => [field.key, true]));
  const ORIGINAL_INDEX_DATA_KEY = "jiraEpicPlatformOriginalIndex";
  const extensionApi = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);

  let lastRefreshSignature = null;
  let refreshTimer = null;
  let routeAbortController = null;
  let currentSortMode = DEFAULT_SORT_MODE;
  let currentVisibleFields = { ...DEFAULT_VISIBLE_FIELDS };
  let currentSettingsSignature = "";
  const issueCache = new Map();

  const normalizeSortMode = (sortMode) => SORT_MODES.has(sortMode) ? sortMode : DEFAULT_SORT_MODE;
  const normalizeVisibleFields = (visibleFields = {}) => ({
    ...DEFAULT_VISIBLE_FIELDS,
    ...Object.fromEntries(DISPLAY_OPTION_DEFINITIONS.map((field) => [field.key, visibleFields[field.key] !== false]))
  });

  const getSettingsSignature = (sortMode, visibleFields) => JSON.stringify({
    sortMode,
    visibleFields: normalizeVisibleFields(visibleFields)
  });

  const loadSettings = () => new Promise((resolve) => {
    if (!extensionApi?.storage?.local) {
      resolve({ sortMode: DEFAULT_SORT_MODE, visibleFields: { ...DEFAULT_VISIBLE_FIELDS } });
      return;
    }

    extensionApi.storage.local.get({
      [SORT_MODE_STORAGE_KEY]: DEFAULT_SORT_MODE,
      [VISIBLE_FIELDS_STORAGE_KEY]: DEFAULT_VISIBLE_FIELDS
    }, (items) => {
      resolve({
        sortMode: normalizeSortMode(items?.[SORT_MODE_STORAGE_KEY]),
        visibleFields: normalizeVisibleFields(items?.[VISIBLE_FIELDS_STORAGE_KEY])
      });
    });
  });

  const watchSettings = () => {
    extensionApi?.storage?.onChanged?.addListener((changes, areaName) => {
      if (areaName !== "local") {
        return;
      }

      let shouldRefresh = false;
      if (changes[SORT_MODE_STORAGE_KEY]) {
        currentSortMode = normalizeSortMode(changes[SORT_MODE_STORAGE_KEY].newValue);
        shouldRefresh = true;
      }

      if (changes[VISIBLE_FIELDS_STORAGE_KEY]) {
        currentVisibleFields = normalizeVisibleFields(changes[VISIBLE_FIELDS_STORAGE_KEY].newValue);
        removeHiddenFields(currentVisibleFields);
        shouldRefresh = true;
      }

      if (shouldRefresh) {
        lastRefreshSignature = null;
        scheduleRefresh();
      }
    });
  };

  const applySettings = (settings = {}) => {
    if (settings.sortMode !== undefined) {
      currentSortMode = normalizeSortMode(settings.sortMode);
    }

    if (settings.visibleFields !== undefined) {
      currentVisibleFields = normalizeVisibleFields(settings.visibleFields);
      removeHiddenFields(currentVisibleFields);
    }

    currentSettingsSignature = getSettingsSignature(currentSortMode, currentVisibleFields);
    lastRefreshSignature = null;
    routeAbortController?.abort();
    refresh();
  };

  const applyLoadedSettings = (settings) => {
    const nextSignature = getSettingsSignature(settings.sortMode, settings.visibleFields);
    if (nextSignature === currentSettingsSignature) {
      return;
    }

    currentSettingsSignature = nextSignature;
    applySettings(settings);
  };

  const pollSettings = () => {
    if (!extensionApi?.storage?.local) {
      return;
    }

    window.setInterval(() => {
      loadSettings().then(applyLoadedSettings).catch(() => {});
    }, SETTINGS_POLL_INTERVAL_MS);
  };

  const watchMessages = () => {
    extensionApi?.runtime?.onMessage?.addListener((message) => {
      if (message?.type !== "jiraEpicPlatformSettingsChanged") {
        return;
      }

      applySettings(message.settings);
    });
  };

  const isPotentialJiraPage = () => {
    const hostname = window.location.hostname.toLowerCase();
    return hostname.endsWith(".atlassian.net") || hostname.includes("jira") || window.location.pathname.includes("/browse/");
  };

  const scheduleRefresh = () => {
    window.clearTimeout(refreshTimer);
    refreshTimer = window.setTimeout(refresh, REFRESH_DELAY_MS);
  };

  const normalizeIssueKey = (value) => {
    const match = String(value || "").match(/[A-Z][A-Z0-9]+-\d+/i);
    return match ? match[0].toUpperCase() : null;
  };

  const compareIssueKeys = (leftKey, rightKey) => {
    const leftMatch = String(leftKey).match(/^([A-Z][A-Z0-9]+)-(\d+)$/);
    const rightMatch = String(rightKey).match(/^([A-Z][A-Z0-9]+)-(\d+)$/);

    if (leftMatch && rightMatch && leftMatch[1] === rightMatch[1]) {
      return Number(leftMatch[2]) - Number(rightMatch[2]);
    }

    return String(leftKey).localeCompare(String(rightKey), undefined, { numeric: true, sensitivity: "base" });
  };

  const compareText = (leftText, rightText) => String(leftText || "").localeCompare(String(rightText || ""), undefined, {
    numeric: true,
    sensitivity: "base"
  });

  const compareNumbersOrText = (leftValue, rightValue) => {
    const leftNumber = Number(String(leftValue || "").replace(",", "."));
    const rightNumber = Number(String(rightValue || "").replace(",", "."));
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
      return leftNumber - rightNumber;
    }

    return compareText(leftValue, rightValue);
  };

  const getCurrentIssueKey = () => {
    const pathMatch = window.location.pathname.match(/\/(?:browse|issues?)\/([A-Z][A-Z0-9]+-\d+)/i);
    if (pathMatch) {
      return pathMatch[1].toUpperCase();
    }

    const queryKey = new URLSearchParams(window.location.search).get("selectedIssue");
    if (queryKey) {
      return normalizeIssueKey(queryKey);
    }

    const visibleKey = document.querySelector('[data-testid*="issue.views.issue-base.foundation.breadcrumbs.current-issue.item"]');
    const textMatch = normalizeIssueKey(visibleKey?.textContent);
    if (textMatch) {
      return textMatch;
    }

    return normalizeIssueKey(document.title);
  };

  const getSelectedIssueKey = () => normalizeIssueKey(new URLSearchParams(window.location.search).get("selectedIssue"));

  const getJiraBaseUrl = () => `${window.location.origin}`;

  const fetchIssue = async (issueKey, signal) => {
    if (issueCache.has(issueKey)) {
      return issueCache.get(issueKey);
    }

    const fields = encodeURIComponent("issuetype,*all");
    const expand = encodeURIComponent("names,schema");
    const apiVersions = ["3", "2"];

    let lastError = null;
    for (const version of apiVersions) {
      const response = await fetch(`${getJiraBaseUrl()}/rest/api/${version}/issue/${issueKey}?fields=${fields}&expand=${expand}`, {
        credentials: "include",
        signal
      });

      if (response.ok) {
        const issue = await response.json();
        issueCache.set(issueKey, issue);
        return issue;
      }

      lastError = new Error(`Jira API ${version} returned ${response.status}`);
      if (![404, 410].includes(response.status)) {
        break;
      }
    }

    throw lastError;
  };

  const getFieldByDisplayNames = (issue, displayNames) => {
    const names = issue.names || {};
    const fields = issue.fields || {};
    const normalizedNames = new Set(displayNames.map((name) => name.toLowerCase()));
    const fieldId = Object.keys(names).find((key) => normalizedNames.has(String(names[key]).trim().toLowerCase()));

    if (!fieldId) {
      return null;
    }

    return {
      id: fieldId,
      name: names[fieldId],
      value: fields[fieldId]
    };
  };

  const stringifyFieldValue = (value) => {
    if (value === null || value === undefined || value === "") {
      return "—";
    }

    if (Array.isArray(value)) {
      const values = value.map(stringifyFieldValue).filter((item) => item && item !== "—");
      return values.length > 0 ? values.join(", ") : "—";
    }

    if (typeof value === "object") {
      if (typeof value.value === "string") return value.value;
      if (typeof value.name === "string") return value.name;
      if (typeof value.displayName === "string") return value.displayName;
      if (typeof value.key === "string") return value.key;
      if (typeof value.id === "string") return value.id;
      return JSON.stringify(value);
    }

    return String(value);
  };

  const getIssueKeysFromText = (text) => Array.from(new Set(String(text || "").match(ISSUE_KEY_PATTERN) || []));

  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const hasIssuesInEpicTitle = (element) => {
    const text = element.textContent?.replace(/\s+/g, " ").trim().toLowerCase();
    return text === "issues in epic" || text?.startsWith("issues in epic ");
  };

  const findIssuesInEpicHeading = (container) => Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],strong,span,div'))
    .filter((element) => isVisible(element) && hasIssuesInEpicTitle(element))
    .at(0);

  const isAfterIssuesInEpicHeading = (link, container) => {
    const heading = findIssuesInEpicHeading(container);
    if (!heading) {
      return true;
    }

    return Boolean(heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING);
  };

  const findContainerFromHeading = (heading, currentIssueKey) => {
    let candidate = heading;

    for (let depth = 0; candidate && depth < 8; depth += 1) {
      const issueKeys = getIssueKeysFromText(candidate.textContent).filter((key) => key !== currentIssueKey);
      if (issueKeys.length > 0) {
        return candidate;
      }

      const sibling = candidate.nextElementSibling;
      if (sibling) {
        const siblingIssueKeys = getIssueKeysFromText(sibling.textContent).filter((key) => key !== currentIssueKey);
        if (siblingIssueKeys.length > 0) {
          return sibling;
        }
      }

      candidate = candidate.parentElement;
    }

    return null;
  };

  const findIssuesInEpicContainers = (currentIssueKey) => {
    const selectorMatches = Array.from(document.querySelectorAll([
      '[data-testid*="issues-in-epic" i]',
      '[id*="issues-in-epic" i]',
      '[aria-label*="Issues in epic" i]',
      '[data-testid*="child-issues" i]'
    ].join(","))).filter(isVisible);

    const headingMatches = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],strong,span,div'))
      .filter((element) => isVisible(element) && hasIssuesInEpicTitle(element))
      .map((heading) => findContainerFromHeading(heading, currentIssueKey))
      .filter(Boolean);

    return Array.from(new Set([...selectorMatches, ...headingMatches]));
  };

  const findRowForIssueLink = (link, container, issueKey) => {
    const rowSelectors = [
      '[role="row"]',
      'tr',
      'li',
      '[data-testid*="issue-row" i]',
      '[data-testid*="issue-card" i]',
      '[data-testid*="child-issue" i]',
      '[data-testid*="issue-list.ui.list-view.card" i]'
    ];

    const selectorRow = link.closest(rowSelectors.join(","));
    if (selectorRow && container.contains(selectorRow)) {
      return selectorRow;
    }

    let candidate = link.parentElement;
    let best = candidate;
    for (let depth = 0; candidate && candidate !== container && depth < 6; depth += 1) {
      const keys = getIssueKeysFromText(candidate.textContent);
      if (keys.includes(issueKey) && keys.length === 1 && candidate.textContent.length < 1200) {
        best = candidate;
      }
      candidate = candidate.parentElement;
    }

    return best || link.parentElement;
  };

  const getIssueRows = (container, currentIssueKey) => {
    const rows = new Map();
    const links = Array.from(container.querySelectorAll('a[href*="/browse/"],a[href*="/issues/"],a[href*="selectedIssue="]'));

    for (const link of links) {
      const issueKey = normalizeIssueKey(link.textContent) || normalizeIssueKey(link.href);
      if (!issueKey || issueKey === currentIssueKey || rows.has(issueKey) || !isAfterIssuesInEpicHeading(link, container)) {
        continue;
      }

      const row = findRowForIssueLink(link, container, issueKey);
      if (row) {
        rows.set(issueKey, { row, link });
      }
    }

    return rows;
  };

  const isBeforeOrSame = (candidate, reference) => candidate === reference || Boolean(candidate.compareDocumentPosition(reference) & Node.DOCUMENT_POSITION_FOLLOWING);

  const findIssueTypeIcon = (row, issueKeyLink) => {
    const selectors = [
      '[data-testid*="issue-field-issuetype" i]',
      '[data-testid*="issuetype" i]',
      'img[src*="issuetype" i]',
      'img[alt]',
      'svg[role="img"]',
      '[role="img"]'
    ];

    const candidates = Array.from(row.querySelectorAll(selectors.join(",")))
      .filter((element) => !element.closest(INJECTED_FIELD_SELECTOR))
      .filter((element) => isBeforeOrSame(element, issueKeyLink));

    return candidates.at(-1) || issueKeyLink;
  };

  const getDirectChildOfRow = (row, element) => {
    let candidate = element;
    while (candidate?.parentElement && candidate.parentElement !== row) {
      candidate = candidate.parentElement;
    }

    return candidate?.parentElement === row ? candidate : null;
  };

  const findIssueTypeColumn = (row, issueKeyLink) => {
    const issueTypeIcon = findIssueTypeIcon(row, issueKeyLink);
    const cell = issueTypeIcon.closest(CELL_SELECTOR);
    if (cell && cell !== row && row.contains(cell)) {
      return cell;
    }

    return getDirectChildOfRow(row, issueTypeIcon) || issueTypeIcon;
  };

  const getCellSiblings = (cell) => Array.from(cell?.parentElement?.children || [])
    .filter((element) => isCellLike(element) && !element.closest(INJECTED_FIELD_SELECTOR));

  const findColumnByPosition = (row, issueKeyLink, position) => {
    const issueKeyCell = issueKeyLink.closest(CELL_SELECTOR);
    const issueKeyCellSiblings = getCellSiblings(issueKeyCell);
    if (issueKeyCellSiblings.length >= position - 1) {
      return issueKeyCellSiblings[position - 2];
    }

    const directCells = Array.from(row.children)
      .filter((element) => isCellLike(element) && !element.closest(INJECTED_FIELD_SELECTOR));
    if (directCells.length >= position - 1) {
      return directCells[position - 2];
    }

    const descendantCells = Array.from(row.querySelectorAll(CELL_SELECTOR))
      .filter((element) => !element.closest(INJECTED_FIELD_SELECTOR));
    if (descendantCells.length >= position - 1) {
      return descendantCells[position - 2];
    }

    return findIssueTypeColumn(row, issueKeyLink);
  };

  const getFieldInsertionAnchor = (row, link, fieldDefinition) => {
    if (fieldDefinition.insertAfter === "column") {
      return findColumnByPosition(row, link, fieldDefinition.columnPosition || 1);
    }

    if (fieldDefinition.insertAfter === "issueType") {
      return fieldDefinition.insertMode === "column" ? findIssueTypeColumn(row, link) : findIssueTypeIcon(row, link);
    }

    return link;
  };

  const isTableCell = (element) => Boolean(element?.matches?.("td,th"));

  const isCellLike = (element) => Boolean(element?.matches?.(CELL_SELECTOR));

  const copyCellAttributes = (source, target) => {
    const sourceClassName = source.getAttribute("class");
    target.className = [sourceClassName, FIELD_CLASS, FIELD_COLUMN_CLASS, FIELD_LOADING_CLASS].filter(Boolean).join(" ");

    if (source.hasAttribute("role") && !isTableCell(target)) {
      target.setAttribute("role", source.getAttribute("role"));
    }
  };

  const createFieldElement = (insertAfterElement, fieldDefinition) => {
    if (fieldDefinition.insertMode === "column" && isTableCell(insertAfterElement)) {
      const column = document.createElement("td");
      copyCellAttributes(insertAfterElement, column);
      return column;
    }

    if (fieldDefinition.insertMode === "column" && isCellLike(insertAfterElement)) {
      const column = document.createElement(insertAfterElement.tagName.toLowerCase());
      copyCellAttributes(insertAfterElement, column);
      return column;
    }

    const field = document.createElement("span");
    field.className = fieldDefinition.insertMode === "column"
      ? `${FIELD_CLASS} ${FIELD_COLUMN_CLASS} ${FIELD_LOADING_CLASS}`
      : `${FIELD_CLASS} ${FIELD_LOADING_CLASS}`;
    return field;
  };

  const shouldRecreateField = (field, insertAfterElement, fieldDefinition) => (
    fieldDefinition.insertMode === "column" && isCellLike(insertAfterElement) && !field.matches(insertAfterElement.tagName.toLowerCase())
  );

  const assignOriginalOrder = (rows) => {
    let nextIndex = 0;
    for (const { row } of rows.values()) {
      if (!row.dataset[ORIGINAL_INDEX_DATA_KEY]) {
        row.dataset[ORIGINAL_INDEX_DATA_KEY] = String(nextIndex);
      }
      nextIndex += 1;
    }
  };

  const compareRowsInDocument = (leftRow, rightRow) => {
    if (leftRow === rightRow) {
      return 0;
    }

    return leftRow.compareDocumentPosition(rightRow) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  };

  const sortIssueEntries = (entries, sortMode) => [...entries].sort((left, right) => {
    if (sortMode === "issueKey") {
      return compareIssueKeys(left.issueKey, right.issueKey);
    }

    if (sortMode === "platform") {
      const platformCompare = compareText(left.fieldValues?.platform, right.fieldValues?.platform);
      return platformCompare || compareIssueKeys(left.issueKey, right.issueKey);
    }

    if (sortMode === "storyPoints") {
      const storyPointsCompare = compareNumbersOrText(left.fieldValues?.storyPoints, right.fieldValues?.storyPoints);
      return storyPointsCompare || compareIssueKeys(left.issueKey, right.issueKey);
    }

    return Number(left.row.dataset[ORIGINAL_INDEX_DATA_KEY] || 0) - Number(right.row.dataset[ORIGINAL_INDEX_DATA_KEY] || 0);
  });

  const applySort = (rows, sortMode) => {
    const entries = Array.from(rows, ([issueKey, issueRow]) => ({ issueKey, ...issueRow }));
    const entriesByParent = new Map();

    for (const entry of entries) {
      const parent = entry.row.parentElement;
      if (!parent) {
        continue;
      }

      if (!entriesByParent.has(parent)) {
        entriesByParent.set(parent, []);
      }
      entriesByParent.get(parent).push(entry);
    }

    for (const [parent, group] of entriesByParent) {
      const currentFirstRow = [...group].sort((left, right) => compareRowsInDocument(left.row, right.row))[0]?.row;
      if (!currentFirstRow) {
        continue;
      }

      const placeholder = document.createTextNode("");
      parent.insertBefore(placeholder, currentFirstRow);
      for (const entry of sortIssueEntries(group, sortMode)) {
        parent.insertBefore(entry.row, placeholder);
      }
      placeholder.remove();
    }
  };

  const getIssueUrl = (issueKey, link) => {
    try {
      const url = new URL(link.href, window.location.href);
      if (url.pathname.match(new RegExp(`/(browse|issues?)/${issueKey}$`, "i"))) {
        url.search = "";
        url.hash = "";
        return url.toString();
      }
    } catch (_) {}

    return new URL(`/browse/${issueKey}`, window.location.origin).toString();
  };

  const copyText = async (text) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };

  const showCopyResult = (button, text) => {
    const previousText = button.textContent;
    button.textContent = text;
    window.setTimeout(() => {
      if (button.isConnected) {
        button.textContent = previousText;
      }
    }, 1200);
  };

  const isInRightPreviewArea = (element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    return rect.width > 0 && rect.height > 0 && centerX > window.innerWidth * 0.55;
  };

  const compareElementsTopRight = (left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return (leftRect.top - rightRect.top) || (rightRect.left - leftRect.left);
  };

  const getPreviewIssueKeyCandidates = () => {
    const selectors = [
      '[data-testid*="issue.views.issue-base.foundation.breadcrumbs.current-issue.item" i]',
      '[data-testid*="current-issue" i]',
      '[data-testid*="issue-key" i]',
      'a[href*="/browse/"]',
      'a[href*="/issues/"]',
      'a[href*="selectedIssue="]',
      'button',
      'span'
    ];

    return Array.from(document.querySelectorAll(selectors.join(",")))
      .filter((element) => !element.closest(INJECTED_FIELD_SELECTOR))
      .filter((element) => element.getClientRects().length > 0)
      .filter(isInRightPreviewArea)
      .map((element) => ({
        element,
        issueKey: normalizeIssueKey(element.textContent) || normalizeIssueKey(element.getAttribute("href"))
      }))
      .filter(({ issueKey }) => Boolean(issueKey))
      .sort((left, right) => compareElementsTopRight(left.element, right.element));
  };

  const getPreviewIssueKey = () => {
    const selectedIssueKey = getSelectedIssueKey();
    if (selectedIssueKey && getPreviewIssueKeyCandidates().some((candidate) => candidate.issueKey === selectedIssueKey)) {
      return selectedIssueKey;
    }

    return getPreviewIssueKeyCandidates()[0]?.issueKey || null;
  };

  const findIssuePreviewContainers = (issueKey) => {
    const previewSelectors = [
      '[data-testid*="issue.views.issue-details" i]',
      '[data-testid*="issue-details" i]',
      '[data-testid*="issue.layout" i]',
      '[data-testid*="issue-layout" i]',
      '[data-testid*="selected-issue" i]',
      '[role="dialog"]',
      'aside'
    ];

    return Array.from(document.querySelectorAll(previewSelectors.join(",")))
      .filter((element) => element.getClientRects().length > 0)
      .filter(isInRightPreviewArea)
      .filter((element) => normalizeIssueKey(element.textContent) === issueKey || getIssueKeysFromText(element.textContent).includes(issueKey))
      .sort((left, right) => right.getBoundingClientRect().left - left.getBoundingClientRect().left);
  };

  const findPreviewIssueKeyElement = (issueKey) => {
    const preferredSelectors = [
      '[data-testid*="issue.views.issue-base.foundation.breadcrumbs.current-issue.item" i]',
      '[data-testid*="current-issue" i]',
      '[data-testid*="issue-key" i]',
      'a[href*="/browse/"]',
      'a[href*="/issues/"]',
      'a[href*="selectedIssue="]',
      'button',
      'span'
    ];

    const containers = findIssuePreviewContainers(issueKey);
    const roots = containers.length > 0 ? containers : [document];
    const candidates = roots.flatMap((root) => Array.from(root.querySelectorAll(preferredSelectors.join(","))))
      .filter((element) => !element.closest(INJECTED_FIELD_SELECTOR))
      .filter((element) => normalizeIssueKey(element.textContent) === issueKey || normalizeIssueKey(element.getAttribute("href")) === issueKey)
      .filter((element) => element.getClientRects().length > 0)
      .filter(isInRightPreviewArea)
      .sort(compareElementsTopRight);

    return candidates[0] || null;
  };

  const getOrCreateCopyButton = (anchor, issueKey) => {
    const existing = document.querySelector(`[data-jira-epic-platform-for="${issueKey}"][data-jira-epic-platform-field="copyIssueLink"]`);
    if (existing) {
      anchor.insertAdjacentElement("afterend", existing);
      return existing;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = COPY_LINK_BUTTON_CLASS;
    button.dataset.jiraEpicPlatformFor = issueKey;
    button.dataset.jiraEpicPlatformField = "copyIssueLink";
    button.setAttribute("aria-label", `Скопировать ссылку на ${issueKey}`);
    button.title = "Скопировать ссылку";
    button.textContent = "⧉";
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();

      try {
        await copyText(getIssueUrl(issueKey));
        showCopyResult(button, "✓");
      } catch (error) {
        showCopyResult(button, "!");
        console.warn(`Jira Toolkit extension failed to copy link for ${issueKey}`, error);
      }
    });

    anchor.insertAdjacentElement("afterend", button);
    return button;
  };

  const ensurePreviewCopyButton = (issueKey, visibleFields) => {
    document.querySelectorAll(`.${COPY_LINK_BUTTON_CLASS}`).forEach((button) => {
      if (button.dataset.jiraEpicPlatformFor !== issueKey) {
        button.remove();
      }
    });

    const existing = document.querySelector(`[data-jira-epic-platform-for="${issueKey}"][data-jira-epic-platform-field="copyIssueLink"]`);
    if (visibleFields.copyIssueLink) {
      const anchor = findPreviewIssueKeyElement(issueKey);
      if (anchor) {
        getOrCreateCopyButton(anchor, issueKey);
      } else {
        existing?.remove();
      }
    } else {
      existing?.remove();
    }
  };

  const getOrCreateField = (row, insertAfterElement, issueKey, fieldDefinition) => {
    const existing = row.querySelector(`[data-jira-epic-platform-for="${issueKey}"][data-jira-epic-platform-field="${fieldDefinition.key}"]`);
    if (existing) {
      if (shouldRecreateField(existing, insertAfterElement, fieldDefinition)) {
        existing.remove();
      } else {
        insertAfterElement.insertAdjacentElement("afterend", existing);
        return existing;
      }
    }

    const field = createFieldElement(insertAfterElement, fieldDefinition);
    field.dataset.jiraEpicPlatformFor = issueKey;
    field.dataset.jiraEpicPlatformField = fieldDefinition.key;
    field.setAttribute("aria-label", fieldDefinition.label);
    field.title = fieldDefinition.label;
    field.textContent = "…";

    insertAfterElement.insertAdjacentElement("afterend", field);
    return field;
  };

  const setFieldValue = (field, value, isError = false) => {
    field.classList.remove(FIELD_LOADING_CLASS, "jira-epic-platform-field-error");
    if (isError) {
      field.classList.add("jira-epic-platform-field-error");
    }
    field.textContent = value;
  };

  const removeFields = () => {
    document.querySelectorAll(INJECTED_FIELD_SELECTOR).forEach((field) => field.remove());
  };

  const removeEpicFields = () => {
    document.querySelectorAll(`.${FIELD_CLASS}`).forEach((field) => field.remove());
  };

  const removeHiddenFields = (visibleFields) => {
    document.querySelectorAll(INJECTED_FIELD_SELECTOR).forEach((field) => {
      if (visibleFields[field.dataset.jiraEpicPlatformField] !== true) {
        field.remove();
      }
    });
  };

  const removeFieldsExcept = (validIssueKeys, visibleFields) => {
    const validKeys = new Set(validIssueKeys);
    document.querySelectorAll(`.${FIELD_CLASS}`).forEach((field) => {
      if (!validKeys.has(field.dataset.jiraEpicPlatformFor) || visibleFields[field.dataset.jiraEpicPlatformField] !== true) {
        field.remove();
      }
    });
  };

  const enhanceIssueRows = async (containers, currentIssueKey, signal, sortMode, visibleFields) => {
    const rows = new Map();
    for (const container of containers) {
      for (const [issueKey, issueRow] of getIssueRows(container, currentIssueKey)) {
        rows.set(issueKey, issueRow);
      }
    }

    if (rows.size === 0) {
      return;
    }

    assignOriginalOrder(rows);

    const sortFieldKey = SORT_FIELD_BY_MODE[sortMode];
    const neededFieldDefinitions = FIELD_DEFINITIONS.filter((field) => visibleFields[field.key] || field.key === sortFieldKey);

    for (const [issueKey, issueRow] of rows) {
      const { row, link } = issueRow;
      const insertAfterByTarget = new Map();
      issueRow.fieldValues = {};

      try {
        const issue = await fetchIssue(issueKey, signal);
        for (const fieldDefinition of neededFieldDefinitions) {
          const issueField = getFieldByDisplayNames(issue, fieldDefinition.names);
          const fieldValue = stringifyFieldValue(issueField?.value);
          issueRow.fieldValues[fieldDefinition.key] = fieldValue;
          if (visibleFields[fieldDefinition.key]) {
            const insertionAnchor = getFieldInsertionAnchor(row, link, fieldDefinition);
            const insertAfterElement = insertAfterByTarget.get(fieldDefinition.insertAfter) || insertionAnchor;
            const field = getOrCreateField(row, insertAfterElement, issueKey, fieldDefinition);
            setFieldValue(field, fieldValue);
            insertAfterByTarget.set(fieldDefinition.insertAfter, field);
          }
        }
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        for (const fieldDefinition of neededFieldDefinitions) {
          issueRow.fieldValues[fieldDefinition.key] = "";
          if (visibleFields[fieldDefinition.key]) {
            const insertionAnchor = getFieldInsertionAnchor(row, link, fieldDefinition);
            const insertAfterElement = insertAfterByTarget.get(fieldDefinition.insertAfter) || insertionAnchor;
            const field = getOrCreateField(row, insertAfterElement, issueKey, fieldDefinition);
            setFieldValue(field, "not loaded", true);
            insertAfterByTarget.set(fieldDefinition.insertAfter, field);
          }
        }
        console.warn(`Jira Toolkit extension failed to load fields for ${issueKey}`, error);
      }
    }

    applySort(rows, sortMode);
  };

  async function refresh() {
    if (!isPotentialJiraPage()) {
      removeFields();
      return;
    }

    const previewIssueKey = getPreviewIssueKey();
    if (previewIssueKey) {
      ensurePreviewCopyButton(previewIssueKey, currentVisibleFields);
    } else {
      document.querySelectorAll(`.${COPY_LINK_BUTTON_CLASS}`).forEach((button) => button.remove());
    }

    const currentIssueKey = getCurrentIssueKey();
    if (!currentIssueKey) {
      removeEpicFields();
      lastRefreshSignature = null;
      return;
    }

    const containers = findIssuesInEpicContainers(currentIssueKey);
    if (containers.length === 0) {
      removeEpicFields();
      lastRefreshSignature = `${currentIssueKey}:no-issues-in-epic`;
      return;
    }

    const currentKeys = containers
      .flatMap((container) => Array.from(getIssueRows(container, currentIssueKey).keys()))
      .sort();
    removeFieldsExcept(currentKeys, currentVisibleFields);

    const visibleFieldKeys = DISPLAY_OPTION_DEFINITIONS.filter((field) => currentVisibleFields[field.key]).map((field) => field.key);
    const visibleEpicFieldKeys = FIELD_DEFINITIONS.filter((field) => currentVisibleFields[field.key]).map((field) => field.key);
    const signature = `${currentIssueKey}:${currentSortMode}:${visibleFieldKeys.join("|")}:${currentKeys.join(",")}`;
    if (signature === lastRefreshSignature && currentKeys.every((key) => visibleEpicFieldKeys.every((fieldKey) => document.querySelector(`[data-jira-epic-platform-for="${key}"][data-jira-epic-platform-field="${fieldKey}"]`)))) {
      return;
    }

    lastRefreshSignature = signature;
    routeAbortController?.abort();
    routeAbortController = new AbortController();

    try {
      const currentIssue = await fetchIssue(currentIssueKey, routeAbortController.signal);
      const issueType = currentIssue.fields?.issuetype?.name;
      if (String(issueType).toLowerCase() !== "epic") {
        removeEpicFields();
        return;
      }

      await enhanceIssueRows(containers, currentIssueKey, routeAbortController.signal, currentSortMode, currentVisibleFields);
    } catch (error) {
      if (error.name !== "AbortError") {
        console.warn("Jira Toolkit extension failed to enhance Issues in epic", error);
      }
    }
  }

  const patchHistory = () => {
    for (const method of ["pushState", "replaceState"]) {
      const original = history[method];
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args);
        scheduleRefresh();
        return result;
      };
    }

    window.addEventListener("popstate", scheduleRefresh);
  };

  watchSettings();
  watchMessages();
  pollSettings();
  patchHistory();
  new MutationObserver((mutations) => {
    const onlyOwnBadges = mutations.every((mutation) => {
      const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
      const addedNodes = Array.from(mutation.addedNodes).filter((node) => node.nodeType === Node.ELEMENT_NODE);
      const removedNodes = Array.from(mutation.removedNodes).filter((node) => node.nodeType === Node.ELEMENT_NODE);
      const touchedOwnField = target?.closest?.(INJECTED_FIELD_SELECTOR) || [...addedNodes, ...removedNodes].every((node) => node.matches?.(INJECTED_FIELD_SELECTOR));
      return touchedOwnField;
    });

    if (!onlyOwnBadges) {
      scheduleRefresh();
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true
  });
  loadSettings().then((settings) => {
    currentSettingsSignature = getSettingsSignature(settings.sortMode, settings.visibleFields);
    currentSortMode = settings.sortMode;
    currentVisibleFields = settings.visibleFields;
    scheduleRefresh();
  });
})();
