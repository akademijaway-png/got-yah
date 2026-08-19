(() => {
  const VAULT_KEY = "gotyah-vault-v2";
  const $ = (id) => document.getElementById(id);

  const views = {
    forge: $("view-forge"),
    craft: $("view-craft"),
    ready: $("view-ready"),
    vault: $("view-vault"),
    install: $("view-install"),
    me: $("view-me"),
  };

  let draft = null;
  let forged = null;
  let iconData = "";
  let deferredPrompt = null;

  const loadVault = () => {
    try {
      return JSON.parse(localStorage.getItem(VAULT_KEY) || "[]");
    } catch {
      return [];
    }
  };
  const saveVault = (items) => localStorage.setItem(VAULT_KEY, JSON.stringify(items));

  function show(name) {
    const splash = $("view-splash");
    if (splash) {
      splash.style.display = "none";
    }
    Object.values(views).forEach((el) => el && el.classList.remove("active"));
    if (views[name]) views[name].classList.add("active");
    const nav = $("nav-bar");
    if (nav) nav.style.display = "grid";
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      const on =
        btn.dataset.nav === name ||
        (name === "craft" && btn.dataset.nav === "forge") ||
        (name === "ready" && btn.dataset.nav === "forge");
      btn.classList.toggle("text-lime", on);
      btn.classList.toggle("text-mute", !on);
    });
    if (name === "vault") renderVault();
    if (name === "install") refreshInstallUI();
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }
  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
  }

  function setError(msg) {
    const el = $("forge-error");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.textContent = msg;
    el.classList.remove("hidden");
  }

  async function inspect() {
    setError("");
    const url = ($("url-input") && $("url-input").value.trim()) || "";
    if (!url) {
      setError("Paste a website first.");
      return;
    }
    const btn = $("forge-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "READING SITE…";
    }
    try {
      const res = await fetch("/api/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Inspect failed");
      draft = data;
      iconData = data.icon || "";
      if ($("app-name")) $("app-name").value = data.title || data.host || "Web App";
      if ($("app-short")) $("app-short").value = (data.title || data.host || "App").slice(0, 12);
      if ($("app-theme")) {
        $("app-theme").value = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(data.theme)
          ? data.theme
          : "#050505";
      }
      if ($("craft-host")) $("craft-host").textContent = data.url;
      if ($("craft-icon")) $("craft-icon").src = data.icon || "/static/icons/icon-192.png";
      if ($("craft-frame")) {
        $("craft-frame").textContent = data.frameable
          ? "Can load inside the app window"
          : "Blocks embedding — app will offer Open instead";
        $("craft-frame").className =
          "text-xs mt-1 " + (data.frameable ? "text-lime" : "text-blush");
      }
      if ($("app-icon")) $("app-icon").value = "";
      show("craft");
    } catch (err) {
      setError(err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "FORGE APP";
      }
    }
  }

  async function createApp() {
    if (!draft) return;
    const btn = $("create-btn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "FORGING…";
    }
    try {
      const res = await fetch("/api/forge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: draft.url,
          name: ($("app-name") && $("app-name").value.trim()) || draft.title,
          short_name: ($("app-short") && $("app-short").value.trim()) || "App",
          theme: ($("app-theme") && $("app-theme").value) || "#050505",
          display: ($("app-display") && $("app-display").value) || "standalone",
          frameable: draft.frameable,
          icon: iconData,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Forge failed");
      forged = data;
      const vault = loadVault().filter((x) => x.id !== data.id);
      vault.unshift(data);
      saveVault(vault.slice(0, 40));
      paintReady(data);
      show("ready");
    } catch (err) {
      alert(err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "CREATE APP";
      }
    }
  }

  function paintReady(data) {
    if ($("ready-title")) $("ready-title").textContent = "APP READY";
    if ($("ready-name")) $("ready-name").textContent = data.name;
    if ($("ready-url")) $("ready-url").textContent = data.url;
    if ($("ready-icon")) $("ready-icon").src = data.icon || "/static/icons/icon-192.png";
    if ($("open-app")) $("open-app").href = "/a/" + data.id;
    if ($("download-kit")) $("download-kit").href = "/a/" + data.id + "/download";
    if ($("ios-hint")) $("ios-hint").classList.toggle("hidden", !isIos());
  }

  function renderVault() {
    const items = loadVault();
    const box = $("vault-list");
    if (!box) return;
    if (!items.length) {
      box.innerHTML = `<p class="text-mute text-sm py-8">Nothing forged yet. Paste a URL on Forge.</p>`;
      return;
    }
    box.innerHTML = items
      .map(
        (a) => `<a href="/a/${a.id}" class="rounded-2xl bg-[#101010] border border-white/10 px-4 h-16 flex items-center gap-3">
          <img src="${a.icon}" alt="" class="w-10 h-10 rounded-xl object-cover bg-black" />
          <div class="min-w-0 flex-1">
            <p class="font-semibold truncate">${a.name}</p>
            <p class="text-mute text-xs truncate">${a.url}</p>
          </div>
          <span class="text-lime text-lg">›</span>
        </a>`
      )
      .join("");
  }

  function refreshInstallUI() {
    const btn = $("install-btn");
    if (!btn) return;
    if (isStandalone()) {
      if ($("install-kicker")) $("install-kicker").textContent = "You’re in";
      if ($("install-title")) $("install-title").textContent = "Running as an app";
      if ($("install-copy")) $("install-copy").textContent = "GOT YAH is on your home screen. Forge something.";
      btn.textContent = "OPEN FORGE";
      btn.onclick = () => show("forge");
      return;
    }
    if (deferredPrompt) {
      btn.textContent = "INSTALL GOT YAH";
      btn.onclick = async () => {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        refreshInstallUI();
      };
      return;
    }
    btn.textContent = isIos() ? "USE SHARE → ADD" : "USE BROWSER MENU";
    btn.onclick = () => {};
  }

  function on(id, ev, fn) {
    const el = $(id);
    if (el) el.addEventListener(ev, fn);
  }

  function bind() {
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => show(btn.dataset.nav));
    });
    on("forge-btn", "click", inspect);
    on("url-input", "keydown", (e) => {
      if (e.key === "Enter") inspect();
    });
    on("craft-back", "click", () => show("forge"));
    on("create-btn", "click", createApp);
    on("ready-another", "click", () => {
      if ($("url-input")) $("url-input").value = "";
      show("forge");
    });
    on("install-forged", "click", () => {
      if (forged) window.location.href = "/a/" + forged.id;
    });
    on("app-icon", "change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        iconData = reader.result;
        if ($("craft-icon")) $("craft-icon").src = iconData;
      };
      reader.readAsDataURL(file);
    });
    on("clear-vault", "click", () => {
      if (!confirm("Clear the apps saved on this phone?")) return;
      saveVault([]);
      renderVault();
    });
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
    });
  }

  bind();
  show("forge");
})();
