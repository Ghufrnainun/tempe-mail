/* ============================================================
   tempe-mail — app.js
   Vanilla JS disposable email client
   ============================================================ */

(function () {
  "use strict";

  // =========================================================
  // Constants
  // =========================================================
  const POLL_INTERVAL = 5000;
  const API_BASE = "/api";
  const STORAGE_KEYS = {
    sessionId: "tm_session_id",
    starred: "tm_starred",
    darkMode: "tm_dark_mode",
    language: "tm_lang",
  };

  // =========================================================
  // State
  // =========================================================
  let state = {
    sessionId: null,
    config: null,
    inboxes: [],
    messages: [],
    activeInbox: null,
    activeFilter: "all",
    activeMessage: null,
    isDark: true,
    lang: "en",
    pollingTimer: null,
  };

  // =========================================================
  // i18n
  // =========================================================
  function t(key) {
    const dict =
      state.lang === "id" && window.__tempeI18nID
        ? window.__tempeI18nID
        : window.__tempeI18nEN || {};
    return dict[key] || key;
  }

  // =========================================================
  // DOM Helpers
  // =========================================================
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];
  const el = (tag, attrs, children) => {
    const e = document.createElement(tag);
    if (attrs) {
      Object.entries(attrs).forEach(([k, v]) => {
        if (k === "className") e.className = v;
        else if (k === "innerHTML") e.innerHTML = v;
        else if (k === "textContent") e.textContent = v;
        else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "style" && typeof v === "object")
          Object.assign(e.style, v);
        else if (k === "dataset" && typeof v === "object")
          Object.assign(e.dataset, v);
        else e.setAttribute(k, v);
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null) return;
        e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return e;
  };

  // =========================================================
  // API Client
  // =========================================================
  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (state.sessionId) headers["x-session-id"] = state.sessionId;

    const res = await fetch(`${API_BASE}${path}`, {
      ...opts,
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }

    return res.json();
  }

  // =========================================================
  // Session Management
  // =========================================================
  function loadSessionId() {
    state.sessionId = localStorage.getItem(STORAGE_KEYS.sessionId);
    return state.sessionId;
  }

  async function ensureSession() {
    if (loadSessionId()) return state.sessionId;
    const data = await api("/session", { method: "POST" });
    state.sessionId = data.sessionId;
    localStorage.setItem(STORAGE_KEYS.sessionId, state.sessionId);
    return state.sessionId;
  }

  // =========================================================
  // Config
  // =========================================================
  async function loadConfig() {
    state.config = await api("/config");
  }

  // =========================================================
  // Inbox CRUD
  // =========================================================
  async function loadInboxes() {
    state.inboxes = await api("/inboxes");
  }

  async function createInbox(opts = {}) {
    const result = await api("/inboxes", {
      method: "POST",
      body: opts,
    });
    await loadInboxes();
    return result;
  }

  async function deleteInbox(address) {
    await api(`/inboxes/${encodeURIComponent(address)}`, {
      method: "DELETE",
    });
    await loadInboxes();
  }

  // =========================================================
  // Messages
  // =========================================================
  async function loadMessages(address) {
    state.messages = await api(
      `/inboxes/${encodeURIComponent(address)}/messages`
    );
  }

  // =========================================================
  // OTP Detection
  // =========================================================
  function detectOTP(text) {
    const match = text.match(/\b\d{4,8}\b/);
    return match ? match[0] : null;
  }

  // =========================================================
  // Semantic Tagging
  // =========================================================
  function classifyMessage(msg) {
    const text = `${msg.subject} ${msg.from_name} ${msg.from_address} ${msg.body}`.toLowerCase();

    if (
      /\b(verify|verification|confirm|otp|code|activate|token|2fa|mfa|authenticate)\b/.test(text)
    ) {
      return { tag: "verification", label: t("tagVerification"), css: "tm-tag-chip--verification" };
    }
    if (
      /\b(security|login|password|reset|breach|suspicious|hacked|unauthorized)\b/.test(text)
    ) {
      return { tag: "security", label: t("tagSecurity"), css: "tm-tag-chip--security" };
    }
    if (
      /\b(test|testing|debug|staging|sandbox|dummy|sample|webhook|monitor)\b/.test(text)
    ) {
      return { tag: "testing", label: t("tagTesting"), css: "tm-tag-chip--testing" };
    }
    if (
      /\b(unsubscribe|newsletter|offer|discount|promo|sale|deal|promotion|welcome)\b/.test(text)
    ) {
      return { tag: "marketing", label: t("tagMarketing"), css: "tm-tag-chip--marketing" };
    }

    return null;
  }

  // =========================================================
  // Starred Messages
  // =========================================================
  function getStarred() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEYS.starred) || "[]");
    } catch {
      return [];
    }
  }

  function setStarred(ids) {
    localStorage.setItem(STORAGE_KEYS.starred, JSON.stringify(ids));
  }

  function toggleStar(messageId) {
    const starred = getStarred();
    const idx = starred.indexOf(messageId);
    if (idx >= 0) {
      starred.splice(idx, 1);
    } else {
      starred.push(messageId);
    }
    setStarred(starred);
    return idx < 0;
  }

  function isStarred(messageId) {
    return getStarred().includes(messageId);
  }

  // =========================================================
  // Dark Mode
  // =========================================================
  function loadDarkMode() {
    const stored = localStorage.getItem(STORAGE_KEYS.darkMode);
    if (stored !== null) {
      state.isDark = stored === "true";
    } else {
      state.isDark = !window.matchMedia("(prefers-color-scheme: light)").matches;
    }
    applyTheme();
  }

  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.isDark ? "dark" : "light");
  }

  function toggleDarkMode() {
    state.isDark = !state.isDark;
    localStorage.setItem(STORAGE_KEYS.darkMode, String(state.isDark));
    applyTheme();
    render();
  }

  // =========================================================
  // Language
  // =========================================================
  function loadLanguage() {
    state.lang = localStorage.getItem(STORAGE_KEYS.language) || "en";
  }

  function toggleLanguage() {
    state.lang = state.lang === "en" ? "id" : "en";
    localStorage.setItem(STORAGE_KEYS.language, state.lang);
    render();
  }

  // =========================================================
  // Time formatting
  // =========================================================
  function timeAgo(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);

    if (secs < 60) return t("agoJust");
    if (mins < 60) return `${mins} ${mins === 1 ? t("agoMin") : t("agoMins")}`;
    if (hrs < 24) return `${hrs} ${hrs === 1 ? t("agoHour") : t("agoHours")}`;
    return `${days} ${days === 1 ? t("agoDay") : t("agoDays")}`;
  }

  // Countdown for future timestamps (expires_at). Negative diff => time in future.
  function timeUntil(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return t("expiredNow");
    const secs = Math.floor(diff / 1000);
    const mins = Math.floor(secs / 60);
    const hrs = Math.floor(mins / 60);
    const days = Math.floor(hrs / 24);
    if (days > 0) return `${days}d`;
    if (hrs > 0) return `${hrs}h`;
    if (mins > 0) return `${mins}m`;
    return `${secs}s`;
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1048576).toFixed(1)} MB`;
  }

  // =========================================================
  // Toast notification
  // =========================================================
  function toast(text) {
    const existing = $(".tm-toast");
    if (existing) existing.remove();

    const tEl = el("div", { className: "tm-toast tm-toast--visible" }, text);
    document.body.appendChild(tEl);
    setTimeout(() => {
      tEl.classList.remove("tm-toast--visible");
      setTimeout(() => tEl.remove(), 350);
    }, 2000);
  }

  // =========================================================
  // Copy to clipboard
  // =========================================================
  function copyText(text) {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => toast(t("copied")));
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast(t("copied"));
    }
  }

  // =========================================================
  // Auth Badge
  // =========================================================
  function authBadge(label, value) {
    const cls =
      value === "pass"
        ? "tm-auth-badge--pass"
        : value === "fail"
        ? "tm-auth-badge--fail"
        : "tm-auth-badge--unknown";
    const icon = value === "pass" ? "\u2713" : value === "fail" ? "\u2717" : "?";
    return el("span", { className: `tm-auth-badge ${cls}`, title: `${label}: ${value}` }, `${icon} ${label}`);
  }

  // =========================================================
  // Confirm Dialog
  // =========================================================
  function showConfirm(title, text, onConfirm) {
    const overlay = el("div", { className: "tm-overlay" }, [
      el("div", { className: "tm-modal" }, [
        el("div", { className: "tm-modal-title" }, title),
        el("div", { className: "tm-modal-text" }, text),
        el("div", { className: "tm-modal-actions" }, [
          el("button", { className: "tm-btn tm-btn--ghost", onclick: () => overlay.remove() }, t("cancel")),
          el("button", { className: "tm-btn tm-btn--primary", onclick: async () => { overlay.remove(); await onConfirm(); } }, t("delete")),
        ]),
      ]),
    ]);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });

    document.body.appendChild(overlay);
  }

  // =========================================================
  // RENDER: Main entry point
  // =========================================================
  function render() {
    const root = $("#app-root");
    if (!root) return;

    root.innerHTML = "";

    if (state.activeMessage) {
      if (state.activeInbox) {
        root.appendChild(renderSplitView());
      } else {
        root.appendChild(renderMessageDetail());
      }
    } else if (state.activeInbox) {
      root.appendChild(renderInboxView());
    } else {
      root.appendChild(renderMainView());
    }
  }

  // =========================================================
  // RENDER: Split View (desktop master-detail, list + detail)
  // =========================================================
  function renderSplitView() {
    return el("div", { className: "tm-split" }, [
      el("div", { className: "tm-split-left" }, [renderInboxView()]),
      el("div", { className: "tm-split-right" }, [renderMessageDetail()]),
    ]);
  }

  // =========================================================
  // RENDER: Main View (inbox list + create panel)
  // =========================================================
  function renderMainView() {
    const container = el("div", { className: "tm-app" }, [
      renderHeader(),
      renderCreatePanel(),
      renderInboxList(),
    ]);

    setTimeout(() => bindCreatePanel(container), 0);

    return container;
  }

  function renderHeader() {
    const langLabel = t("language");
    return el("header", { className: "tm-header" }, [
      el("div", { className: "tm-brand" }, [
        el("span", { className: "tm-brand-name" }, t("appName")),
        el("span", { className: "tm-brand-tagline" }, t("tagline")),
      ]),
      el("div", { className: "tm-header-actions" }, [
        el("button", { className: "tm-btn tm-btn--ghost tm-btn--small", onclick: toggleLanguage }, langLabel),
        el("button", {
          className: "tm-btn tm-btn--ghost tm-btn--icon",
          onclick: toggleDarkMode,
          title: state.isDark ? t("lightMode") : t("darkMode"),
        }, state.isDark ? "\u2600" : "\u263E"),
      ]),
    ]);
  }

  function renderCreatePanel() {
    const domains = state.config?.domains || [];
    const tab = state._createTab || "random";

    const randomTab = el("button", {
      className: `tm-create-tab ${tab === "random" ? "tm-create-tab--active" : ""}`,
      dataset: { tab: "random" },
    }, "\u267B " + t("randomAddress"));

    const customTab = el("button", {
      className: `tm-create-tab ${tab === "custom" ? "tm-create-tab--active" : ""}`,
      dataset: { tab: "custom" },
    }, "\u270E " + t("customAddress"));

    const tabs = el("div", { className: "tm-create-tabs" }, [randomTab, customTab]);

    const form = el("div", { className: "tm-create-form" });

    if (tab === "custom") {
      form.appendChild(el("div", { className: "tm-field" }, [
        el("label", { className: "tm-field-label" }, t("localPart")),
        el("input", {
          className: "tm-field-input",
          id: "tm-custom-local",
          type: "text",
          placeholder: t("localPartPlaceholder"),
          maxLength: 32,
        }),
      ]));

      if (domains.length > 1) {
        form.appendChild(el("div", { className: "tm-field" }, [
          el("label", { className: "tm-field-label" }, t("domain")),
          el("select", { className: "tm-field-select", id: "tm-custom-domain" },
            domains.map((d) => el("option", { value: d }, d))
          ),
        ]));
      }

      form.appendChild(el("div", { className: "tm-field" }, [
        el("label", { className: "tm-field-label" }, t("ttlHours")),
        el("select", { className: "tm-field-select", id: "tm-custom-ttl" },
          [1, 6, 12, 24, 48, 72].map((h) =>
            el("option", { value: h }, `${h} ${h === 1 ? t("hour") : t("hours")}`)
          )
        ),
      ]));
    }

    form.appendChild(el("button", {
      className: "tm-btn tm-btn--primary",
      id: "tm-create-btn",
    }, t("createInbox")));

    return el("div", { className: "tm-create-panel", id: "tm-create-panel" }, [tabs, form]);
  }

  function bindCreatePanel(container) {
    const tabs = $$(".tm-create-tab", container);
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        state._createTab = tab.dataset.tab;
        render();
      });
    });

    const btn = $("#tm-create-btn", container);
    if (btn) {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.innerHTML = `<span class="tm-spinner"></span> ${t("creating")}`;

        try {
          if (state._createTab === "custom") {
            const localPart = $("#tm-custom-local", container)?.value?.trim();
            const domain = $("#tm-custom-domain", container)?.value || state.config?.domains?.[0];
            const ttlHours = parseInt($("#tm-custom-ttl", container)?.value || "24");

            if (!localPart) {
              toast(t("Enter a username"));
              btn.disabled = false;
              btn.textContent = t("createInbox");
              return;
            }

            await createInbox({ localPart, domain, ttlHours });
          } else {
            await createInbox();
          }

          render();
        } catch (err) {
          toast(err.message || t("error"));
          btn.disabled = false;
          btn.textContent = t("createInbox");
        }
      });
    }
  }

  function renderInboxList() {
    if (!state.inboxes.length) {
      const cta = el("button", {
        className: "tm-btn tm-btn--primary",
        onclick: () => {
          const panel = $("#tm-create-panel");
          if (panel) {
            panel.scrollIntoView({ behavior: "smooth", block: "center" });
            const input = $("#tm-custom-local");
            if (input) input.focus();
          }
        },
      }, t("createInbox"));

      const tip = el("div", { className: "tm-empty-tip" }, t("emptyTip"));

      return el("div", { className: "tm-empty" }, [
        el("div", { className: "tm-empty-icon" }, "@"),
        el("div", { className: "tm-empty-text" }, t("noInboxes")),
        el("div", { className: "tm-empty-cta" }, [cta]),
        tip,
      ]);
    }

    const list = el("div", { className: "tm-inbox-list", id: "tm-inbox-list" });

    state.inboxes.forEach((inbox) => {
      const item = el("div", {
        className: "tm-inbox-item",
        dataset: { address: inbox.address },
      });

      item.appendChild(el("span", { className: "tm-inbox-address" }, inbox.address));

      if (inbox.expires_at) {
        item.appendChild(el("span", { className: "tm-inbox-meta" }, `${t("expiresAt")} ${timeUntil(inbox.expires_at)}`));
      }

      const actions = el("div", { className: "tm-inbox-actions" }, [
        el("button", {
          className: "tm-btn tm-btn--ghost tm-btn--icon tm-btn--small",
          title: t("copyAddress"),
          dataset: { action: "copy", address: inbox.address },
        }, "\u2398"),
        el("button", {
          className: "tm-btn tm-btn--ghost tm-btn--icon tm-btn--small",
          title: t("delete"),
          dataset: { action: "delete", address: inbox.address },
        }, "\u2715"),
      ]);

      item.appendChild(actions);
      list.appendChild(item);
    });

    list.addEventListener("click", async (e) => {
      const item = e.target.closest(".tm-inbox-item");
      if (!item) return;

      const address = item.dataset.address;
      const actionBtn = e.target.closest("[data-action]");

      if (actionBtn) {
        e.stopPropagation();
        const action = actionBtn.dataset.action;

        if (action === "copy") {
          copyText(actionBtn.dataset.address);
        } else if (action === "delete") {
          showConfirm(t("deleteInbox"), t("deleteConfirm"), async () => {
            await deleteInbox(address);
            render();
          });
        }
        return;
      }

      state.activeInbox = address;
      await loadMessages(address);
      render();
      startPolling();
    });

    return list;
  }

  // =========================================================
  // RENDER: Inbox View (message list)
  // =========================================================
  function renderInboxView() {
    const container = el("div", { className: "tm-app" });
    const address = state.activeInbox;

    // Nav bar
    const nav = el("div", { className: "tm-nav" }, [
      el("button", {
        className: "tm-nav-back",
        onclick: () => {
          state.activeInbox = null;
          state.activeMessage = null;
          state.messages = [];
          stopPolling();
          render();
        },
      }, "\u2190 " + t("back")),
      el("span", {
        className: "tm-nav-title",
        onclick: () => copyText(address),
        title: t("copyAddress"),
        style: { cursor: "pointer" },
      }, address),
      el("span", { className: "tm-polling-dot", title: t("refresh") }),
    ]);

    container.appendChild(nav);

    // Section header + refresh
    container.appendChild(el("div", { className: "tm-section-header" }, [
      el("div", { className: "tm-section-title" }, t("messages")),
      el("button", {
        className: "tm-btn tm-btn--ghost tm-btn--small",
        onclick: async () => { await loadMessages(address); render(); },
      }, "\u21BB " + t("refresh")),
    ]));

    // Filter chips
    const filters = [
      { key: "all", label: t("filterAll") },
      { key: "verification", label: t("filterVerification") },
      { key: "starred", label: t("filterStarred") },
    ];

    const filterRow = el("div", { className: "tm-filters" },
      filters.map((f) =>
        el("button", {
          className: `tm-filter-chip ${state.activeFilter === f.key ? "tm-filter-chip--active" : ""}`,
          dataset: { filter: f.key },
        }, f.label)
      )
    );

    filterRow.addEventListener("click", (e) => {
      const chip = e.target.closest(".tm-filter-chip");
      if (!chip) return;
      state.activeFilter = chip.dataset.filter;
      state.activeMessage = null;
      render();
    });

    container.appendChild(filterRow);

    // Filter messages
    let filtered = state.messages;
    if (state.activeFilter === "starred") {
      const starred = getStarred();
      filtered = filtered.filter((m) => starred.includes(m.id));
    } else if (state.activeFilter === "verification") {
      filtered = filtered.filter((m) => {
        const cls = classifyMessage(m);
        return cls && cls.tag === "verification";
      });
    }

    // Message list
    if (!filtered.length) {
      container.appendChild(el("div", { className: "tm-empty" }, [
        el("div", { className: "tm-empty-icon" }, "\u2709"),
        el("div", { className: "tm-empty-text" }, t("noMessages")),
      ]));
    } else {
      const msgList = el("div", { className: "tm-msg-list" });

      filtered.forEach((msg) => {
        const starred = isStarred(msg.id);
        const tag = classifyMessage(msg);
        const otp = detectOTP(msg.body);
        const previewText = otp ? `OTP: ${otp}` : (msg.body || "").replace(/\s+/g, " ").trim().slice(0, 100);

        const item = el("div", {
          className: `tm-msg-item ${state.activeMessage && state.activeMessage.id === msg.id ? "tm-msg-item--selected" : ""}`,
          dataset: { msgId: msg.id },
        });

        // Star toggle
        item.appendChild(el("button", {
          className: `tm-msg-star ${starred ? "tm-msg-star--active" : ""}`,
          dataset: { action: "star", msgId: msg.id },
          title: starred ? t("unstar") : t("star"),
        }, starred ? "\u2605" : "\u2606"));

        // Content
        const content = el("div", { className: "tm-msg-content" }, [
          el("div", { className: "tm-msg-from" }, msg.from_name || msg.from_address),
          el("div", { className: "tm-msg-subject" }, msg.subject),
          el("div", { className: "tm-msg-preview" }, previewText),
        ]);

        // Tag + attachment indicator
        if (tag || msg.attachments?.length) {
          const tagRow = el("div", { style: { display: "flex", gap: "6px", marginTop: "4px", flexWrap: "wrap" } });
          if (tag) {
            tagRow.appendChild(el("span", { className: `tm-tag-chip ${tag.css}` }, tag.label));
          }
          if (msg.attachments?.length) {
            tagRow.appendChild(el("span", {
              className: "tm-attachment-chip",
              style: { height: "24px", fontSize: "0.65rem" },
            }, `\u2063 ${msg.attachments.length}`));
          }
          content.appendChild(tagRow);
        }

        item.appendChild(content);

        // Time
        item.appendChild(el("span", { className: "tm-msg-time" }, timeAgo(msg.received_at)));

        msgList.appendChild(item);
      });

      // Click delegation for message items
      msgList.addEventListener("click", (e) => {
        const starBtn = e.target.closest("[data-action='star']");
        if (starBtn) {
          e.stopPropagation();
          toggleStar(starBtn.dataset.msgId);
          render();
          return;
        }

        const item = e.target.closest(".tm-msg-item");
        if (!item) return;

        state.activeMessage = state.messages.find((m) => m.id === item.dataset.msgId) || null;
        render();
      });

      container.appendChild(msgList);
    }

    return container;
  }

  // =========================================================
  // RENDER: Message Detail View
  // =========================================================
  function renderMessageDetail() {
    const msg = state.activeMessage;
    if (!msg) {
      state.activeMessage = null;
      return render();
    }

    const container = el("div", { className: "tm-app" });
    const address = state.activeInbox;

    // Nav
    container.appendChild(el("div", { className: "tm-nav" }, [
      el("button", { className: "tm-nav-back", onclick: () => { state.activeMessage = null; render(); } }, "\u2190 " + t("back")),
      el("span", { className: "tm-nav-title" }, address),
    ]));

    // Detail card
    const detail = el("div", { className: "tm-msg-detail" });
    const header = el("div", { className: "tm-msg-detail-header" });

    // From section
    const initial = (msg.from_name || msg.from_address).charAt(0).toUpperCase();
    header.appendChild(el("div", { className: "tm-msg-detail-from" }, [
      el("div", { className: "tm-msg-detail-avatar" }, initial),
      el("div", { className: "tm-msg-detail-from-info" }, [
        el("div", { className: "tm-msg-detail-from-name" }, msg.from_name || msg.from_address),
        el("div", { className: "tm-msg-detail-from-addr" }, msg.from_address),
      ]),
    ]));

    // Subject
    header.appendChild(el("div", { className: "tm-msg-detail-subject" }, msg.subject));

    // Tags + star
    const tagRow = el("div", { className: "tm-msg-detail-tags" });
    const tag = classifyMessage(msg);
    if (tag) {
      tagRow.appendChild(el("span", { className: `tm-tag-chip ${tag.css}` }, tag.label));
    }

    const starred = isStarred(msg.id);
    tagRow.appendChild(el("button", {
      className: `tm-msg-star ${starred ? "tm-msg-star--active" : ""}`,
      dataset: { action: "star", msgId: msg.id },
      title: starred ? t("unstar") : t("star"),
    }, starred ? "\u2605" : "\u2606"));
    header.appendChild(tagRow);

    // Auth badges
    if (msg.spf || msg.dkim || msg.dmarc) {
      header.appendChild(el("div", { className: "tm-auth-badges" }, [
        authBadge(t("spfLabel"), msg.spf),
        authBadge(t("dkimLabel"), msg.dkim),
        authBadge(t("dmarcLabel"), msg.dmarc),
      ]));
    }

    // Time
    header.appendChild(el("div", {
      style: { fontSize: "0.75rem", color: "var(--text-muted)" },
    }, timeAgo(msg.received_at)));

    detail.appendChild(header);

    // Body
    const bodySection = el("div", { className: "tm-msg-detail-body" });
    const otp = detectOTP(msg.body || "");

    if (otp && msg.body) {
      const idx = msg.body.indexOf(otp);
      const before = msg.body.slice(0, idx);
      const after = msg.body.slice(idx + otp.length);

      bodySection.appendChild(el("div", { className: "tm-msg-text" }, before));
      bodySection.appendChild(el("div", { className: "tm-otp-code" }, otp));
      bodySection.appendChild(el("div", { className: "tm-msg-text" }, after));
    } else {
      bodySection.appendChild(el("div", { className: "tm-msg-text" }, msg.body || "(empty body)"));
    }

    // HTML email
    if (msg.body_html) {
      bodySection.appendChild(el("div", {
        style: {
          fontSize: "0.7rem", color: "var(--text-muted)", marginTop: "var(--space-lg)",
          textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600,
        },
      }, t("htmlRendered")));

      const iframe = el("iframe", {
        className: "tm-msg-body-html",
        sandbox: "allow-same-origin",
        srcdoc: msg.body_html,
        title: "HTML email content",
      });
      bodySection.appendChild(iframe);

      iframe.addEventListener("load", () => {
        try {
          const h = iframe.contentDocument?.body?.scrollHeight
            || iframe.contentDocument?.documentElement?.scrollHeight;
          if (h) iframe.style.height = `${Math.min(h + 20, 1200)}px`;
        } catch { /* cross-origin — ignore */ }
      });
    }

    // Attachments
    if (msg.attachments && msg.attachments.length) {
      const attList = el("div", { className: "tm-attachment-list" });
      msg.attachments.forEach((att) => {
        const ext = (att.filename || "").split(".").pop()?.toUpperCase() || "";
        attList.appendChild(el("div", { className: "tm-attachment-chip" }, [
          el("span", { className: "tm-attachment-type" }, ext),
          el("span", { className: "tm-attachment-name" }, att.filename),
          el("span", { className: "tm-attachment-size" }, formatSize(att.size)),
        ]));
      });
      bodySection.appendChild(attList);
    }

    detail.appendChild(bodySection);
    container.appendChild(detail);

    // Star toggle in detail
    container.addEventListener("click", (e) => {
      const starBtn = e.target.closest("[data-action='star']");
      if (starBtn) {
        toggleStar(starBtn.dataset.msgId);
        render();
      }
    });

    return container;
  }

  // =========================================================
  // Polling
  // =========================================================
  function startPolling() {
    stopPolling();
    if (!state.activeInbox) return;

    state.pollingTimer = setInterval(async () => {
      try {
        await loadMessages(state.activeInbox);
        if (!state.activeMessage) {
          render();
        }
      } catch { /* silent */ }
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (state.pollingTimer) {
      clearInterval(state.pollingTimer);
      state.pollingTimer = null;
    }
  }

  // =========================================================
  // Initialization
  // =========================================================
  async function init() {
    loadDarkMode();
    loadLanguage();

    try {
      await ensureSession();
      await loadConfig();
      await loadInboxes();
    } catch (err) {
      console.error("Init error:", err);
    }

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
