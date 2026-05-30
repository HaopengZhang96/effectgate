import Cocoa
import Foundation
import Darwin

final class EffectGateMenuBar: NSObject, NSApplicationDelegate {
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let baseURL = EffectGateMenuBar.daemonURL()
    private var pendingAlerts: [PendingAlert] = []
    private var recentEffects: [RecentEffect] = []

    static func daemonURL() -> URL {
        let env = ProcessInfo.processInfo.environment["EFFECTGATE_DAEMON_URL"] ?? "http://127.0.0.1:8765"
        return URL(string: env) ?? URL(string: "http://127.0.0.1:8765")!
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem.button?.title = "EffectGate"
        refreshMenu()
        Timer.scheduledTimer(withTimeInterval: 10, repeats: true) { [weak self] _ in
            self?.refreshMenu()
        }
    }

    private func refreshMenu() {
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "EffectGate", action: nil, keyEquivalent: ""))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "Refresh", action: #selector(refreshNow), keyEquivalent: "r"))
        menu.addItem(NSMenuItem(title: "Open daemon health", action: #selector(openHealth), keyEquivalent: "h"))
        menu.addItem(NSMenuItem.separator())
        loadSummary { result in
            DispatchQueue.main.async {
                switch result {
                case .offline:
                    self.pendingAlerts = []
                    self.recentEffects = []
                    self.statusItem.button?.title = "EffectGate !"
                    menu.addItem(NSMenuItem(title: "Daemon offline", action: nil, keyEquivalent: ""))
                    menu.addItem(NSMenuItem(title: self.baseURL.absoluteString, action: nil, keyEquivalent: ""))
                    // No approval actions when the daemon is offline.
                case .loaded(let summary):
                    let pending = summary.pending
                    if pending.isEmpty {
                        self.pendingAlerts = []
                        self.recentEffects = summary.recent
                        if summary.recent.isEmpty {
                            self.statusItem.button?.title = "EffectGate"
                            menu.addItem(NSMenuItem(title: "No pending protected effects", action: nil, keyEquivalent: ""))
                        } else {
                            self.statusItem.button?.title = "EffectGate recent"
                            menu.addItem(NSMenuItem(title: "Recent protected effects", action: nil, keyEquivalent: ""))
                            for effect in summary.recent.prefix(8) {
                                menu.addItem(NSMenuItem(title: "\(effect.effectId) recently used", action: nil, keyEquivalent: ""))
                            }
                        }
                    } else {
                        self.statusItem.button?.title = "EffectGate \(pending.count)"
                        self.pendingAlerts = pending
                        self.recentEffects = summary.recent
                        for (index, alert) in pending.prefix(8).enumerated() {
                            menu.addItem(NSMenuItem(title: "\(alert.effectId) pending", action: nil, keyEquivalent: ""))
                            let approve = NSMenuItem(title: "Approve 10m", action: #selector(self.approvePending(_:)), keyEquivalent: "")
                            approve.representedObject = index
                            menu.addItem(approve)
                            let deny = NSMenuItem(title: "Deny", action: #selector(self.denyPending(_:)), keyEquivalent: "")
                            deny.representedObject = index
                            menu.addItem(deny)
                            menu.addItem(NSMenuItem.separator())
                        }
                        if !summary.recent.isEmpty {
                            menu.addItem(NSMenuItem(title: "Recent protected effects", action: nil, keyEquivalent: ""))
                            for effect in summary.recent.prefix(5) {
                                menu.addItem(NSMenuItem(title: "\(effect.effectId) recently used", action: nil, keyEquivalent: ""))
                            }
                        }
                    }
                }
                menu.addItem(NSMenuItem.separator())
                menu.addItem(NSMenuItem(title: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
                self.statusItem.menu = menu
            }
        }
    }

    @objc private func refreshNow() {
        refreshMenu()
    }

    @objc private func openHealth() {
        NSWorkspace.shared.open(baseURL.appendingPathComponent("healthz"))
    }

    @objc private func approvePending(_ sender: NSMenuItem) {
        guard
            let index = sender.representedObject as? Int,
            pendingAlerts.indices.contains(index)
        else { return }
        let alert = pendingAlerts[index]
        postJSON(path: "approve", body: [
            "effectId": alert.effectId,
            "ttl": "10m",
            "maxCalls": 1,
            "scope": "session"
        ]) { [weak self] in
            self?.refreshMenu()
        }
    }

    @objc private func denyPending(_ sender: NSMenuItem) {
        guard
            let index = sender.representedObject as? Int,
            pendingAlerts.indices.contains(index)
        else { return }
        let alert = pendingAlerts[index]
        postJSON(path: "deny", body: ["id": alert.id]) { [weak self] in
            self?.refreshMenu()
        }
    }

    private func loadSummary(_ callback: @escaping (SummaryLoadResult) -> Void) {
        URLSession.shared.dataTask(with: effectGateSummaryURL(baseURL)) { data, _, _ in
            guard
                let data,
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let pending = object["pending"] as? [[String: Any]]
            else {
                callback(.offline)
                return
            }
            let recent = object["recent"] as? [[String: Any]] ?? []
            callback(.loaded(Summary(
                pending: pending.map { alert in
                    PendingAlert(
                        id: alert["id"] as? String ?? "",
                        effectId: alert["effectId"] as? String ?? "unknown",
                        createdAt: alert["createdAt"] as? String ?? ""
                    )
                },
                recent: recent.map { effect in
                    RecentEffect(
                        effectId: effect["effectId"] as? String ?? "unknown",
                        lastSeenAt: effect["lastSeenAt"] as? String ?? ""
                    )
                }
            )))
        }.resume()
    }

    private func postJSON(path: String, body: [String: Any], done: @escaping () -> Void) {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        URLSession.shared.dataTask(with: request) { _, _, _ in
            DispatchQueue.main.async(execute: done)
        }.resume()
    }
}

enum SummaryLoadResult {
    case loaded(Summary)
    case offline
}

struct Summary {
    let pending: [PendingAlert]
    let recent: [RecentEffect]
}

struct PendingAlert {
    let id: String
    let effectId: String
    let createdAt: String
}

struct RecentEffect {
    let effectId: String
    let lastSeenAt: String
}

struct DesktopSelfTest {
    static func run(baseURL: URL) -> Int32 {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Summary, Error> = .success(Summary(pending: [], recent: []))
        var request = URLRequest(url: effectGateSummaryURL(baseURL))
        request.timeoutInterval = 3
        URLSession.shared.dataTask(with: request) { data, _, error in
            defer { semaphore.signal() }
            if let error {
                result = .failure(error)
                return
            }
            guard
                let data,
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let pending = object["pending"] as? [[String: Any]]
            else {
                result = .failure(SelfTestError.invalidSummaryResponse)
                return
            }
            let recent = object["recent"] as? [[String: Any]] ?? []
            result = .success(Summary(
                pending: pending.map { alert in
                    PendingAlert(
                        id: alert["id"] as? String ?? "",
                        effectId: alert["effectId"] as? String ?? "unknown",
                        createdAt: alert["createdAt"] as? String ?? ""
                    )
                },
                recent: recent.map { effect in
                    RecentEffect(
                        effectId: effect["effectId"] as? String ?? "unknown",
                        lastSeenAt: effect["lastSeenAt"] as? String ?? ""
                    )
                }
            ))
        }.resume()

        if semaphore.wait(timeout: .now() + 4) == .timedOut {
            fputs("EffectGate desktop self-test failed: daemon request timed out\n", stderr)
            return 1
        }

        switch result {
        case .success(let summary):
            let effects = summary.pending.map { $0.effectId }.joined(separator: ",")
            let recentEffects = summary.recent.map { $0.effectId }.joined(separator: ",")
            print("EffectGate desktop self-test")
            print("daemonURL=\(baseURL.absoluteString)")
            print("pendingCount=\(summary.pending.count)")
            print("effects=\(effects)")
            print("recentCount=\(summary.recent.count)")
            print("recentEffects=\(recentEffects)")
            return 0
        case .failure(let error):
            fputs("EffectGate desktop self-test failed: \(error)\n", stderr)
            return 1
        }
    }
}

enum SelfTestError: Error {
    case invalidSummaryResponse
}

func effectGateSummaryURL(_ baseURL: URL) -> URL {
    var components = URLComponents(url: baseURL.appendingPathComponent("summary"), resolvingAgainstBaseURL: false)!
    components.queryItems = [URLQueryItem(name: "recent", value: "24h")]
    return components.url!
}

if ProcessInfo.processInfo.environment["EFFECTGATE_SELF_TEST"] == "1" {
    Darwin.exit(DesktopSelfTest.run(baseURL: EffectGateMenuBar.daemonURL()))
}

let app = NSApplication.shared
let delegate = EffectGateMenuBar()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
