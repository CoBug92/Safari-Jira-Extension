# App Review Notes

## English

Safari Jira Extension is a Safari Web Extension for Jira pages.

How to test:
1. Install the macOS app.
2. Open Safari Settings → Extensions.
3. Enable Safari Jira Extension.
4. Open a Jira Cloud or self-hosted Jira page.
5. Open an Epic issue with an “Issues in epic” section to see Platform and Story Points fields.
6. Open a Jira board/backlog issue preview to see the copy-link button next to the issue key in the right preview panel.
7. Click the extension toolbar icon to toggle Platform, Story Points, and copy-link visibility, and to change sorting.

The extension does not collect user data. It only reads Jira page content and Jira issue data locally in Safari to modify the Jira UI. Jira data is not sent to the developer or to any third-party service.

If access to a Jira instance is required for review, provide a demo Jira account in App Store Connect Review Information.

## What to Test

Please verify that the Safari extension can be enabled and that the popup settings are available. On Jira pages, verify that the extension can add Platform and Story Points fields to Issues in epic, sort epic issues, and show a copy-link button next to the issue key in the right-side issue preview.
