import Cocoa
import SafariServices

let extensionBundleIdentifier = "com.example.jira-epic-platform.Extension"

class ViewController: NSViewController {
    private let iconImageView = NSImageView()
    private let stateLabel = NSTextField(labelWithString: "Checking Safari extension state…")
    private let preferencesButton = NSButton(title: "Open Safari Settings…", target: nil, action: nil)

    override func loadView() {
        view = NSView(frame: NSRect(x: 0, y: 0, width: 425, height: 325))
        view.wantsLayer = true
        view.layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureSubviews()
        refreshExtensionState()
    }

    private func configureSubviews() {
        iconImageView.image = NSImage(named: "Icon")
        iconImageView.imageScaling = .scaleProportionallyUpOrDown
        iconImageView.translatesAutoresizingMaskIntoConstraints = false

        stateLabel.alignment = .center
        stateLabel.maximumNumberOfLines = 0
        stateLabel.font = .systemFont(ofSize: 14)
        stateLabel.translatesAutoresizingMaskIntoConstraints = false

        preferencesButton.target = self
        preferencesButton.action = #selector(openSafariExtensionSettings)
        preferencesButton.translatesAutoresizingMaskIntoConstraints = false

        view.addSubview(iconImageView)
        view.addSubview(stateLabel)
        view.addSubview(preferencesButton)

        NSLayoutConstraint.activate([
            iconImageView.topAnchor.constraint(equalTo: view.topAnchor, constant: 34),
            iconImageView.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            iconImageView.widthAnchor.constraint(equalToConstant: 128),
            iconImageView.heightAnchor.constraint(equalToConstant: 128),

            stateLabel.topAnchor.constraint(equalTo: iconImageView.bottomAnchor, constant: 24),
            stateLabel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 34),
            stateLabel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -34),

            preferencesButton.topAnchor.constraint(equalTo: stateLabel.bottomAnchor, constant: 24),
            preferencesButton.centerXAnchor.constraint(equalTo: view.centerXAnchor)
        ])
    }

    private func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { [weak self] state, error in
            DispatchQueue.main.async {
                guard let self else { return }

                if error != nil || state == nil {
                    self.stateLabel.stringValue = "Could not read Safari extension state."
                    return
                }

                if state?.isEnabled == true {
                    self.stateLabel.stringValue = "Jira Epic Platform’s extension is currently on. You can turn it off in Safari Settings."
                } else {
                    self.stateLabel.stringValue = "Jira Epic Platform’s extension is currently off. You can turn it on in Safari Settings."
                }
            }
        }
    }

    @objc private func openSafariExtensionSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) { _ in
            DispatchQueue.main.async {
                NSApplication.shared.terminate(nil)
            }
        }
    }
}
