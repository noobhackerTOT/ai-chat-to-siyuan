// ============================================================
// AI Chat to SiYuan — Popup Script
// ============================================================

;(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const msgEl = $('msg');
  const saveBtn = $('saveBtn');
  const previewBtn = $('previewBtn');
  const statusDot = $('statusDot');
  const currentPage = $('currentPage');
  const currentNotebook = $('currentNotebook');

  function showMsg(text, type = 'info') {
    msgEl.textContent = text;
    msgEl.className = 'msg ' + type;
  }

  function hideMsg() {
    msgEl.className = 'msg';
    msgEl.textContent = '';
  }

  // 获取当前标签页信息
  async function getCurrentTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0];
  }

  // 检查是否符合支持的站点
  function isSupportedUrl(url) {
    if (!url) return false;
    return url.includes('chatgpt.com') || url.includes('chat.openai.com') || url.includes('chat.deepseek.com');
  }

  // 获取平台名
  function getPlatformName(url) {
    if (url.includes('chatgpt.com') || url.includes('chat.openai.com')) return 'ChatGPT';
    if (url.includes('chat.deepseek.com')) return 'DeepSeek';
    return '未知';
  }

  // 检查思源连接
  async function checkSiyuanConnection() {
    const config = await chrome.storage.sync.get(['siyuanUrl', 'siyuanToken']);
    const baseUrl = config.siyuanUrl || 'http://127.0.0.1:6806';
    const token = config.siyuanToken || '';

    try {
      const resp = await fetch(`${baseUrl}/api/system/version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Token ${token}` : ''
        },
        signal: AbortSignal.timeout(3000)
      });
      const data = await resp.json();
      if (data.code === 0) {
        statusDot.className = 'status-dot online';
        statusDot.title = `思源已连接 (v${data.data})`;
        return true;
      }
      throw new Error(data.msg);
    } catch (err) {
      statusDot.className = 'status-dot offline';
      statusDot.title = '思源未连接';
      return false;
    }
  }

  // 获取笔记本名
  async function getNotebookName() {
    const config = await chrome.storage.sync.get(['siyuanNotebook', 'siyuanUrl', 'siyuanToken']);
    if (!config.siyuanNotebook) return '未设置（将使用默认笔记本）';

    try {
      const baseUrl = config.siyuanUrl || 'http://127.0.0.1:6806';
      const resp = await fetch(`${baseUrl}/api/notebook/lsNotebooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': config.siyuanToken ? `Token ${config.siyuanToken}` : ''
        },
        signal: AbortSignal.timeout(3000)
      });
      const data = await resp.json();
      if (data.code === 0 && data.data.notebooks) {
        const nb = data.data.notebooks.find(n => n.id === config.siyuanNotebook);
        return nb ? `${nb.name} (${nb.id.slice(0, 8)}...)` : config.siyuanNotebook;
      }
    } catch (e) {
      // 忽略连接错误
    }
    return config.siyuanNotebook;
  }

  // 初始化
  async function init() {
    const tab = await getCurrentTab();

    if (!tab || !isSupportedUrl(tab.url)) {
      currentPage.textContent = '❌ 请在 ChatGPT 或 DeepSeek 页面使用';
      saveBtn.disabled = true;
      previewBtn.disabled = true;
      return;
    }

    currentPage.textContent = `${getPlatformName(tab.url)} · ${tab.title || ''}`;
    saveBtn.disabled = false;
    previewBtn.disabled = false;

    // 检查连接状态
    const connected = await checkSiyuanConnection();
    currentNotebook.textContent = connected ? await getNotebookName() : '思源未连接';

    // 保存按钮
    saveBtn.addEventListener('click', async () => {
      hideMsg();
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ 处理中...';

      try {
        // 向 content script 发送消息触发保存
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'save' });

        if (response && response.success) {
          showMsg('✅ ' + (response.message || '已保存到思源'), 'success');
        } else if (response && response.error) {
          showMsg('❌ ' + response.error, 'error');
        } else {
          // content script 可能没有监听消息，直接触发点击事件
          // 或者通过 content script 内的 API 处理
          showMsg('正在通过页面内按钮操作...', 'info');
          await chrome.tabs.sendMessage(tab.id, { action: 'triggerSave' });
        }
      } catch (err) {
        // 常见原因：content script 未加载，或页面不支持
        if (err.message.includes('Could not establish connection')) {
          showMsg('⚠️ 请刷新页面后重试', 'error');
        } else {
          showMsg('❌ ' + err.message, 'error');
        }
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '📥 提取并保存到思源';
      }
    });

    // 预览按钮
    previewBtn.addEventListener('click', async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        await chrome.tabs.sendMessage(tab.id, { action: 'preview' });
      } catch (err) {
        showMsg('⚠️ 请刷新页面后重试', 'error');
      }
    });

    // 设置按钮
    $('settingsBtn').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
    });
    $('openOptions').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})();
