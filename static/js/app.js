(() => {
  const KEY = "gotyah-v1";
  const TRAPS = {
    lock: {
      title: "Fake lock",
      copy: "They’ll think your phone locked. Swipe up and — GOT YAH.",
      name: "iPhone",
      note: "Swipe up to unlock",
    },
    call: {
      title: "Incoming call",
      copy: "Full-screen FaceTime. Accept or decline — both trigger the reveal.",
      name: "Mom",
      note: "Mobile",
    },
    chat: {
      title: "Fake chat",
      copy: "A private-looking thread. The reply bar is the bait.",
      name: "Alex",
      note: "Don’t show anyone this",
    },
    bank: {
      title: "Bank alert",
      copy: "Looks urgent. It’s not. View details ends the bit.",
      name: "Unknown device",
      note: "We spotted a transfer that doesn’t look like you.",
    },
    dead: {
      title: "Dead screen",
      copy: "Pure black. After a beat, any tap detonates the reveal.",
      name: "",
      note: "",
    },
  };

  const defaultState = () => ({
    name: "Operator",
    sound: true,
    haptics: true,
    hits: [],
  });

  const load = () => {
    try {
      return { ...defaultState(), ...JSON.parse(localStorage.getItem(KEY) || "{}") };
    } catch {
      return defaultState();
    }
  };

  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  let state = load();
  let currentTrap = "lock";
  let armed = false;
  let deferredPrompt = null;
  let lockX = 0;
  let lockDragging = false;

  const $ = (id) => document.getElementById(id);
  const views = {
    splash: $("view-splash"),
    home: $("view-home"),
    setup: $("view-setup"),
    trap: $("view-trap"),
    reveal: $("view-reveal"),
    hits: $("view-hits"),
    install: $("view-install"),
    me: $("view-me"),
  };

  const hideNavOn = new Set(["splash", "trap", "reveal"]);

  function show(name) {
    Object.values(views).forEach((el) => el.classList.remove("active"));
    views[name].classList.add("active");
    $("nav-bar").style.display = hideNavOn.has(name) ? "none" : "grid";
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      const on = btn.dataset.nav === name || (name === "setup" && btn.dataset.nav === "home");
      btn.classList.toggle("text-lime", on);
      btn.classList.toggle("text-mute", !on);
    });
    if (name === "hits") renderHits();
    if (name === "install") refreshInstallUI();
    if (name === "home") updateHitCount();
  }

  function buzz(pattern = [40, 30, 80]) {
    if (state.haptics && navigator.vibrate) navigator.vibrate(pattern);
  }

  function sting() {
    if (!state.sound) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    const notes = [196, 247, 330, 392];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = i === 3 ? "square" : "sawtooth";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.07);
      gain.gain.exponentialRampToValueAtTime(0.12, now + i * 0.07 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.28);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.07);
      osc.stop(now + i * 0.07 + 0.3);
    });
    setTimeout(() => ctx.close(), 900);
  }

  function updateHitCount() {
    $("hit-count").textContent = state.hits.length;
  }

  function openSetup(id) {
    currentTrap = id;
    const t = TRAPS[id];
    $("setup-title").textContent = t.title;
    $("setup-copy").textContent = t.copy;
    $("setup-name").value = t.name;
    $("setup-note").value = t.note;
    show("setup");
  }

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function tickLock() {
    const now = new Date();
    $("lock-time").textContent = `${now.getHours()}:${pad(now.getMinutes())}`;
    $("lock-date").textContent = now.toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  }

  function arm() {
    const name = ($("setup-name").value || "Unknown").trim();
    const note = ($("setup-note").value || "").trim();
    armed = true;
    buzz([20]);
    ["trap-lock", "trap-call", "trap-chat", "trap-bank", "trap-dead"].forEach((id) => {
      $(id).classList.add("hidden");
    });
    if (currentTrap === "lock") {
      $("trap-lock").classList.remove("hidden");
      tickLock();
      resetKnob();
    } else if (currentTrap === "call") {
      $("trap-call").classList.remove("hidden");
      $("call-name").textContent = name;
      $("call-initial").textContent = name.slice(0, 1).toUpperCase();
      $("call-note").textContent = note;
    } else if (currentTrap === "chat") {
      $("trap-chat").classList.remove("hidden");
      $("chat-name").textContent = name;
      $("chat-initial").textContent = name.slice(0, 1).toUpperCase();
      $("chat-bubble").textContent = note || "I need to tell you something.";
      $("chat-hook").textContent = "Open this. Right now.";
    } else if (currentTrap === "bank") {
      $("trap-bank").classList.remove("hidden");
      $("bank-name").textContent = name;
      $("bank-copy").textContent = note || TRAPS.bank.note;
    } else {
      $("trap-dead").classList.remove("hidden");
      $("trap-dead").dataset.ready = "0";
      setTimeout(() => {
        $("trap-dead").dataset.ready = "1";
      }, 900);
    }
    show("trap");
  }

  function abortTrap() {
    if (!armed) return;
    armed = false;
    show("home");
  }

  function confetti() {
    const canvas = $("reveal-canvas");
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const bits = Array.from({ length: 90 }, () => ({
      x: Math.random() * w,
      y: -20 - Math.random() * h,
      r: 3 + Math.random() * 5,
      vy: 3 + Math.random() * 6,
      vx: -2 + Math.random() * 4,
      rot: Math.random() * Math.PI,
      vr: -0.2 + Math.random() * 0.4,
      color: Math.random() > 0.5 ? "#050505" : "#FF3D8A",
    }));
    let frames = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);
      bits.forEach((b) => {
        b.x += b.vx;
        b.y += b.vy;
        b.rot += b.vr;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        ctx.fillRect(-b.r, -b.r / 2, b.r * 2, b.r);
        ctx.restore();
      });
      frames += 1;
      if (frames < 90) requestAnimationFrame(draw);
    };
    draw();
  }

  function reveal() {
    if (!armed && currentTrap !== "dead") {
      /* still allow */
    }
    armed = false;
    state.hits.unshift({
      id: Date.now(),
      trap: currentTrap,
      label: TRAPS[currentTrap].title,
      at: new Date().toISOString(),
    });
    save();
    updateHitCount();
    $("reveal-sub").textContent = `${state.name} got you with ${TRAPS[currentTrap].title.toLowerCase()}`;
    const flash = $("flash-layer");
    flash.classList.remove("anim-flash");
    void flash.offsetWidth;
    flash.classList.add("anim-flash");
    show("reveal");
    buzz([80, 40, 80, 40, 220]);
    sting();
    confetti();
  }

  function renderHits() {
    $("hits-big").textContent = state.hits.length;
    const last = state.hits[0];
    $("hits-streak").textContent = last
      ? `Last hit · ${TRAPS[last.trap]?.title || last.label}`
      : "No streak yet. Arm a trap.";
    const list = $("hits-list");
    if (!state.hits.length) {
      list.innerHTML = `<p class="text-mute text-sm py-6">Nothing yet. First one’s free.</p>`;
      return;
    }
    list.innerHTML = state.hits
      .slice(0, 40)
      .map((h) => {
        const when = new Date(h.at);
        const stamp = when.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
        return `<div class="rounded-2xl bg-[#101010] border border-white/10 px-4 h-16 flex items-center justify-between">
          <div>
            <p class="font-semibold">${h.label}</p>
            <p class="text-mute text-xs">${stamp}</p>
          </div>
          <span class="text-lime font-display text-2xl">GY</span>
        </div>`;
      })
      .join("");
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

  function refreshInstallUI() {
    const btn = $("install-btn");
    if (isStandalone()) {
      $("install-kicker").textContent = "You’re in";
      $("install-title").textContent = "Running as an app";
      $("install-copy").textContent = "GOT YAH is installed. Full screen. No browser chrome. Go get someone.";
      btn.textContent = "OPEN TRAPS";
      btn.onclick = () => show("home");
      return;
    }
    if (deferredPrompt) {
      $("install-kicker").textContent = "One tap";
      $("install-title").textContent = "Install GOT YAH";
      $("install-copy").textContent = "Adds an icon to your home screen and opens full screen.";
      btn.textContent = "INSTALL GOT YAH";
      btn.onclick = async () => {
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice.outcome === "accepted") buzz([30, 20, 40]);
        deferredPrompt = null;
        refreshInstallUI();
      };
      return;
    }
    if (isIos()) {
      $("install-kicker").textContent = "Safari only";
      $("install-title").textContent = "Add to Home Screen";
      $("install-copy").textContent = "iPhone doesn’t show an install banner. Use Share → Add to Home Screen.";
      btn.textContent = "SHOW STEPS";
      btn.onclick = () => document.querySelector("#view-install .scroll-pane").scrollTo({ top: 280, behavior: "smooth" });
      return;
    }
    $("install-kicker").textContent = "Almost";
    $("install-title").textContent = "Use the browser menu";
    $("install-copy").textContent = "Open the browser menu and tap Install app or Add to Home screen.";
    btn.textContent = "GOT IT";
    btn.onclick = () => show("home");
  }

  function resetKnob() {
    const knob = $("lock-knob");
    knob.style.transform = "translateX(0px)";
    lockX = 0;
  }

  function bindLock() {
    const track = $("lock-track");
    const knob = $("lock-knob");
    const max = () => track.clientWidth - knob.clientWidth - 8;

    const start = (x) => {
      lockDragging = true;
      lockX = x;
    };
    const move = (x) => {
      if (!lockDragging) return;
      const dx = Math.max(0, Math.min(max(), x - lockX + 0));
      // use client offset from track
    };

    const onPointerDown = (e) => {
      e.preventDefault();
      const rect = track.getBoundingClientRect();
      lockDragging = true;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      lockX = clientX - rect.left - knob.offsetWidth / 2;
      knob.style.transform = `translateX(${Math.max(0, Math.min(max(), lockX))}px)`;
    };
    const onPointerMove = (e) => {
      if (!lockDragging) return;
      const rect = track.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const x = Math.max(0, Math.min(max(), clientX - rect.left - knob.offsetWidth / 2));
      knob.style.transform = `translateX(${x}px)`;
      if (x > max() * 0.72) {
        lockDragging = false;
        reveal();
      }
    };
    const onPointerUp = () => {
      if (!lockDragging) return;
      lockDragging = false;
      resetKnob();
    };

    track.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    track.addEventListener("touchstart", onPointerDown, { passive: false });
    window.addEventListener("touchmove", onPointerMove, { passive: true });
    window.addEventListener("touchend", onPointerUp);
  }

  function bind() {
    document.querySelectorAll("[data-trap]").forEach((btn) => {
      btn.addEventListener("click", () => openSetup(btn.dataset.trap));
    });
    document.querySelectorAll("[data-nav]").forEach((btn) => {
      btn.addEventListener("click", () => show(btn.dataset.nav));
    });
    $("setup-back").addEventListener("click", () => show("home"));
    $("arm-btn").addEventListener("click", arm);
    $("home-hits-pill").addEventListener("click", () => show("hits"));
    $("reveal-again").addEventListener("click", () => openSetup(currentTrap));
    $("reveal-home").addEventListener("click", () => show("home"));
    $("abort-hotspot").addEventListener("click", abortTrap);
    let abortTimer = null;
    $("abort-hotspot").addEventListener("pointerdown", () => {
      abortTimer = setTimeout(abortTrap, 450);
    });
    $("abort-hotspot").addEventListener("pointerup", () => clearTimeout(abortTimer));

    document.querySelectorAll("[data-reveal]").forEach((el) => {
      el.addEventListener("click", () => {
        if (el.id === "trap-dead" && el.dataset.ready !== "1") return;
        reveal();
      });
    });

    $("me-name").value = state.name;
    $("me-sound").checked = state.sound;
    $("me-haptics").checked = state.haptics;
    $("me-name").addEventListener("input", (e) => {
      state.name = e.target.value.slice(0, 20) || "Operator";
      save();
    });
    $("me-sound").addEventListener("change", (e) => {
      state.sound = e.target.checked;
      save();
    });
    $("me-haptics").addEventListener("change", (e) => {
      state.haptics = e.target.checked;
      save();
    });
    $("clear-hits").addEventListener("click", () => {
      if (!confirm("Wipe every hit?")) return;
      state.hits = [];
      save();
      updateHitCount();
      renderHits();
    });

    bindLock();
    setInterval(() => {
      if (!views.trap.classList.contains("active")) return;
      if (!$("trap-lock").classList.contains("hidden")) tickLock();
    }, 10000);

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredPrompt = e;
      refreshInstallUI();
    });
    window.addEventListener("appinstalled", () => {
      deferredPrompt = null;
      refreshInstallUI();
    });

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    }
  }

  bind();
  updateHitCount();
  setTimeout(() => show(isStandalone() ? "home" : "home"), 1400);
})();
