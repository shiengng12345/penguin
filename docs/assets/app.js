const SHORTCUTS = [
  {
    category: {
      en: "Request",
      zh: "请求",
    },
    items: [
      { keys: "⌘ + Enter", en: "Send request", zh: "发送请求" },
      { keys: "Esc", en: "Cancel in-flight request", zh: "取消发送中的请求" },
      { keys: "⌘ + Shift + S", en: "Save current request", zh: "保存当前请求" },
      { keys: "⌘ + D", en: "Request as documentation", zh: "生成请求文档" },
      { keys: "⌘ + P", en: "View proto definitions (request & response)", zh: "查看 proto 定义（请求和响应）" },
      { keys: "⌘ + E", en: "Cycle protocol (gRPC-Web → gRPC → SDK)", zh: "切换协议（gRPC-Web → gRPC → SDK）" },
    ],
  },
  {
    category: {
      en: "Navigation",
      zh: "导航",
    },
    items: [
      { keys: "⌘ + F", en: "Search methods / services", zh: "搜索方法和服务" },
      { keys: "⌘ + H", en: "Request history", zh: "请求历史" },
      { keys: "⌘ + O", en: "Open saved requests", zh: "打开已保存请求" },
    ],
  },
  {
    category: {
      en: "Tabs",
      zh: "标签",
    },
    items: [
      { keys: "⌘ + N", en: "New tab", zh: "新建标签" },
      { keys: "⌘ + W", en: "Close tab", zh: "关闭标签" },
      { keys: "⌘ + R", en: "Reset tab (clear method, body, response)", zh: "重置标签（清除方法、body、response）" },
    ],
  },
  {
    category: {
      en: "Packages",
      zh: "包",
    },
    items: [
      { keys: "⌘ + S", en: "Open package installer", zh: "打开 package 安装器" },
    ],
  },
  {
    category: {
      en: "Tools",
      zh: "工具",
    },
    items: [
      { keys: "⌘ + I", en: "Network check & speed test", zh: "网络检查和测速" },
      { keys: "⌘ + Shift + I", en: "Import from cURL", zh: "从 cURL 导入" },
      { keys: "⌘ + /", en: "Keyboard shortcuts", zh: "快捷键表" },
    ],
  },
];

const REPO_OWNER = "shiengng12345";
const REPO_NAME = "penguin";

function getInitialLang() {
  const stored = localStorage.getItem("penguin-site-lang");
  if (stored === "en" || stored === "zh") return stored;
  const browserLang = (navigator.language || "").toLowerCase();
  return browserLang.startsWith("zh") ? "zh" : "en";
}

function renderShortcuts(lang) {
  const root = document.getElementById("shortcutsRoot");
  if (!root) return;

  const categoryLabel = lang === "zh" ? "分类" : "Category";
  const keysLabel = lang === "zh" ? "按键" : "Keys";
  const actionLabel = lang === "zh" ? "功能" : "Action";

  const rows = SHORTCUTS.map((section) => {
    const categoryRow = `
      <tr class="shortcut-category">
        <td colspan="3">${section.category[lang]}</td>
      </tr>
    `;

    const itemRows = section.items
      .map(
        (item) => `
          <tr>
            <td>${section.category[lang]}</td>
            <td><span class="key-pill">${item.keys}</span></td>
            <td>${item[lang]}</td>
          </tr>
        `
      )
      .join("");

    return `${categoryRow}${itemRows}`;
  }).join("");

  root.innerHTML = `
    <div class="table-wrap">
      <table class="shortcut-table" aria-label="Keyboard shortcuts">
        <thead>
          <tr>
            <th>${categoryLabel}</th>
            <th>${keysLabel}</th>
            <th>${actionLabel}</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function setLang(lang) {
  document.documentElement.setAttribute("data-lang", lang);
  localStorage.setItem("penguin-site-lang", lang);

  const toggleText = document.getElementById("langToggleText");
  if (toggleText) {
    toggleText.textContent = lang === "zh" ? "EN" : "中文";
  }

  renderShortcuts(lang);
}

function wireLinks() {
  const repoUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
  const configUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/.pengvi.config.json`;

  const repoLinks = document.querySelectorAll("#repoLink");
  repoLinks.forEach((link) => {
    link.href = repoUrl;
  });

  const configLinks = document.querySelectorAll("#openConfig");
  configLinks.forEach((link) => {
    link.href = configUrl;
  });
}

function init() {
  wireLinks();

  const lang = getInitialLang();
  setLang(lang);

  const toggle = document.getElementById("langToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-lang") || "en";
      setLang(current === "en" ? "zh" : "en");
    });
  }
}

init();
