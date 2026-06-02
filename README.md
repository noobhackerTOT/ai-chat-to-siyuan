# AI 对话 → 思源笔记

一个 Chrome 扩展，将 **ChatGPT** 和 **DeepSeek** 网页对话一键保存为 Markdown 并导入 **思源笔记**。

## 功能

- 🎯 自动识别页面（ChatGPT / DeepSeek）
- 📥 页面右下角悬浮按钮「保存到思源」
- 👁 预览导出的 Markdown 内容
- 📋 一键复制 Markdown
- 🔗 通过思源笔记 REST API 直接创建文档
- 📂 可自定义保存路径（默认 `/AI对话`）

## 安装

### 1. 加载扩展

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 开启右上角的 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本文件夹 `ai-chat-to-siyuan`

### 2. 配置思源连接

1. 打开思源笔记 → 设置 → 关于 → 复制 **API Token**
2. 右键浏览器工具栏的扩展图标 → **选项**
3. 填写：
   - **API 地址**: `http://127.0.0.1:6806`（默认）
   - **API Token**: 从思源复制的 Token
   - **保存路径**: 如 `/AI对话`（可选）
4. 点击 **测试连接** 验证配置
5. 点击 **刷新笔记本列表** 选择目标笔记本

### 3. 使用

- 打开 ChatGPT (chatgpt.com) 或 DeepSeek (chat.deepseek.com) 对话页面
- 页面右下角出现 **📥 保存到思源** 按钮
- 点击即可将当前对话保存到思源笔记
- 也可以点击浏览器工具栏的扩展图标，从弹出面板操作

## 思源笔记 API 说明

插件使用思源笔记以下 API：

| API | 用途 |
|-----|------|
| `POST /api/system/version` | 测试连接 |
| `POST /api/notebook/lsNotebooks` | 获取笔记本列表 |
| `POST /api/filetree/createDocWithMd` | 创建文档并写入 Markdown |

更多信息请参考 [思源笔记 API 文档](https://github.com/siyuan-note/siyuan/blob/master/API_zh_CN.md)

## 项目结构

```
ai-chat-to-siyuan/
├── manifest.json        # Chrome 扩展清单
├── icons/               # 扩展图标
│   ├── icon48.png
│   └── icon128.png
├── src/
│   ├── content.js       # 内容脚本（对话提取 + UI 注入）
│   ├── content.css      # 内容脚本样式
│   ├── background.js    # 后台 Service Worker
│   ├── popup.html       # 弹出面板
│   ├── popup.js         # 弹出面板逻辑
│   ├── options.html     # 设置页面
│   └── options.js       # 设置页面逻辑
└── README.md
```

## 隐私说明

- 所有数据仅在浏览器本地处理
- 对话内容仅发送到您自己的思源笔记 API（本地 `127.0.0.1:6806`）
- 不含任何第三方分析或数据收集

## License

MIT
