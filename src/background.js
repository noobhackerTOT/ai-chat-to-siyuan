// ============================================================
// AI Chat to SiYuan — Background Service Worker
// 处理来自 content script 或 popup 的消息
// ============================================================

chrome.runtime.onInstalled.addListener(() => {
  // 初始化默认配置
  chrome.storage.sync.get(['siyuanUrl', 'siyuanToken', 'siyuanNotebook', 'targetPath'], (result) => {
    const defaults = {};
    if (!result.siyuanUrl) defaults.siyuanUrl = 'http://127.0.0.1:6806';
    if (!result.targetPath) defaults.targetPath = '/AI对话';
    if (!result.siyuanToken) defaults.siyuanToken = '';
    if (!result.siyuanNotebook) defaults.siyuanNotebook = '';
    if (Object.keys(defaults).length > 0) {
      chrome.storage.sync.set(defaults);
    }
  });
});

// 监听来自 popup 或 content script 的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getConfig') {
    chrome.storage.sync.get(['siyuanUrl', 'siyuanToken', 'siyuanNotebook', 'targetPath'], (result) => {
      sendResponse(result);
    });
    return true; // 保持通道开放用于异步响应
  }

  if (request.action === 'saveConfig') {
    chrome.storage.sync.set(request.config, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (request.action === 'getNotebooks') {
    // 从 content script 获取笔记本列表
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'getNotebooks' }, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: 'No active tab' });
      }
    });
    return true;
  }

  if (request.action === 'extractAndSave') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'save' }, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ error: 'No active tab' });
      }
    });
    return true;
  }
});
