[README.md](https://github.com/user-attachments/files/27505111/README.md)
# HTML Editor

**所见即所得的 HTML 编辑器** — 在预览中直接点击、编辑、排版，无需切换源码视图。

---

## 核心亮点

传统 HTML 编辑需要你在源码和预览之间来回切换，效率低下。HTML Editor 打破了这种模式：**你在预览中看到什么，就能直接编辑什么**。点击文字直接改内容，拖拽调字号，点选图片即可替换 — 一切都发生在最终渲染的页面上。

- **真正所见即所得**：编辑操作直接在渲染预览上进行，不是源码编辑器 + 预览面板的分屏模式
- **零学习成本**：不需要懂 HTML 语法，像操作 Word 一样编辑网页
- **本地优先**：文件留在你的电脑上，不上传任何服务器
- **双形态覆盖**：macOS 原生 App + Chrome 浏览器插件，覆盖不同使用场景

---

## 功能一览

| 功能 | macOS App | Chrome 插件 |
|------|-----------|-------------|
| 预览中直接编辑文字 | ✅ | ✅ |
| 调整文字字号 | ✅ | ✅ |
| 新增 / 删除元素 | ✅ | ✅ |
| 插入 / 替换图片 (base64) | ✅ | ✅ |
| 多标签页管理 | ✅ | ✅ |
| 拖放打开 HTML 文件 | ✅ | ✅ |
| 快捷键保存 (⌘S) | ✅ | ✅ |
| 原生菜单栏 | ✅ | — |
| Finder「打开方式」关联 | ✅ | — |
| 右键编辑当前页面 | — | ✅ |

---

## 安装与使用

### macOS 原生 App

1. 下载 `HTML-Editor.dmg`
2. 双击挂载，将 `HTML Editor.app` 拖入 `Applications` 文件夹
3. 首次打开时，在 Finder 中右键点击 App → 「打开」以绕过未签名提示

**使用方式**：
- 直接打开 App，通过「📂 打开文件」按钮或拖放 `.html` 文件
- 在 Finder 中右键点击 `.html` 文件 → 「打开方式」→ 「HTML Editor」
- 支持多标签页，可同时编辑多个文件

### Chrome 浏览器插件

1. 打开 Chrome，进入 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」，选择 `chrome-extension` 文件夹
4. 插件安装完成，工具栏出现 HTML Editor 图标

**两种使用方式**：

| 方式 | 操作 | 适用场景 |
|------|------|----------|
| 🆕 **新标签页编辑** | 点击工具栏插件图标 | 打开本地 HTML 文件进行编辑 |
| 📄 **直接编辑当前页面** | 在任意网页上右键 →「使用 HTML Editor 编辑当前页面」 | 快速修改当前页面内容、截图前的文案调整 |

---

## 技术架构

```
HTML Editor
├── src/App.swift              # macOS 原生 App（Swift + WKWebView）
├── Resources/editor.html      # App 内置编辑器页面
├── chrome-extension/          # Chrome 浏览器插件
│   ├── manifest.json          # 插件配置
│   ├── background.js          # 后台服务（新标签页 + 右键菜单）
│   ├── editor.html            # 新标签页编辑器
│   ├── content.js             # 当前页面注入编辑脚本
│   └── icons/                 # 插件图标
├── build.sh                   # macOS App 构建脚本
└── gen_icon.py                # 图标生成脚本
```

- **编辑器核心**：纯前端实现（HTML + CSS + JavaScript），同时用于 App 和插件，一套代码两种形态
- **macOS App**：Swift 壳加载 WKWebView，通过 `WKScriptMessageHandler` 桥接原生能力（文件系统访问、原生对话框）
- **Chrome 插件**：Manifest V3，两种触发方式（Action 点击 + Context Menu 注入）

---

## 开发

### 构建 macOS App

```bash
./build.sh
```

产物在 `build/` 目录下，同时生成 `HTML-Editor.dmg`。

### 更新 Chrome 插件

修改 `chrome-extension/` 下的文件后，在 `chrome://extensions/` 点击刷新按钮即可。无需重新打包。

---

## License

MIT
