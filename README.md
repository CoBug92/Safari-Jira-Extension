# Jira Epic Platform Safari Extension

Safari Web Extension для macOS, который показывает значение поля `Platform` у задач в блоке `Issues in epic` на странице Epic в Jira.

## Как работает расширение

Content script запускается на страницах Jira, определяет ключ текущей задачи и через Jira REST API проверяет, что текущая задача — это `Epic`. После этого расширение находит блок `Issues in epic`, определяет задачи внутри него, вставляет `Platform` сразу после номера каждой задачи, например `CMT-253 iOS`, а `Story Points` — после иконки типа задачи.

Через popup расширения можно выбрать сортировку блока `Issues in epic`:

- `По умолчанию` — порядок, который отрисовала Jira;
- `По номеру задачи` — сортировка по issue key, например `CMT-253`;
- `По Platform` — сортировка по значению поля `Platform`, затем по issue key.
- `По Story Points` — сортировка по значению поля `Story Points`, затем по issue key.

В этом же popup можно включать и выключать отображение полей `Platform` и `Story Points`.

Для загрузки данных используется текущая Safari-сессия пользователя:

- сначала `/rest/api/3/issue` для Jira Cloud;
- затем fallback на `/rest/api/2/issue` для Jira Server/Data Center.

Поле `Platform` определяется динамически по отображаемому имени, поэтому не нужно заранее знать `customfield_XXXXX`.

## Структура проекта

- `extension/manifest.json` — manifest Safari/WebExtension.
- `extension/content.js` — основная логика: поиск Epic, блока `Issues in epic`, задач и поля `Platform`.
- `extension/styles.css` — минимальные стили для вставленного значения `Platform`.
- `extension/popup.html` — popup, который открывается по клику на иконку расширения.
- `extension/popup.js` — сохранение выбранного режима сортировки.
- `extension/popup.css` — стили popup.
- `Jira Epic Platform/Jira Epic Platform.xcodeproj` — сгенерированный Xcode-проект macOS Safari Extension.

## Как запустить локально через Xcode

1. Открой проект:

   ```sh
   open "Jira Epic Platform/Jira Epic Platform.xcodeproj"
   ```

2. В Xcode выбери target `Jira Epic Platform`.
3. Открой `Signing & Capabilities` и выбери свой `Team`.
4. Проверь то же самое для target `Jira Epic Platform Extension`.
5. Запусти приложение через `Cmd + R`.
6. Открой Safari → `Settings...` → `Extensions`.
7. Включи `Jira Epic Platform Extension` и разреши доступ к Jira.
8. Открой Epic-задачу в Jira и проверь блок `Issues in epic`.

## Проверка сборки без подписи

Для локальной проверки компиляции без code signing можно выполнить:

```sh
xcodebuild -project "Jira Epic Platform/Jira Epic Platform.xcodeproj" -scheme "Jira Epic Platform" -configuration Debug -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO build
```

## Как пересоздать Xcode-проект из WebExtension

Если нужно заново сгенерировать Xcode-проект из папки `extension`, выполни из корня репозитория:

```sh
xcrun safari-web-extension-converter extension --project-location . --app-name "Jira Epic Platform" --bundle-identifier "com.example.jira-epic-platform" --swift --macos-only --copy-resources --no-open --no-prompt --force
```

После генерации проверь bundle identifier и signing в Xcode.

## Обновление расширения после правок

Если менялись файлы в папке `extension`, нужно синхронизировать их в Xcode resources:

```sh
cp extension/content.js "Jira Epic Platform/Jira Epic Platform Extension/Resources/content.js"
cp extension/styles.css "Jira Epic Platform/Jira Epic Platform Extension/Resources/styles.css"
cp extension/manifest.json "Jira Epic Platform/Jira Epic Platform Extension/Resources/manifest.json"
cp extension/popup.html "Jira Epic Platform/Jira Epic Platform Extension/Resources/popup.html"
cp extension/popup.css "Jira Epic Platform/Jira Epic Platform Extension/Resources/popup.css"
cp extension/popup.js "Jira Epic Platform/Jira Epic Platform Extension/Resources/popup.js"
```

Затем снова запусти приложение из Xcode и обнови страницу Jira в Safari.

## Важные замечания

- Пользователь должен быть залогинен в Jira в Safari.
- Поле в Jira должно называться ровно `Platform`.
- Расширение работает только на страницах Jira и выходит раньше на остальных сайтах.
- В manifest используется широкий доступ к страницам, чтобы поддерживать Jira Cloud и self-hosted Jira.
- Если поле называется иначе, измени константу `FIELD_NAME` в `extension/content.js`.
- Если Safari не подхватил изменения, выключи и снова включи extension в Safari → `Settings...` → `Extensions`.

## Распространение для команды

Для команды удобнее не просить всех запускать Xcode. Один разработчик или CI может собрать подписанное macOS-приложение с extension и раздать его как `.dmg`/`.pkg`, либо опубликовать через TestFlight/App Store Connect.

Практичные варианты:

- для внутреннего тестирования — TestFlight;
- для корпоративной установки — подписанный и notarized `.pkg`/`.dmg`;
- для управляемых Mac — установка через MDM и управление Safari extensions политиками.
