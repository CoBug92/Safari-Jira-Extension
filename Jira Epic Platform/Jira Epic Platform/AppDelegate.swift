import Cocoa

@main
class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApplication.shared.mainMenu = makeMainMenu()
        showMainWindow()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func showMainWindow() {
        let viewController = ViewController()
        let window = NSWindow(contentViewController: viewController)
        window.title = "Jira Toolkit"
        window.styleMask = [.titled, .closable]
        window.isRestorable = false
        window.setContentSize(NSSize(width: 425, height: 325))
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.window = window
    }

    private func makeMainMenu() -> NSMenu {
        let mainMenu = NSMenu(title: "Main Menu")

        let appMenuItem = NSMenuItem()
        mainMenu.addItem(appMenuItem)
        appMenuItem.submenu = makeApplicationMenu()

        let helpMenuItem = NSMenuItem()
        mainMenu.addItem(helpMenuItem)
        helpMenuItem.submenu = makeHelpMenu()

        return mainMenu
    }

    private func makeApplicationMenu() -> NSMenu {
        let menu = NSMenu(title: "Jira Toolkit")
        menu.addItem(NSMenuItem(title: "About Jira Toolkit", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Hide Jira Toolkit", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h"))

        let hideOthersItem = NSMenuItem(title: "Hide Others", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthersItem.keyEquivalentModifierMask = [.command, .option]
        menu.addItem(hideOthersItem)

        menu.addItem(NSMenuItem(title: "Show All", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: ""))
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "Quit Jira Toolkit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        return menu
    }

    private func makeHelpMenu() -> NSMenu {
        let menu = NSMenu(title: "Help")
        let helpItem = NSMenuItem(title: "Jira Toolkit Help", action: #selector(NSApplication.showHelp(_:)), keyEquivalent: "?")
        menu.addItem(helpItem)
        return menu
    }
}
