// ============================================================
// AI Chat to SiYuan — Content Script
// 在 ChatGPT 和 DeepSeek 页面注入「保存到思源」按钮
// ============================================================

;(() => {
  'use strict';

  // ============================================================
  //  工具函数
  // ============================================================

  function detectPlatform() {
    const host = location.hostname;
    if (host.includes('chatgpt.com') || host.includes('chat.openai.com')) return 'chatgpt';
    if (host.includes('chat.deepseek.com')) return 'deepseek';
    return 'unknown';
  }

  function getPageTitle() {
    const platform = detectPlatform();
    if (platform === 'chatgpt') {
      const h1 = document.querySelector('h1');
      if (h1 && h1.textContent.trim()) return h1.textContent.trim();
      const t = document.title;
      if (t && t !== 'ChatGPT' && !t.startsWith('Just')) return t;
      return 'ChatGPT 对话';
    }
    if (platform === 'deepseek') {
      const t = document.title;
      if (t && t !== 'DeepSeek') return t;
      // 尝试找当前对话标题（侧边栏高亮的那个）
      const active = document.querySelector('[class*="active"][class*="item"], [class*="active"][class*="title"]');
      if (active && active.textContent.trim()) return active.textContent.trim(); 
      return 'DeepSeek 对话';
    }
    return 'AI 对话';
  }

  function now() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // ============================================================
  //  剔除思考过程（文本级 + DOM 级双重清洗）
  // ============================================================

  // ============================================================
  //  HTML → Markdown 转换（保留 AI 输出格式）
  // ============================================================

  /**
   * DOM → Markdown 递归转换（比正则更精确，正确处理嵌套）
   */
  function domToMarkdown(node) {
    let result = '';
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        result += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        const tag = child.tagName.toLowerCase();
        const inner = domToMarkdown(child);

        switch (tag) {
          case 'strong': case 'b':
            result += '**' + inner + '**';
            break;
          case 'em': case 'i':
            result += '*' + inner + '*';
            break;
          case 'del': case 's':
            result += '~~' + inner + '~~';
            break;
          case 'code':
            if (child.closest('pre')) break; // pre > code 已在 pre 中处理
            result += '`' + inner + '`';
            break;
          case 'pre': {
            // 直接读取 code 元素的 textContent，不依赖递归 inner
            // 因为 code 的递归结果会在 case 'code' 的 closest('pre') 检查中被丢弃
            const codeEl = child.querySelector('code');
            const cls = codeEl && codeEl.className || '';
            const langMatch = cls.match(/(?:language-|lang-)(\w+)/);
            const lang = langMatch ? langMatch[1] : '';
            const codeText = codeEl ? codeEl.textContent.trim() : inner;
            if (codeText) {
              result += '\n```' + lang + '\n' + codeText + '\n```\n';
            }
            break;
          }
          case 'p':
            result += inner + '\n\n';
            break;
          case 'br':
            result += '\n';
            break;
          case 'hr':
            result += '\n---\n\n';
            break;
          case 'ul': case 'ol': {
            let idx = 0;
            for (const li of child.children) {
              if (li.tagName === 'LI') {
                idx++;
                const liInner = domToMarkdown(li);
                const prefix = tag === 'ol' ? idx + '. ' : '- ';
                result += prefix + liInner.trim() + '\n';
              }
            }
            result += '\n';
            break;
          }
          case 'h1': case 'h2': case 'h3':
          case 'h4': case 'h5': case 'h6':
            result += '#'.repeat(parseInt(tag[1])) + ' ' + inner.trim() + '\n\n';
            break;
          case 'a': {
            const href = child.getAttribute('href') || '';
            result += '[' + inner + '](' + href + ')';
            break;
          }
          case 'img': {
            const src = child.getAttribute('src') || '';
            const alt = child.getAttribute('alt') || '';
            result += '![' + alt + '](' + src + ')';
            break;
          }
          case 'blockquote': {
            const quoted = inner.trim().replace(/\n/g, '\n> ');
            result += '> ' + quoted + '\n\n';
            break;
          }
          case 'table': {
            const rows = child.querySelectorAll('tr');
            const tableLines = [];
            for (const row of rows) {
              const cells = row.querySelectorAll('td, th');
              const cellTexts = Array.from(cells).map(c => domToMarkdown(c).trim());
              tableLines.push('| ' + cellTexts.join(' | ') + ' |');
            }
            if (tableLines.length > 0) {
              const colCount = tableLines[0].split('|').length - 2;
              result += tableLines[0] + '\n|' + ' --- |'.repeat(colCount) + '\n';
              for (let r = 1; r < tableLines.length; r++) {
                result += tableLines[r] + '\n';
              }
              result += '\n';
            }
            break;
          }
          case 'div': case 'section': case 'article':
          case 'span': case 'header': case 'footer':
          case 'main': case 'aside': case 'nav':
            // 容器元素，直接传递内部内容
            result += inner;
            break;
          case 'ol': case 'ul': break; // 已在上面处理
          default:
            // 未知标签，也传内部内容
            result += inner;
        }
      }
    }
    return result;
  }

  /**
   * 从节点中获取纯净 Markdown 文本（保留格式，DOM 递归遍历）
   */
  function getCleanText(el, platform) {
    const clone = el.cloneNode(true);

    // 移除纯 UI 元素（使用精确选择器，不用 class* 模糊匹配避免误删内容）
    clone.querySelectorAll(
      'button:not([data-message-author-role]), ' +   // UI 按钮（排除可能的角色标记按钮）
      '[role="button"], [aria-label*="opy" i], ' +     // copy 按钮（aria-label="Copy"）
      '[aria-label*="dit" i], ' +                       // edit 按钮
      '[aria-label*="egenerate" i], ' +                 // regenerate 按钮
      '[aria-label*="ike" i], ' +                       // like 按钮
      '[aria-label*="islike" i], ' +                    // dislike 按钮
      'audio, video'                                     // 媒体元素
    ).forEach(n => n.remove());

    // 在 clone 中移除 thinking 区块
    // 策略：只删除明确的 thinking UI 标签（toggle/header），不动任何内容 DOM
    // 正文与思考内容的分离全部交给文本级 stripThinkingText 处理
    //
    // 1. 删除已知 thinking 容器（ChatGPT 的 reasoning details 元素）
    clone.querySelectorAll([
      'details[open]',                                     // ChatGPT 展开的思考块
      '[data-testid="reasoning"]',                          // ChatGPT reasoning 标记
      '[class*="think"][class*="container"]'                // 组合类名，不会是正文
    ].join(',')).forEach(el => el.remove());

    // 2. 找到文本匹配 thinking 的标签元素，只删标签自身，不删兄弟/内容
    const candidates = clone.querySelectorAll('div, section, span, button');
    for (const c of candidates) {
      const t = c.textContent.trim();
      if (t.length > 0 && t.length < 50 &&
          /^(思考过程|思考|推理过程|推理|Thought|Thinking|Reasoning)/i.test(t) &&
          // 确保不是正文内容（不含任何正文标记子元素）
          !c.querySelector('p, pre, ul, ol, table, h1, h2, h3, h4, h5, h6, [class*="markdown"], [class*="prose"]')) {
        c.remove();
      }
    }

    // DOM 递归遍历 → Markdown
    let md = domToMarkdown(clone);

    // 文本级二次清洗（移除思考文字）
    md = stripThinkingText(md);

    // 清理多余空行
    md = md.replace(/\n{3,}/g, '\n\n');

    return md.trim();
  }

  /** 文本级兜底清洗：移除思考过程残余 + 无意义符号 */
  function stripThinkingText(text) {
    if (!text) return text;
    let r = text;

    // 重复移除开头的思考块（每个块：关键词 + 可选冒号 + 内容 + 空行）
    // 最多 3 轮，覆盖多个思考段落的情况
    for (let i = 0; i < 3; i++) {
      const prev = r;
      // 模式 1：关键词 + 中文/英文冒号 + 任意内容 + 空行
      r = r.replace(/^(?:思考过程|推理过程|推理|Thought|Thinking|Reasoning)[：:]\s*[\s\S]*?\n\n/i, '');
      // 模式 2：关键词 + 换行 + 任意内容 + 空行
      r = r.replace(/^(?:思考过程|推理过程|推理|Thought|Thinking|Reasoning)\s*\n[\s\S]*?\n\n/i, '');
      if (r === prev) break;
    }

    // 兜底：如果文本以思考关键词开头且全文没有空行（无正式回复），整段删掉
    if (/^(?:思考过程|推理过程|推理|Thought|Thinking|Reasoning)/i.test(r) && !/\n\n/.test(r)) {
      r = r.replace(/^[\s\S]+/, '');
    }

    r = r.trim();

    // 移除中文标点前的多余「-」（如「模式）-。」→「模式）。」），不影响链接
    r = r.replace(/-([。，、；：？！．\.、])/g, '$1');
    // 移除孤立的脚注行（如单独的「-2」「-19」），保留行内链接 [-2](url) 不受影响
    r = r.replace(/^-(\d+)\s*$/gm, '');
    // 注意：不再删除行尾的「-」，因为会误删 --- 水平线和 ASCII 图
    return r;
  }

  // ============================================================
  //  对话提取逻辑
  // ============================================================

  /** 获取当前活跃对话的容器区域（排除侧边栏历史记录） */
  function getActiveChatArea(platform) {
    if (platform === 'chatgpt') {
      // ChatGPT 的主对话区域
      return document.querySelector('main') ||
             document.querySelector('[role="main"]') ||
             document.querySelector('[class*="conversation"]');
    }
    if (platform === 'deepseek') {
      // DeepSeek：主内容区，排除侧边栏
      // 先尝试 main
      const main = document.querySelector('main');
      if (main) return main;
      // 尝试深度查找对话消息容器
      const chatContainer = document.querySelector(
        '[class*="chat"][class*="container"], ' +
        '[class*="message"][class*="list"], ' +
        '[class*="conversation"][class*="content"], ' +
        '[class*="thread"]'
      );
      if (chatContainer) return chatContainer;
      // 兜底：找比较靠下的主要内容区域
      const allMain = document.querySelectorAll('div[class]');
      for (const el of allMain) {
        const rect = el.getBoundingClientRect();
        // 选择占据页面大部分宽度的中央区域（不是窄侧边栏）
        if (rect.width > window.innerWidth * 0.4 && rect.height > 300) {
          const text = el.textContent.trim();
          if (text.length > 200 && !text.includes('登录') && !text.includes('注册')) {
            return el;
          }
        }
      }
    }
    return null;
  }

  /** 去重 - 基于文本相似度 */
  function deduplicate(messages) {
    const unique = [];
    const seen = new Set();
    for (const m of messages) {
      // 用文本的前 100 字符 + 后 50 字符做签名
      const sig = m.text.slice(0, 100) + m.text.slice(-50);
      if (!seen.has(sig)) {
        seen.add(sig);
        unique.push(m);
      }
    }
    return unique;
  }

  /** ChatGPT */
  function extractChatGPT() {
    const area = getActiveChatArea('chatgpt');
    if (!area) return [];

    const articles = area.querySelectorAll('article[data-message-author-role]');
    if (!articles.length) return extractChatGPTFallback(area);

    const messages = [];
    articles.forEach((article) => {
      const role = article.getAttribute('data-message-author-role');
      const label = role === 'user' ? '🧑 User' : '🤖 Assistant';
      const text = getCleanText(article, 'chatgpt');
      const timeEl = article.querySelector('time');
      const timestamp = timeEl ? timeEl.getAttribute('datetime') || timeEl.textContent.trim() : '';
      if (text) messages.push({ role: label, text, timestamp });
    });
    return deduplicate(messages);
  }

  function extractChatGPTFallback(area) {
    const messages = [];
    const turns = area.querySelectorAll('[data-testid*="conversation-turn"]');
    turns.forEach((turn) => {
      const isUser = turn.querySelector('[data-message-author-role="user"]') !== null;
      const isAssistant = turn.querySelector('[data-message-author-role="assistant"]') !== null;
      const label = isUser ? '🧑 User' : isAssistant ? '🤖 Assistant' : '';
      const contentEl = turn.querySelector('.markdown, .whitespace-pre-wrap, [class*="markdown"]');
      const text = contentEl ? getCleanText(contentEl, 'chatgpt') : getCleanText(turn, 'chatgpt');
      if (label && text) messages.push({ role: label, text });
    });
    return deduplicate(messages);
  }

  /** DeepSeek */
  function extractDeepSeek() {
    const area = getActiveChatArea('deepseek');
    if (!area) return [];

    const messages = [];

    // 策略一：在 active 区域内找所有 markdown 内容块
    // DeepSeek 的 AI 回复通常有 .ds-markdown 容器
    const markdownBlocks = area.querySelectorAll('.ds-markdown, .markdown-body, [class*="markdown"]');
    
    if (markdownBlocks.length > 0) {
      // 用 Set 记录已处理的文本签名 (防止同一内容被多个选择器抓到)
      const processedSigs = new Set();

      markdownBlocks.forEach((block) => {
        // 跳过思考内容区域的 markdown 块
        // 如果这个 block 的父级包含 thinking 标题，则跳过
        let parent = block.parentElement;
        let isThinkBlock = false;
        for (let d = 0; parent && d < 5; d++) {
          const text = parent.textContent.trim();
          if (/^(思考过程|思考|推理过程|推理|Thought|Thinking)/i.test(text) && text.length < 200) {
            isThinkBlock = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (isThinkBlock) return;

        // 从 block 向上查找消息容器来判断角色
        let container = block.closest(
          '[class*="message"], [class*="chat-item"], [class*="item"], div[class]'
        ) || block.parentElement;
        
        // 判断是否为 AI 回复
        const isAI = container.textContent.includes('DeepSeek') ||
                     !!container.querySelector('[class*="avatar"]:not([class*="user"])');
        const role = isAI ? '🤖 DeepSeek' : '🧑 User';
        
        const text = getCleanText(block, 'deepseek');
        if (text) {
          const sig = text.slice(0, 80);
          if (!processedSigs.has(sig)) {
            processedSigs.add(sig);
            messages.push({ role, text });
          }
        }
      });

      if (messages.length > 0) return deduplicate(messages);
    }

    // 策略二：在 active 区域内按角色选择器查找
    const userEls = area.querySelectorAll(
      '[class*="user"]:not([class*="avatar"]):not([class*="menu"]):not([class*="icon"])'
    );
    const aiEls = area.querySelectorAll('[class*="assistant"], [class*="ai"], [class*="bot"], [class*="reply"]');

    const processedSigs = new Set();

    userEls.forEach(el => {
      const text = getCleanText(el, 'deepseek');
      if (text && text.length > 20) {
        const sig = text.slice(0, 80);
        if (!processedSigs.has(sig)) {
          processedSigs.add(sig);
          messages.push({ role: '🧑 User', text });
        }
      }
    });

    aiEls.forEach(el => {
      const text = getCleanText(el, 'deepseek');
      if (text && text.length > 20) {
        const mdEl = el.querySelector('.ds-markdown, .markdown-body, [class*="markdown"]');
        const content = mdEl ? getCleanText(mdEl, 'deepseek') : text;
        const sig = content.slice(0, 80);
        if (!processedSigs.has(sig)) {
          processedSigs.add(sig);
          messages.push({ role: '🤖 DeepSeek', text: content });
        }
      }
    });

    if (messages.length > 0) return deduplicate(messages);

    // 策略三（兜底）：取 area 内所有可见文本，按结构分组
    const paragraphs = area.querySelectorAll('p, pre, div > div > div');
    const seen = new Set();
    paragraphs.forEach(p => {
      const text = p.textContent.trim();
      if (text.length > 30 && !seen.has(text)) {
        seen.add(text);
        const hasCode = p.querySelector('code, pre') !== null;
        messages.push({ role: hasCode ? '🤖 DeepSeek' : '🧑 User', text });
      }
    });

    return deduplicate(messages).slice(0, 200);
  }

  // ============================================================
  //  Markdown 格式化（只做结构排版，不改 AI 原文）
  // ============================================================

  function formatMarkdown(messages, title) {
    if (!messages || messages.length === 0) return '';

    const platformName = detectPlatform() === 'chatgpt' ? 'ChatGPT' : 'DeepSeek';
    const exportTime = now();
    const msgCount = messages.length;
    const totalChars = messages.reduce((sum, m) => sum + m.text.length, 0);
    const estTokens = Math.round(totalChars / 2);

    const lines = [];

    // ---- 页眉 ----
    lines.push(`# 💬 ${title}`);
    lines.push('');
    lines.push(`> **来源**：${platformName}　　**导出**：${exportTime}　　**消息**：${msgCount} 条　　**≈** ${estTokens.toLocaleString()} tokens`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // ---- 正文（纯内容，不加任何标签） ----
    messages.forEach((msg) => {
      lines.push(msg.text);
      lines.push('');
    });

    // ---- 页脚 ----
    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`> *由 Boreas · AI Chat → SiYuan 插件自动导出 · ${exportTime}*`);

    return lines.join('\n');
  }

  // ============================================================
  //  思源 API
  // ============================================================

  async function sendToSiyuan(markdown, title, notebookId) {
    const { siyuanToken, siyuanUrl, targetPath } = await chrome.storage.sync.get([
      'siyuanToken', 'siyuanUrl', 'targetPath'
    ]);
    const baseUrl = siyuanUrl || 'http://127.0.0.1:6806';
    const token = siyuanToken || '';
    const basePath = targetPath || '/AI对话';
    const safeTitle = title.replace(/[/\\?%*:|"<>]/g, '_').slice(0, 100);
    const path = `${basePath}/${safeTitle}`;

    const response = await fetch(`${baseUrl}/api/filetree/createDocWithMd`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Token ${token}` : ''
      },
      body: JSON.stringify({ notebook: notebookId || '', path, markdown })
    });
    return response.json();
  }

  async function getNotebooks() {
    const { siyuanToken, siyuanUrl } = await chrome.storage.sync.get(['siyuanToken', 'siyuanUrl']);
    const baseUrl = siyuanUrl || 'http://127.0.0.1:6806';
    const token = siyuanToken || '';
    const response = await fetch(`${baseUrl}/api/notebook/lsNotebooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': token ? `Token ${token}` : ''
      }
    });
    return response.json();
  }

  // ============================================================
  //  UI 注入
  // ============================================================

  function injectButton() {
    if (document.getElementById('sy-save-btn')) return;

    const btn = document.createElement('div');
    btn.id = 'sy-save-btn';
    btn.innerHTML = `
      <div style="
        position: fixed; bottom: 100px; right: 24px; z-index: 99999;
        display: flex; flex-direction: column; gap: 6px;
      ">
        <button id="sy-save-primary" style="
          background: #4f46e5; color: white; border: none; border-radius: 12px;
          padding: 10px 18px; font-size: 14px; cursor: pointer;
          box-shadow: 0 4px 12px rgba(79,70,229,0.3);
          display: flex; align-items: center; gap: 6px;
          transition: all 0.2s;
        ">
          📥 保存到思源
        </button>
        <button id="sy-save-preview" style="
          background: #1f2937; color: #9ca3af; border: 1px solid #374151;
          border-radius: 8px; padding: 6px 14px; font-size: 12px; cursor: pointer;
          opacity: 0.7;
        ">
          👁 预览 MD
        </button>
      </div>
    `;
    document.body.appendChild(btn);
    document.getElementById('sy-save-primary').addEventListener('click', handleSave);
    document.getElementById('sy-save-preview').addEventListener('click', handlePreview);
  }

  // ============================================================
  //  通知
  // ============================================================

  function showToast(message, type = 'info') {
    const colors = { info: '#3b82f6', success: '#22c55e', error: '#ef4444' };
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 100000;
      background: ${colors[type] || colors.info}; color: white;
      padding: 12px 20px; border-radius: 10px; font-size: 14px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.2);
      transition: opacity 0.3s; max-width: 400px;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
  }

  // ============================================================
  //  主处理函数
  // ============================================================

  async function handleSave() {
    const platform = detectPlatform();
    let messages = [];

    if (platform === 'chatgpt') {
      messages = extractChatGPT();
    } else if (platform === 'deepseek') {
      messages = extractDeepSeek();
    } else {
      showToast('❌ 不支持此页面', 'error');
      return { success: false, error: '不支持此页面' };
    }

    if (!messages || messages.length === 0) {
      showToast('❌ 未找到对话内容，请确保页面已完整加载', 'error');
      return { success: false, error: '未找到对话内容' };
    }

    const title = getPageTitle();
    const markdown = formatMarkdown(messages, title);

    const { siyuanNotebook } = await chrome.storage.sync.get(['siyuanNotebook']);
    const notebookId = siyuanNotebook || '';

    try {
      const result = await sendToSiyuan(markdown, title, notebookId);
      if (result.code === 0) {
        showToast(`✅ 已保存到思源：${title} (${messages.length} 条消息)`, 'success');
        return { success: true, message: `已保存: ${title}` };
      } else if (result.code === -1 && result.msg && result.msg.includes('token')) {
        showToast('❌ API Token 未配置，请右键插件 → 选项 进行设置', 'error');
        return { success: false, error: 'Token 未配置' };
      } else if (result.code === -1 && notebookId === '') {
        showToast('⚠️ 请在插件选项中设置笔记本 ID', 'error');
        return { success: false, error: '笔记本未设置' };
      } else {
        showToast(`⚠️ 保存失败: ${result.msg || '未知错误'}`, 'error');
        return { success: false, error: result.msg };
      }
    } catch (err) {
      showToast(`❌ 连接思源失败: ${err.message}`, 'error');
      return { success: false, error: err.message };
    }
  }

  function handlePreview() {
    const platform = detectPlatform();
    let messages = [];
    if (platform === 'chatgpt') messages = extractChatGPT();
    else if (platform === 'deepseek') messages = extractDeepSeek();

    if (!messages || messages.length === 0) {
      showToast('❌ 未找到对话内容', 'error');
      return;
    }

    const title = getPageTitle();
    const markdown = formatMarkdown(messages, title);

    const platformName = platform === 'chatgpt' ? 'ChatGPT' : 'DeepSeek';
    const totalChars = messages.reduce((sum, m) => sum + m.text.length, 0);
    const estTokens = Math.round(totalChars / 2);

    const win = window.open('', '_blank', 'width=780,height=680,scrollbars=yes');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>MD 预览</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
          background: #0f172a; color: #e2e8f0; font: 14px/1.8 -apple-system,'SF Mono','Fira Code',monospace;
          padding: 28px; max-width: 820px; margin: 0 auto;
        }
        .toolbar {
          position: sticky; top: 0; z-index: 10; background: #0f172a; padding: 12px 0;
          border-bottom: 1px solid #1e293b; margin-bottom: 20px;
          display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
        }
        .toolbar .stats { color: #64748b; font-size: 12px; flex: 1; }
        .toolbar button {
          background: #4f46e5; color: white; border: none; border-radius: 8px;
          padding: 8px 18px; font-size: 13px; cursor: pointer;
          transition: opacity 0.2s;
        }
        .toolbar button:hover { opacity: 0.85; }
        .toolbar button.secondary { background: #1e293b; border: 1px solid #334155; }
        pre { white-space: pre-wrap; word-break: break-word; background: #131c31; border-radius: 8px; padding: 20px; border: 1px solid #1e293b; }
      </style></head><body>
      <div class="toolbar">
        <span class="stats">📊 ${messages.length} 条消息 · ${platformName} · ≈${estTokens.toLocaleString()} tokens</span>
        <button onclick="copyMD()" id="copyBtn">📋 复制 MD</button>
        <button class="secondary" onclick="window.close()">✕ 关闭</button>
      </div>
      <pre id="md">${markdown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
      <script>
        document.title = 'MD 预览 — ${title}';
        function copyMD() {
          navigator.clipboard.writeText(document.getElementById('md').textContent);
          document.getElementById('copyBtn').textContent = '✓ 已复制';
          setTimeout(() => { document.getElementById('copyBtn').textContent = '📋 复制 MD'; }, 2000);
        }
      </script></body></html>`);
    win.document.close();
  }

  // ============================================================
  //  消息监听
  // ============================================================

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'save' || request.action === 'triggerSave') {
      (async () => { sendResponse(await handleSave()); })();
      return true;
    }
    if (request.action === 'preview') {
      handlePreview();
      sendResponse({ success: true });
    }
    if (request.action === 'getNotebooks') {
      (async () => {
        try { sendResponse(await getNotebooks()); }
        catch (err) { sendResponse({ error: err.message }); }
      })();
      return true;
    }
    if (request.action === 'ping') {
      sendResponse({ status: 'alive', platform: detectPlatform() });
    }
  });

  // ============================================================
  //  初始化
  // ============================================================

  function init() {
    if (detectPlatform() === 'unknown') return;
    injectButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.__aiChatExtractor = {
    extractChatGPT, extractDeepSeek, formatMarkdown,
    getPageTitle, detectPlatform, sendToSiyuan, getNotebooks, showToast, handleSave
  };
})();
