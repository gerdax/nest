import AppKit
import CoreGraphics

@MainActor
final class Launcher: NSObject, NSApplicationDelegate {
    private let origin = URL(string: "http://127.0.0.1:8960")!
    private let chrome = URL(fileURLWithPath: "/Applications/Google Chrome.app")
    private let files = FileManager.default
    private let defaults = UserDefaults.standard

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

        if let browser = runningBrowser(), hasWindow(browser.processIdentifier) {
            browser.unhide()
            browser.activate()
            return
        }

        let launch = Process()
        launch.executableURL = executable
        launch.arguments = [
            "--user-data-dir=\(support.appendingPathComponent("Chrome Profile").path)",
            "--no-first-run",
            "--no-default-browser-check",
            "--app=\(origin.absoluteString)/editor.html?project=first-descent.json"
        ]
        launch.standardInput = FileHandle.nullDevice
        launch.standardOutput = FileHandle.nullDevice
        launch.standardError = FileHandle.nullDevice
        let existing = runningBrowser()
        try launch.run()
        if existing == nil { defaults.set(Int(launch.processIdentifier), forKey: "ChromePID") }
        for _ in 0..<30 {
            if let browser = runningBrowser(), hasWindow(browser.processIdentifier) {
                browser.activate()
                return
            }
            try await Task.sleep(for: .milliseconds(100))
        }
    }

    private func runningBrowser() -> NSRunningApplication? {
        let pid = defaults.integer(forKey: "ChromePID")
        guard pid > 0, let app = NSRunningApplication(processIdentifier: pid_t(pid)),
              app.bundleURL?.standardizedFileURL.path == chrome.standardizedFileURL.path,
              !app.isTerminated else { return nil }
        return app
    }

    private func hasWindow(_ pid: pid_t) -> Bool {
        let windows = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID)
            as? [[String: Any]] ?? []
        return windows.contains { window in
            guard window[kCGWindowOwnerPID as String] as? Int == Int(pid),
                  window[kCGWindowLayer as String] as? Int == 0,
                  let bounds = window[kCGWindowBounds as String] as? NSDictionary,
                  let rect = CGRect(dictionaryRepresentation: bounds) else { return false }
            return rect.width >= 120 && rect.height >= 120
        }
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
