import AppKit

@MainActor
final class Launcher: NSObject, NSApplicationDelegate {
    private let origin = URL(string: "http://127.0.0.1:8960")!
    private let chrome = URL(fileURLWithPath: "/Applications/Google Chrome.app")
    private let files = FileManager.default

    func applicationDidFinishLaunching(_ notification: Notification) {
        Task {
            do {
                try await launch()
            } catch {
                NSApp.activate(ignoringOtherApps: true)
                let alert = NSAlert()
                alert.messageText = "Nest Studio could not open"
                alert.informativeText = error.localizedDescription
                alert.runModal()
            }
            NSApp.terminate(nil)
        }
    }

    private func launch() async throws {
        let support = try files.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                    appropriateFor: nil, create: true).appendingPathComponent("Nest Studio")
        try files.createDirectory(at: support, withIntermediateDirectories: true)
        let executable = chrome.appendingPathComponent("Contents/MacOS/Google Chrome")
        guard files.isExecutableFile(atPath: executable.path) else {
            throw failure("Install Google Chrome in /Applications and open Nest Studio again.")
        }
        guard let repoFile = Bundle.main.url(forResource: "workspace", withExtension: "txt") else {
            throw failure("Rebuild Nest Studio with desktop/build-macos-launcher.sh.")
        }
        let workspace = URL(fileURLWithPath: try String(contentsOf: repoFile, encoding: .utf8)
            .trimmingCharacters(in: .newlines), isDirectory: true)
        try await ensureServer(workspace: workspace, support: support)

        let profile = support.appendingPathComponent("Chrome Profile").standardizedFileURL
        if let shim = installedApp(profile: profile) {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            try await NSWorkspace.shared.openApplication(at: shim, configuration: configuration)
            return
        }

        // Installation must go through Chrome so it registers a real macOS app
        // shim. Keep the existing profile (and all its project storage) intact.
        let launch = Process()
        launch.executableURL = executable
        launch.arguments = [
            "--user-data-dir=\(profile.path)",
            "--profile-directory=Default",
            "--no-first-run",
            "--no-default-browser-check",
            "--new-window", "\(origin.absoluteString)/editor.html"
        ]
        launch.standardInput = FileHandle.nullDevice
        launch.standardOutput = FileHandle.nullDevice
        launch.standardError = FileHandle.nullDevice
        try launch.run()
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Install Nest Studio in Chrome"
        alert.informativeText = "In the Chrome window just opened, choose the three-dot menu → Cast, save, and share → Install page as app… and install Nest Studio. Then open this launcher again. This one-time setup gives Nest its own Dock and Command-Tab icon while keeping your existing projects."
        alert.addButton(withTitle: "Continue in Chrome")
        alert.runModal()
        // Chrome can reuse the process already holding this profile. Its lock
        // identifies that process, so setup brings forward the correct browser.
        if let lock = try? files.destinationOfSymbolicLink(atPath: profile.appendingPathComponent("SingletonLock").path),
           let pid = lock.split(separator: "-").last.flatMap({ Int32($0) }),
           let browser = NSRunningApplication(processIdentifier: pid),
           browser.bundleURL?.standardizedFileURL == chrome.standardizedFileURL {
            browser.activate(options: [.activateAllWindows, .activateIgnoringOtherApps])
        }
    }

    private func installedApp(profile: URL) -> URL? {
        // Chrome may localize or suffix the Applications subdirectory and app
        // name. Match its metadata, never another profile's app with this title.
        let applications = files.homeDirectoryForCurrentUser.appendingPathComponent("Applications")
        guard let entries = files.enumerator(at: applications,
            includingPropertiesForKeys: nil, options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return nil }
        for case let url as URL in entries where url.pathExtension == "app" {
            guard let info = NSDictionary(contentsOf: url.appendingPathComponent("Contents/Info.plist")),
                  let appURL = info["CrAppModeShortcutURL"] as? String,
                  let installedURL = URLComponents(string: appURL),
                  installedURL.scheme == origin.scheme,
                  installedURL.host == origin.host,
                  installedURL.port == origin.port,
                  installedURL.path == "/editor.html",
                  let dataPath = info["CrAppModeUserDataDir"] as? String else { continue }
            // Chrome records an app-specific path underneath the user data
            // directory (including Web Applications/_crx_<app-id>).
            let dataURL = URL(fileURLWithPath: dataPath).standardizedFileURL
            if dataURL == profile || dataURL.path.hasPrefix(profile.path + "/") {
                return url
            }
        }
        return nil
    }

    private func ensureServer(workspace: URL, support: URL) async throws {
        if await serverReady() { return }
        let serverScript = workspace.appendingPathComponent("serve.py")
        guard files.isReadableFile(atPath: serverScript.path) else {
            throw failure("Nest was moved from \(workspace.path). Rebuild the launcher from the new folder.")
        }
        let log = support.appendingPathComponent("server.log")
        if !files.fileExists(atPath: log.path) {
            _ = files.createFile(atPath: log.path, contents: nil)
        }
        let output = try FileHandle(forWritingTo: log)
        defer { try? output.close() }
        try output.seekToEnd()
        let server = Process()
        server.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        server.currentDirectoryURL = workspace
        server.arguments = ["-u", serverScript.path, "--host", "127.0.0.1", "--port", "8960"]
        server.standardInput = FileHandle.nullDevice
        server.standardOutput = output
        server.standardError = output
        try server.run()
        for _ in 0..<40 {
            if await serverReady() { return }
            if !server.isRunning { break }
            try await Task.sleep(for: .milliseconds(125))
        }
        throw failure("Nest did not respond on port 8960. See \(log.path).")
    }

    private func serverReady() async -> Bool {
        var request = URLRequest(url: origin.appendingPathComponent("api/projects"))
        request.timeoutInterval = 1
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200,
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return payload["available"] as? Bool == true && payload["files"] is [[String: Any]]
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "NestStudioLauncher", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}

@main
struct NestStudio {
    @MainActor
    static func main() {
        let app = NSApplication.shared
        let launcher = Launcher()
        app.delegate = launcher
        withExtendedLifetime(launcher) { app.run() }
    }
}
