import Cocoa
import UniformTypeIdentifiers
@preconcurrency import WebKit
// MARK: - App Entry Point
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()

// MARK: - App Delegate
class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {

    var window: NSWindow!
    var webView: WKWebView!
    var currentFileURL: URL?
    var fileURLsByPath: [String: URL] = [:]
    var pendingOpenURL: URL?
    private var webViewReady = false

    // ── Application Lifecycle ──

    func applicationDidFinishLaunching(_ notification: Notification) {
        let screenFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
        let windowRect = NSRect(
            x: screenFrame.midX - 600,
            y: screenFrame.midY - 400,
            width: 1200,
            height: 800
        )

        window = NSWindow(
            contentRect: windowRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "HTML Editor"
        window.minSize = NSSize(width: 640, height: 480)
        window.center()

        let config = WKWebViewConfiguration()
        let userContent = WKUserContentController()
        userContent.add(self, name: "editorBridge")
        config.userContentController = userContent

        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        // 允许用户脚本弹窗
        webView.configuration.preferences.setValue(true, forKey: "developerExtrasEnabled")

        window.contentView = webView
        window.makeKeyAndOrderFront(nil)
        window.delegate = self

        // 加载编辑器 HTML
        if let url = Bundle.main.url(forResource: "editor", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        setupMenus()

        // 处理命令行传入的文件
        if CommandLine.arguments.count > 1 {
            let url = URL(fileURLWithPath: CommandLine.arguments[1])
            openFileFromURL(url)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return true
    }

    // ── 从 Finder "打开方式" 接收文件 ──

    func application(_ sender: NSApplication, openFiles filenames: [String]) {
        guard let path = filenames.first else {
            NSApplication.shared.reply(toOpenOrPrint: .failure)
            return
        }
        let url = URL(fileURLWithPath: path)
        openFileFromURL(url)
        NSApplication.shared.reply(toOpenOrPrint: .success)
    }

    // ── 文件操作 ──

    func openFileFromURL(_ url: URL) {
        guard ["html", "htm", "jsx", "tsx"].contains(url.pathExtension.lowercased()) else { return }

        if webViewReady {
            loadHTMLContent(from: url)
        } else {
            pendingOpenURL = url
        }
    }

    func loadHTMLContent(from url: URL) {
        do {
            let content = try String(contentsOf: url, encoding: .utf8)
            currentFileURL = url
            fileURLsByPath[url.path] = url
            window.title = url.lastPathComponent

            let data: [String: String] = [
                "source": content,
                "html": content,
                "filename": url.lastPathComponent,
                "kind": url.pathExtension.lowercased(),
                "path": url.path
            ]
            let json = try JSONSerialization.data(withJSONObject: data)
            let jsonStr = String(data: json, encoding: .utf8)!

            webView.evaluateJavaScript("window.__loadHTMLContent(\(jsonStr))")
        } catch {
            showError("无法读取文件：\(error.localizedDescription)")
        }
    }

    @objc func saveCurrentFile() {
        webView.evaluateJavaScript("window.__buildCurrentPayload()") { [weak self] result, error in
            guard let self = self else { return }
            guard let payload = result as? [String: Any], let content = payload["content"] as? String else {
                if let error = error {
                    self.showError("保存失败：\(error.localizedDescription)")
                }
                return
            }
            let path = payload["path"] as? String
            let targetURL = path.flatMap { self.fileURLsByPath[$0] ?? URL(fileURLWithPath: $0) } ?? self.currentFileURL

            if let url = targetURL {
                do {
                    try content.write(to: url, atomically: true, encoding: .utf8)
                    self.currentFileURL = url
                    self.fileURLsByPath[url.path] = url
                    self.webView.evaluateJavaScript("window.__saveDone(true)")
                } catch {
                    self.webView.evaluateJavaScript("window.__saveDone(false)")
                    self.showError("保存失败：\(error.localizedDescription)")
                }
            } else {
                self.saveFileAs(html: content)
            }
        }
    }

    func saveFileAs(html: String) {
        let panel = NSSavePanel()
        let jsxType = UTType(filenameExtension: "jsx") ?? .plainText
        let tsxType = UTType(filenameExtension: "tsx") ?? .plainText
        panel.allowedContentTypes = [.html, jsxType, tsxType]
        panel.nameFieldStringValue = currentFileURL?.lastPathComponent ?? "untitled.html"

        panel.begin { [weak self] response in
            guard let self = self else { return }
            if response == .OK, let url = panel.url {
                do {
                    try html.write(to: url, atomically: true, encoding: .utf8)
                    self.currentFileURL = url
                    self.window.title = url.lastPathComponent
                    self.webView.evaluateJavaScript("window.__saveAsDone(true)")
                } catch {
                    self.webView.evaluateJavaScript("window.__saveAsDone(false)")
                }
            } else {
                self.webView.evaluateJavaScript("window.__saveAsDone(false)")
            }
        }
    }

    @objc func openFileDialog() {
        let panel = NSOpenPanel()
        let jsxType = UTType(filenameExtension: "jsx") ?? .plainText
        let tsxType = UTType(filenameExtension: "tsx") ?? .plainText
        panel.allowedContentTypes = [.html, jsxType, tsxType]
        panel.allowsMultipleSelection = false
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.begin { [weak self] response in
            if response == .OK, let url = panel.url {
                self?.openFileFromURL(url)
            }
        }
    }

    // ── 图片替换 ──

    func replaceImage() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.image]
        panel.allowsMultipleSelection = false
        panel.begin { [weak self] response in
            guard let self = self else { return }
            if response == .OK, let url = panel.url {
                if let data = try? Data(contentsOf: url) {
                    let base64 = data.base64EncodedString()
                    let ext = url.pathExtension.lowercased()
                    let mimeType = ext == "png" ? "image/png"
                        : ext == "gif" ? "image/gif"
                        : ext == "webp" ? "image/webp"
                        : "image/jpeg"
                    let dataURL = "data:\(mimeType);base64,\(base64)"
                    self.webView.evaluateJavaScript("""
                        if (window.activeImg) {
                            window.activeImg.src = '\(dataURL)';
                            toast('✅ 图片已替换');
                        }
                    """)
                }
            }
        }
    }

    // ── Downloads 文件列表 ──

    func listDownloads() {
        let dlDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Downloads")
        guard let files = try? FileManager.default.contentsOfDirectory(at: dlDir, includingPropertiesForKeys: [.contentModificationDateKey], options: [.skipsHiddenFiles]) else {
            webView.evaluateJavaScript("window.__receiveDownloadsList([])")
            return
        }
        let htmlFiles = files.filter { ["html", "htm", "jsx", "tsx"].contains($0.pathExtension.lowercased()) }
            .sorted { url1, url2 in
                let d1 = (try? url1.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date.distantPast
                let d2 = (try? url2.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date.distantPast
                return d1 > d2
            }
            .prefix(20)
            .map { ["name": $0.lastPathComponent, "path": $0.path] }
        if let data = try? JSONSerialization.data(withJSONObject: htmlFiles),
           let json = String(data: data, encoding: .utf8) {
            webView.evaluateJavaScript("window.__receiveDownloadsList(\(json))")
        }
    }

    // ── 错误提示 ──

    func showError(_ msg: String) {
        let alert = NSAlert()
        alert.messageText = msg
        alert.alertStyle = .warning
        alert.addButton(withTitle: "确定")
        alert.runModal()
    }

    // ── WKNavigationDelegate ──

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webViewReady = true
        if let url = pendingOpenURL {
            loadHTMLContent(from: url)
            pendingOpenURL = nil
        }
    }

    // ── WKScriptMessageHandler (JS → Native) ──

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "editorBridge",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String else { return }

        switch action {
        case "open":
            openFileDialog()
        case "save":
            if let content = (body["content"] as? String) ?? (body["html"] as? String) {
                let path = body["path"] as? String
                let targetURL = path.flatMap { fileURLsByPath[$0] ?? URL(fileURLWithPath: $0) } ?? currentFileURL
                if let url = targetURL {
                    do {
                        try content.write(to: url, atomically: true, encoding: .utf8)
                        currentFileURL = url
                        fileURLsByPath[url.path] = url
                        webView.evaluateJavaScript("window.__saveDone(true)")
                    } catch {
                        webView.evaluateJavaScript("window.__saveDone(false)")
                        showError("保存失败：\(error.localizedDescription)")
                    }
                } else {
                    saveFileAs(html: content)
                }
            }
        case "replaceImage":
            replaceImage()
        case "listDownloads":
            listDownloads()
        case "openPath":
            if let path = body["path"] as? String {
                openFileFromURL(URL(fileURLWithPath: path))
            }
        default:
            break
        }
    }
}

// MARK: - WKUIDelegate (弹窗支持)
extension AppDelegate: WKUIDelegate {
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "确定")
        alert.runModal()
        completionHandler()
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        alert.alertStyle = .informational
        alert.addButton(withTitle: "确定")
        alert.addButton(withTitle: "取消")
        completionHandler(alert.runModal() == .alertFirstButtonReturn)
    }
}

// MARK: - NSWindowDelegate
extension AppDelegate: NSWindowDelegate {
    func windowDidBecomeMain(_ notification: Notification) {
        // 每次窗口激活时同步菜单状态
    }
}

// MARK: - 菜单设置
extension AppDelegate {

    func setupMenus() {
        let mainMenu = NSMenu()

        // ── App 菜单 ──
        let appMenuItem = NSMenuItem(title: "HTML Editor", action: nil, keyEquivalent: "")
        let appMenu = NSMenu(title: "HTML Editor")
        appMenuItem.submenu = appMenu

        appMenu.addItem(NSMenuItem(title: "关于 HTML Editor", action: #selector(showAbout), keyEquivalent: ""))
        appMenu.addItem(.separator())
        appMenu.addItem(NSMenuItem(title: "退出 HTML Editor", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"))
        mainMenu.addItem(appMenuItem)

        // ── 文件菜单 ──
        let fileMenuItem = NSMenuItem(title: "文件", action: nil, keyEquivalent: "")
        let fileMenu = NSMenu(title: "文件")
        fileMenuItem.submenu = fileMenu

        fileMenu.addItem(NSMenuItem(title: "打开...", action: #selector(openFileDialog), keyEquivalent: "o"))
        fileMenu.addItem(NSMenuItem(title: "保存", action: #selector(saveCurrentFile), keyEquivalent: "s"))
        fileMenu.addItem(NSMenuItem(title: "另存为...", action: #selector(saveAs), keyEquivalent: "S"))
        fileMenu.addItem(.separator())
        let closeItem = NSMenuItem(title: "关闭窗口", action: #selector(NSWindow.close), keyEquivalent: "w")
        fileMenu.addItem(closeItem)
        mainMenu.addItem(fileMenuItem)

        // ── 编辑菜单 ──
        let editMenuItem = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editMenu = NSMenu(title: "编辑")
        editMenuItem.submenu = editMenu

        editMenu.addItem(NSMenuItem(title: "撤销", action: Selector(("undo:")), keyEquivalent: "z"))
        editMenu.addItem(NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "Z"))
        editMenu.addItem(.separator())
        editMenu.addItem(NSMenuItem(title: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x"))
        editMenu.addItem(NSMenuItem(title: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c"))
        editMenu.addItem(NSMenuItem(title: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v"))
        editMenu.addItem(NSMenuItem(title: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a"))
        mainMenu.addItem(editMenuItem)

        // ── 视图菜单 ──
        let viewMenuItem = NSMenuItem(title: "视图", action: nil, keyEquivalent: "")
        let viewMenu = NSMenu(title: "视图")
        viewMenuItem.submenu = viewMenu

        let reloadItem = NSMenuItem(title: "重新加载", action: #selector(reloadEditor), keyEquivalent: "r")
        viewMenu.addItem(reloadItem)
        viewMenu.addItem(NSMenuItem(title: "进入全屏", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f"))
        mainMenu.addItem(viewMenuItem)

        // ── 窗口菜单 ──
        let windowMenuItem = NSMenuItem(title: "窗口", action: nil, keyEquivalent: "")
        let windowMenu = NSMenu(title: "窗口")
        windowMenuItem.submenu = windowMenu
        windowMenu.addItem(NSMenuItem(title: "最小化", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m"))
        mainMenu.addItem(windowMenuItem)

        NSApp.mainMenu = mainMenu
    }

    @objc func showAbout() {
        NSApp.orderFrontStandardAboutPanel(nil)
    }

    @objc func saveAs() {
        webView.evaluateJavaScript("window.__buildCurrentPayload()") { [weak self] result, error in
            guard let self = self,
                  let payload = result as? [String: Any],
                  let content = payload["content"] as? String else { return }
            self.saveFileAs(html: content)
        }
    }

    @objc func reloadEditor() {
        if let url = Bundle.main.url(forResource: "editor", withExtension: "html") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
            webViewReady = false
        }
    }
}
