// ============================================================
// AI Chat to SiYuan — Options Script
// ============================================================

;(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const siyuanUrl = $('siyuanUrl');
  const siyuanToken = $('siyuanToken');
  const targetPath = $('targetPath');
  const notebookList = $('notebookList');
  const msg = $('msg');
  const testResult = $('testResult');

  let selectedNotebook = '';

  function showMsg(text, type = 'info') {
    msg.textContent = text;
    msg.className = 'msg ' + type;
    setTimeout(() => { msg.className = 'msg'; }, 5000);
  }

  // 加载保存的配置
  async function loadConfig() {
    const config = await chrome.storage.sync.get([
      'siyuanUrl', 'siyuanToken', 'siyuanNotebook', 'targetPath'
    ]);
    siyuanUrl.value = config.siyuanUrl || 'http://127.0.0.1:6806';
    siyuanToken.value = config.siyuanToken || '';
    targetPath.value = config.targetPath || '/AI对话';
    selectedNotebook = config.siyuanNotebook || '';
  }

  // 保存配置
  async function saveConfig() {
    const config = {
      siyuanUrl: siyuanUrl.value.trim() || 'http://127.0.0.1:6806',
      siyuanToken: siyuanToken.value.trim(),
      siyuanNotebook: selectedNotebook,
      targetPath: targetPath.value.trim() || '/AI对话'
    };

    await chrome.storage.sync.set(config);
    showMsg('✅ 设置已保存', 'success');
  }

  // 测试思源连接
  async function testConnection() {
    const url = siyuanUrl.value.trim() || 'http://127.0.0.1:6806';
    const token = siyuanToken.value.trim();

    testResult.className = 'test-result';
    testResult.textContent = '⏳ 正在连接...';

    try {
      const resp = await fetch(`${url}/api/system/version`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Token ${token}` : ''
        },
        signal: AbortSignal.timeout(5000)
      });
      const data = await resp.json();

      if (data.code === 0) {
        testResult.className = 'test-result ok';
        testResult.textContent = `✅ 连接成功！思源版本: v${data.data}`;
      } else if (data.code === -1 && data.msg && data.msg.includes('token')) {
        testResult.className = 'test-result fail';
        testResult.textContent = '❌ Token 错误，请检查 API Token 是否正确';
      } else {
        testResult.className = 'test-result fail';
        testResult.textContent = `❌ 连接失败: ${data.msg || '未知错误'}`;
      }
    } catch (err) {
      testResult.className = 'test-result fail';
      if (err.name === 'TimeoutError') {
        testResult.textContent = '❌ 连接超时，请确认思源笔记已启动且 API 地址正确';
      } else if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        testResult.textContent = '❌ 无法连接，请确保思源笔记正在运行，且未修改默认端口';
      } else {
        testResult.textContent = `❌ 连接失败: ${err.message}`;
      }
    }
  }

  // 刷新笔记本列表
  async function refreshNotebooks() {
    const url = siyuanUrl.value.trim() || 'http://127.0.0.1:6806';
    const token = siyuanToken.value.trim();

    notebookList.innerHTML = '<p style="color:var(--text-dim);font-size:13px;">⏳ 加载中...</p>';

    try {
      const resp = await fetch(`${url}/api/notebook/lsNotebooks`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Token ${token}` : ''
        },
        signal: AbortSignal.timeout(5000)
      });
      const data = await resp.json();

      if (data.code !== 0) {
        notebookList.innerHTML = `<p style="color:var(--error);font-size:13px;">❌ 获取失败: ${data.msg}</p>`;
        return;
      }

      const notebooks = data.data.notebooks || [];
      if (notebooks.length === 0) {
        notebookList.innerHTML = '<p style="color:var(--text-dim);font-size:13px;">没有找到笔记本，请先在思源中创建</p>';
        return;
      }

      // 渲染笔记本列表
      notebookList.innerHTML = '';
      notebooks.forEach((nb) => {
        const item = document.createElement('div');
        item.className = 'notebook-item' + (nb.id === selectedNotebook ? ' selected' : '');
        item.dataset.id = nb.id;

        item.innerHTML = `
          <div>
            <div class="name">${nb.icon ? String.fromCodePoint(parseInt(nb.icon, 16)) : '📓'} ${nb.name}</div>
            <div class="id">${nb.id} ${nb.closed ? '(已关闭)' : ''}</div>
          </div>
          ${nb.id === selectedNotebook ? '<span style="color:var(--accent);font-size:12px;">✓ 已选中</span>' : ''}
        `;

        item.addEventListener('click', () => {
          // 移除其他选中状态
          document.querySelectorAll('.notebook-item').forEach(el => el.classList.remove('selected'));
          item.classList.add('selected');
          selectedNotebook = nb.id;

          // 更新显示
          document.querySelectorAll('.notebook-item span:last-child').forEach(el => el.remove());
          const badge = document.createElement('span');
          badge.style.cssText = 'color:var(--accent);font-size:12px;';
          badge.textContent = '✓ 已选中';
          if (item.querySelector('.name')) {
            item.querySelector('.name').after(badge);
          }
        });

        notebookList.appendChild(item);
      });
    } catch (err) {
      notebookList.innerHTML = `<p style="color:var(--error);font-size:13px;">❌ 加载失败: ${err.message}</p>`;
    }
  }

  // --------------- 初始化 ---------------

  document.addEventListener('DOMContentLoaded', async () => {
    await loadConfig();

    $('saveBtn').addEventListener('click', saveConfig);
    $('testBtn').addEventListener('click', testConnection);
    $('refreshNotebooksBtn').addEventListener('click', refreshNotebooks);

    // 如果已配置，自动刷新笔记本列表
    if (siyuanUrl.value && siyuanToken.value) {
      refreshNotebooks();
    }
  });
})();
