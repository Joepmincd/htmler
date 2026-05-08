// ── 方式一：点击扩展图标 → 新开标签页使用编辑器 ──
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('editor.html') });
});

// ── 方式二：右键菜单 → 直接编辑当前页面 ──
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'edit-current-page',
    title: '🛠 使用 HTML Editor 编辑当前页面',
    contexts: ['page']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'edit-current-page' && tab.id) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  }
});
