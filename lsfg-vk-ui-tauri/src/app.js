// SOBERANO LSFG MANAGER - FRONTEND CORE v2.0
// Desenvolvido para o ecossistema Soberano com suporte Multi-GPU e 6 Temas Dinâmicos

const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || (async () => ({}));

// 6 TEMAS OFICIAIS DO IA-SOBERANO-GAMES
const THEMES = [
  { id: "purple-abyss", name: "Purple Abyss", badge: "Soberano", dot: "#a855f7" },
  { id: "cyberpunk-neon", name: "Cyberpunk Neon", badge: "Neon Cyan", dot: "#66fcf1" },
  { id: "emerald-matrix", name: "Emerald Matrix", badge: "Verde Hacker", dot: "#10b981" },
  { id: "crimson-blood", name: "Crimson Blood", badge: "Carmesim", dot: "#ef4444" },
  { id: "sunset-synthwave", name: "Sunset Synthwave", badge: "Retrô 80s", dot: "#ff2a85" },
  { id: "midnight-stealth", name: "Midnight Stealth", badge: "Obsidian", dot: "#f1f5f9" }
];

// ESTADO GLOBAL
let currentConfig = {
  version: 2,
  global: { dll: null, allow_fp16: true, default_gpu: null },
  profile: []
};

let availableGpus = [];
let activeGpuIndex = 0;
let editingProfileIndex = null;
let steamGamesCache = [];
let currentActiveTab = "profiles";

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", async () => {
  initThemeSystem();
  setupTabs();
  setupModal();
  setupBenchmark();
  setupGlobalSettings();
  setupSearch();

  await loadSystemStatus();
  await loadConfig();

  // Polling de telemetria da GPU a cada 4 segundos
  setInterval(loadSystemStatus, 4000);
});

// ==========================================
// SISTEMA DE TEMAS DINÂMICOS
// ==========================================
function initThemeSystem() {
  const savedTheme = localStorage.getItem("soberano_theme") || "purple-abyss";
  applyTheme(savedTheme);

  const menuBtn = document.getElementById("btn-theme-menu");
  const popup = document.getElementById("theme-menu-popup");

  // Preencher opções de temas no popup
  if (popup) {
    popup.innerHTML = THEMES.map(t => `
      <button type="button" class="theme-option-btn ${t.id === savedTheme ? 'active' : ''}" data-theme="${t.id}">
        <span class="theme-option-dot" style="background: ${t.dot}; box-shadow: 0 0 6px ${t.dot};"></span>
        <span>${t.name}</span>
        <span class="theme-badge-sub">${t.badge}</span>
      </button>
    `).join("");

    popup.querySelectorAll(".theme-option-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const themeId = btn.getAttribute("data-theme");
        applyTheme(themeId);
        popup.style.display = "none";
      });
    });
  }

  menuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    popup.style.display = popup.style.display === "none" ? "flex" : "none";
  });

  document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && e.target !== menuBtn) {
      popup.style.display = "none";
    }
  });
}

function applyTheme(themeId) {
  const theme = THEMES.find(t => t.id === themeId) || THEMES[0];
  document.documentElement.setAttribute("data-theme", theme.id);
  localStorage.setItem("soberano_theme", theme.id);

  const dot = document.getElementById("active-theme-dot");
  const name = document.getElementById("active-theme-name");
  if (dot) {
    dot.style.background = theme.dot;
    dot.style.boxShadow = `0 0 8px ${theme.dot}`;
  }
  if (name) name.textContent = theme.name;

  document.querySelectorAll(".theme-option-btn").forEach(btn => {
    if (btn.getAttribute("data-theme") === theme.id) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

// ==========================================
// NAVEGAÇÃO DE ABAS
// ==========================================
function setupTabs() {
  const tabs = document.querySelectorAll(".nav-btn");
  const titleEl = document.getElementById("top-title");
  const subEl = document.getElementById("top-subtitle");
  const topActionBtn = document.getElementById("btn-top-action");
  const topActionText = document.getElementById("top-action-text");
  const searchWrapper = document.getElementById("search-wrapper");

  const tabMeta = {
    profiles: {
      title: "Perfis de Jogos",
      sub: "Gerencie taxas de quadros e multiplicadores para cada título",
      actionText: "Novo Perfil",
      showSearch: true,
      showAction: true
    },
    steam: {
      title: "Biblioteca Steam Integrada",
      sub: "Jogos detectados automaticamente nas suas unidades de disco",
      actionText: "Escanear Steam",
      showSearch: true,
      showAction: true
    },
    benchmark: {
      title: "Benchmark Sintético Real",
      sub: "Mede o throughput de interpolação e latência via Vulkan",
      actionText: "Iniciar Teste",
      showSearch: false,
      showAction: false
    },
    settings: {
      title: "Configurações Globais",
      sub: "Parâmetros do sistema, seleção de GPUs e caminhos",
      actionText: "Salvar",
      showSearch: false,
      showAction: false
    }
  };

  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));

      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      currentActiveTab = tabId;

      const targetPane = document.getElementById(`tab-${tabId}`);
      if (targetPane) targetPane.classList.add("active");

      const meta = tabMeta[tabId] || tabMeta.profiles;
      if (titleEl) titleEl.textContent = meta.title;
      if (subEl) subEl.textContent = meta.sub;
      if (topActionText) topActionText.textContent = meta.actionText;

      if (searchWrapper) {
        searchWrapper.style.display = meta.showSearch ? "block" : "none";
        document.getElementById("search-input").value = "";
      }

      if (topActionBtn) {
        topActionBtn.style.display = meta.showAction ? "inline-flex" : "none";
      }

      if (tabId === "steam" && steamGamesCache.length === 0) {
        scanSteam();
      }
    });
  });

  topActionBtn?.addEventListener("click", () => {
    if (currentActiveTab === "profiles") {
      openNewProfileModal();
    } else if (currentActiveTab === "steam") {
      scanSteam();
    }
  });

  document.getElementById("btn-scan-steam")?.addEventListener("click", scanSteam);
}

// ==========================================
// STATUS DO SISTEMA & TELEMETRIA MULTI-GPU
// ==========================================
async function loadSystemStatus() {
  try {
    const status = await invoke("get_system_status");
    if (!status) return;

    if (status.available_gpus && status.available_gpus.length > 0) {
      const gpusChanged = status.available_gpus.length !== availableGpus.length;
      availableGpus = status.available_gpus;
      if (gpusChanged) {
        populateGpuSelectors();
        renderGpuSwitcher();
      }
    }

    // Telemetria da GPU ativa
    const currentGpu = availableGpus[activeGpuIndex] || availableGpus[0];
    const gpuNameEl = document.getElementById("gpu-name");
    const gpuTypeBadge = document.getElementById("gpu-type-badge");

    if (currentGpu) {
      if (gpuNameEl) gpuNameEl.textContent = cleanGpuName(currentGpu.name);
      if (gpuTypeBadge) {
        gpuTypeBadge.textContent = currentGpu.is_discrete ? "dGPU" : "iGPU";
        gpuTypeBadge.style.color = currentGpu.is_discrete ? "var(--theme-primary)" : "var(--accent-cyan)";
      }
    } else {
      if (gpuNameEl) gpuNameEl.textContent = status.gpu_name;
    }

    document.getElementById("gpu-temp").textContent = status.gpu_temp;
    document.getElementById("gpu-vram").textContent = `${status.gpu_memory_used} / ${status.gpu_memory_total}`;
    document.getElementById("gpu-util").textContent = status.gpu_utilization;

    // Status da Camada Vulkan
    const layerDot = document.getElementById("layer-dot");
    const layerText = document.getElementById("layer-status-text");
    if (status.vulkan_layer_installed) {
      layerDot.style.background = "var(--accent-green)";
      layerDot.style.boxShadow = "0 0 8px var(--accent-green)";
      layerText.textContent = "Vulkan Layer Ativa";
    } else {
      layerDot.style.background = "var(--accent-red)";
      layerDot.style.boxShadow = "0 0 8px var(--accent-red)";
      layerText.textContent = "Layer Não Encontrada";
    }

    // Badge da DLL
    const dllBadge = document.getElementById("dll-status-badge");
    if (dllBadge) {
      if (status.lossless_dll_found) {
        dllBadge.className = "dll-badge ok";
        dllBadge.textContent = "Detectada ✓";
      } else {
        dllBadge.className = "dll-badge danger";
        dllBadge.textContent = "Não encontrada ✗";
      }
    }
  } catch (err) {
    console.error("Falha ao carregar status do sistema:", err);
  }
}

function renderGpuSwitcher() {
  const switcher = document.getElementById("gpu-switcher");
  if (!switcher) return;

  if (availableGpus.length <= 1) {
    switcher.style.display = "none";
    return;
  }

  switcher.style.display = "flex";
  switcher.innerHTML = availableGpus.map((gpu, idx) => `
    <button type="button" class="gpu-switch-btn ${idx === activeGpuIndex ? 'active' : ''}" data-idx="${idx}">
      ${gpu.is_discrete ? '⚡ ' : '🔋 '}${gpu.id}: ${cleanGpuNameShort(gpu.name)}
    </button>
  `).join("");

  switcher.querySelectorAll(".gpu-switch-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      activeGpuIndex = parseInt(btn.getAttribute("data-idx") || "0", 10);
      renderGpuSwitcher();
      loadSystemStatus();
    });
  });
}

function populateGpuSelectors() {
  const modalGpu = document.getElementById("modal-gpu-select");
  const globalGpu = document.getElementById("cfg-default-gpu-select");

  const optionsHtml = [
    `<option value="">⚙️ Automático (Padrão Vulkan / Dispositivo Primário)</option>`
  ];

  availableGpus.forEach(gpu => {
    const icon = gpu.is_discrete ? "⚡ Dedicada" : "🔋 Integrada";
    optionsHtml.push(`<option value="${escapeHtml(gpu.name)}">${icon}: ${escapeHtml(gpu.name)}</option>`);
  });

  if (modalGpu) modalGpu.innerHTML = optionsHtml.join("");
  if (globalGpu) globalGpu.innerHTML = optionsHtml.join("");
}

function cleanGpuName(raw) {
  if (!raw) return "GPU";
  return raw
    .replace(/\(RADV.*?\)/i, "")
    .replace(/16-Core Processor/i, "")
    .replace(/Processor/i, "")
    .trim();
}

function cleanGpuNameShort(raw) {
  if (!raw) return "GPU";
  if (raw.includes("RTX")) return "RTX " + raw.split("RTX")[1].trim();
  if (raw.includes("Radeon")) return "Radeon iGPU";
  if (raw.includes("Ryzen")) return "AMD iGPU";
  if (raw.includes("Intel")) return "Intel GPU";
  return raw.substring(0, 14);
}

// ==========================================
// CARREGAR & RENDERIZAR CONFIGURAÇÃO
// ==========================================
async function loadConfig() {
  try {
    const cfg = await invoke("get_config");
    currentConfig = cfg;

    renderProfiles();

    if (currentConfig.global) {
      const dllInput = document.getElementById("cfg-dll-path");
      if (dllInput) dllInput.value = currentConfig.global.dll || "";

      const fp16Check = document.getElementById("cfg-allow-fp16");
      if (fp16Check) fp16Check.checked = currentConfig.global.allow_fp16 !== false;

      const defaultGpuSelect = document.getElementById("cfg-default-gpu-select");
      if (defaultGpuSelect && currentConfig.global.default_gpu) {
        defaultGpuSelect.value = currentConfig.global.default_gpu;
      }
    }
  } catch (err) {
    showToast("Erro ao carregar configurações: " + err, "danger");
  }
}

function renderProfiles(filterText = "") {
  const container = document.getElementById("profiles-container");
  const countBadge = document.getElementById("profile-count-badge");
  if (!container) return;

  container.innerHTML = "";
  const allProfiles = currentConfig.profile || [];
  if (countBadge) countBadge.textContent = allProfiles.length;

  const query = filterText.toLowerCase().trim();
  const profiles = allProfiles.filter(p => {
    if (!query) return true;
    if (p.name.toLowerCase().includes(query)) return true;
    return (p.active_in || []).some(e => e.toLowerCase().includes(query));
  });

  if (profiles.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; color: var(--text-dim);">
        <p style="font-size: 1.3rem; margin-bottom: 8px; color: var(--text-muted); font-weight: 600;">
          ${query ? 'Nenhum perfil corresponde à sua busca.' : 'Nenhum perfil cadastrado.'}
        </p>
        <p style="font-size: 0.95rem;">
          ${query ? 'Tente outros termos ou limpe a busca.' : 'Clique no botão "+ Novo Perfil" ou vá até a "Biblioteca Steam" para adicionar seus jogos.'}
        </p>
      </div>
    `;
    return;
  }

  profiles.forEach(p => {
    const originalIndex = currentConfig.profile.indexOf(p);
    const card = document.createElement("div");
    card.className = "profile-card";

    const exesTags = (p.active_in || []).map(exe => `<span class="exe-tag">${escapeHtml(exe)}</span>`).join("");
    const isMailbox = p.pacing === "mailbox";
    const limit = p.real_fps_limit || 0;

    let pacingPill = '<span class="pill pill-perf">⚡ UNLOCKED</span>';
    if (isMailbox) pacingPill = '<span class="pill pill-sync">🚀 MAILBOX</span>';
    else if (p.pacing === "none" || p.pacing === "fifo") pacingPill = '<span class="pill pill-sync">🔒 1/2 V-SYNC</span>';

    const limitPill = limit === 0
      ? '<span class="pill pill-max">MAX FPS</span>'
      : `<span class="pill pill-fps">${limit} FPS CAP</span>`;

    // GPU Tag format
    let gpuDisplay = "⚙️ GPU: Auto";
    if (p.gpu) {
      if (p.gpu.includes("NVIDIA") || p.gpu.includes("RTX") || p.gpu.includes("GeForce")) {
        gpuDisplay = `⚡ dGPU: ${cleanGpuNameShort(p.gpu)}`;
      } else if (p.gpu.includes("AMD") || p.gpu.includes("Radeon") || p.gpu.includes("Ryzen")) {
        gpuDisplay = `🔋 iGPU: ${cleanGpuNameShort(p.gpu)}`;
      } else {
        gpuDisplay = `🎮 ${cleanGpuNameShort(p.gpu)}`;
      }
    }

    card.innerHTML = `
      <div class="card-top">
        <div class="card-title-group">
          <h3 class="card-title">${escapeHtml(p.name)}</h3>
          <span class="card-gpu-tag" title="${escapeHtml(p.gpu || 'Automático (Vulkan Default)')}">${escapeHtml(gpuDisplay)}</span>
        </div>
        <div class="card-pills">
          <span class="pill pill-mult">${p.multiplier || 2}x FG</span>
          ${pacingPill}
          ${limitPill}
          ${p.performance_mode ? '<span class="pill pill-perf">PERF</span>' : ''}
        </div>
      </div>

      <div class="card-exes">
        ${exesTags || '<span class="exe-tag">Sem executável associado</span>'}
      </div>

      <div class="card-meta-row">
        <span>Fluxo Óptico: <strong>${Math.round((p.flow_scale || 1.0) * 100)}%</strong></span>
        <span>Sincronia: <strong>${p.pacing || 'unlocked'}</strong></span>
      </div>

      <div class="card-actions">
        <button class="btn-launch" title="Executar com LSFG ativo">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          <span>Disparar</span>
        </button>

        <div class="action-left">
          <button class="icon-btn edit-btn" title="Editar Perfil">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
          <button class="icon-btn danger delete-btn" title="Remover Perfil">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    card.querySelector(".edit-btn").addEventListener("click", () => openEditModal(originalIndex));
    card.querySelector(".delete-btn").addEventListener("click", () => deleteProfile(originalIndex));
    card.querySelector(".btn-launch").addEventListener("click", () => {
      const firstExe = (p.active_in || [])[0];
      if (firstExe) {
        launchGame(firstExe);
      } else {
        showToast("Nenhum executável configurado neste perfil!", "danger");
      }
    });

    container.appendChild(card);
  });
}

// ==========================================
// MODAL DE PERFIL (ESPAÇOSO & MODERNO)
// ==========================================
function setupModal() {
  const modal = document.getElementById("profile-modal");
  const btnClose = document.getElementById("btn-close-modal");
  const btnCancel = document.getElementById("btn-cancel-modal");
  const btnSave = document.getElementById("btn-save-profile-modal");

  const closeModal = () => {
    modal.style.display = "none";
    editingProfileIndex = null;
  };

  btnClose?.addEventListener("click", closeModal);
  btnCancel?.addEventListener("click", closeModal);

  // Seletores de Multiplicador
  document.querySelectorAll("#modal-multiplier-selector .mult-card").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#modal-multiplier-selector .mult-card").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateFpsPreview();
    });
  });

  // Seletores de Pacing
  document.querySelectorAll("#modal-pacing-selector .pacing-card").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#modal-pacing-selector .pacing-card").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      updateFpsPreview();
    });
  });

  // Presets Rápidos de FPS
  document.querySelectorAll(".fps-presets-row .preset-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fps-presets-row .preset-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const fps = btn.getAttribute("data-fps");
      const input = document.getElementById("modal-real-fps-limit");
      if (input) {
        input.value = fps;
        updateFpsLabelAndCalculation(parseInt(fps, 10));
      }
    });
  });

  // Input de Limite de FPS Manual
  const limitInput = document.getElementById("modal-real-fps-limit");
  limitInput?.addEventListener("input", () => {
    const val = parseInt(limitInput.value || "0", 10);
    // Atualizar botões de preset
    document.querySelectorAll(".fps-presets-row .preset-btn").forEach(b => {
      if (b.getAttribute("data-fps") == val) b.classList.add("active");
      else b.classList.remove("active");
    });
    updateFpsLabelAndCalculation(val);
  });

  // Flow Scale Slider
  const flowSlider = document.getElementById("modal-flow-scale");
  flowSlider?.addEventListener("input", (e) => {
    const pct = Math.round(parseFloat(e.target.value) * 100);
    const label = document.getElementById("flow-scale-val");
    if (label) {
      if (pct >= 95) label.textContent = `${pct}% (Máxima Fidelidade)`;
      else if (pct >= 70) label.textContent = `${pct}% (Equilibrado)`;
      else label.textContent = `${pct}% (Mais Leve)`;
    }
  });

  // Botão Salvar Perfil
  btnSave?.addEventListener("click", async () => {
    const name = document.getElementById("modal-profile-name").value.trim();
    if (!name) {
      showToast("Informe o nome do jogo ou perfil!", "danger");
      return;
    }

    const rawExes = document.getElementById("modal-profile-exes").value;
    const active_in = rawExes
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const activeMultBtn = document.querySelector("#modal-multiplier-selector .mult-card.active");
    const multiplier = parseInt(activeMultBtn?.getAttribute("data-val") || "2", 10);
    const flow_scale = parseFloat(document.getElementById("modal-flow-scale").value || "1.0");
    const performance_mode = document.getElementById("modal-performance-mode").checked;
    const activePacingBtn = document.querySelector("#modal-pacing-selector .pacing-card.active");
    const pacing = activePacingBtn?.getAttribute("data-pacing") || "unlocked";
    const rawLimit = parseInt(document.getElementById("modal-real-fps-limit").value || "0", 10);
    const real_fps_limit = isNaN(rawLimit) || rawLimit < 0 ? 0 : rawLimit;

    const selectedGpu = document.getElementById("modal-gpu-select").value || null;

    const newProfile = {
      name,
      active_in,
      gpu: selectedGpu,
      multiplier,
      flow_scale,
      performance_mode,
      pacing,
      real_fps_limit
    };

    if (editingProfileIndex !== null) {
      currentConfig.profile[editingProfileIndex] = newProfile;
    } else {
      currentConfig.profile.push(newProfile);
    }

    await saveCurrentConfig();
    closeModal();
    renderProfiles();
    showToast("Perfil salvo com sucesso!");
  });
}

function openNewProfileModal() {
  editingProfileIndex = null;
  document.getElementById("modal-title").textContent = "Novo Perfil LSFG";
  document.getElementById("modal-profile-name").value = "";
  document.getElementById("modal-profile-exes").value = "";
  document.getElementById("modal-flow-scale").value = "1.0";
  document.getElementById("flow-scale-val").textContent = "100% (Máxima Fidelidade)";
  document.getElementById("modal-performance-mode").checked = false;

  // GPU padrão: respeitar configuração global se existir
  const globalDefaultGpu = currentConfig.global?.default_gpu || "";
  const gpuSelect = document.getElementById("modal-gpu-select");
  if (gpuSelect) gpuSelect.value = globalDefaultGpu;

  setModalMultiplier(2);
  setModalPacing("unlocked");
  setModalFpsPreset(0);

  document.getElementById("profile-modal").style.display = "flex";
}

function openEditModal(idx) {
  editingProfileIndex = idx;
  const p = currentConfig.profile[idx];
  if (!p) return;

  document.getElementById("modal-title").textContent = `Editar: ${p.name}`;
  document.getElementById("modal-profile-name").value = p.name;
  document.getElementById("modal-profile-exes").value = (p.active_in || []).join(", ");
  
  const flow = p.flow_scale || 1.0;
  document.getElementById("modal-flow-scale").value = flow.toString();
  const pct = Math.round(flow * 100);
  document.getElementById("flow-scale-val").textContent = `${pct}% ${pct >= 95 ? '(Máxima Fidelidade)' : '(Equilibrado)'}`;

  document.getElementById("modal-performance-mode").checked = !!p.performance_mode;

  const gpuSelect = document.getElementById("modal-gpu-select");
  if (gpuSelect) gpuSelect.value = p.gpu || "";

  setModalMultiplier(p.multiplier || 2);
  setModalPacing(p.pacing || "unlocked");
  setModalFpsPreset(p.real_fps_limit || 0);

  document.getElementById("profile-modal").style.display = "flex";
}

function setModalMultiplier(val) {
  document.querySelectorAll("#modal-multiplier-selector .mult-card").forEach(btn => {
    if (btn.getAttribute("data-val") == val) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  updateFpsPreview();
}

function setModalPacing(pacing) {
  document.querySelectorAll("#modal-pacing-selector .pacing-card").forEach(btn => {
    if (btn.getAttribute("data-pacing") === pacing) btn.classList.add("active");
    else btn.classList.remove("active");
  });
  updateFpsPreview();
}

function setModalFpsPreset(fps) {
  const input = document.getElementById("modal-real-fps-limit");
  if (input) input.value = fps;

  document.querySelectorAll(".fps-presets-row .preset-btn").forEach(btn => {
    if (btn.getAttribute("data-fps") == fps) btn.classList.add("active");
    else btn.classList.remove("active");
  });

  updateFpsLabelAndCalculation(fps);
}

function updateFpsLabelAndCalculation(fps) {
  const label = document.getElementById("real-fps-limit-val");
  if (!label) return;

  if (isNaN(fps) || fps <= 0) {
    label.textContent = "MÁXIMO (Ilimitado)";
    label.style.color = "var(--accent-cyan)";
  } else {
    label.textContent = `${fps} FPS`;
    label.style.color = "var(--theme-primary)";
  }

  updateFpsPreview();
}

function updateFpsPreview() {
  const formulaEl = document.getElementById("fps-preview-formula");
  const resultEl = document.getElementById("fps-preview-calc");
  if (!formulaEl || !resultEl) return;

  const activeMultBtn = document.querySelector("#modal-multiplier-selector .mult-card.active");
  const mult = parseInt(activeMultBtn?.getAttribute("data-val") || "2", 10);
  const activePacingBtn = document.querySelector("#modal-pacing-selector .pacing-card.active");
  const pacing = activePacingBtn?.getAttribute("data-pacing") || "unlocked";
  const limit = parseInt(document.getElementById("modal-real-fps-limit")?.value || "0", 10);

  if (pacing === "none") {
    formulaEl.textContent = `Metade dos Hz do Monitor (Ex: 82 FPS) × ${mult}x`;
    resultEl.textContent = `${82 * mult} FPS (Trava de V-Sync)`;
    resultEl.style.color = "var(--accent-amber)";
  } else if (isNaN(limit) || limit <= 0) {
    formulaEl.textContent = `FPS Real Nativo (100% da GPU) × ${mult}x`;
    resultEl.textContent = `FLUIDEZ MÁXIMA (+${(mult - 1) * 100}% FPS)`;
    resultEl.style.color = "var(--accent-cyan)";
  } else {
    formulaEl.textContent = `FPS Real Travado (${limit} FPS) × ${mult}x`;
    resultEl.textContent = `${limit * mult} FPS PROJETADO`;
    resultEl.style.color = "var(--theme-primary)";
  }
}

async function deleteProfile(idx) {
  const p = currentConfig.profile[idx];
  if (!p) return;

  if (confirm(`Deseja realmente remover o perfil "${p.name}"?`)) {
    currentConfig.profile.splice(idx, 1);
    await saveCurrentConfig();
    renderProfiles();
    showToast(`Perfil "${p.name}" removido.`);
  }
}

async function saveCurrentConfig() {
  try {
    await invoke("save_config", { config: currentConfig });
  } catch (err) {
    showToast("Erro ao salvar configuração: " + err, "danger");
  }
}

// ==========================================
// BIBLIOTECA STEAM
// ==========================================
async function scanSteam() {
  const container = document.getElementById("steam-container");
  const countEl = document.getElementById("steam-games-count");
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-muted);">
      <p style="font-size: 1.1rem; font-family: var(--font-mono);">Varrendo pastas Steam e montagens de disco...</p>
    </div>
  `;

  try {
    const games = await invoke("scan_steam_games");
    steamGamesCache = games || [];
    if (countEl) countEl.textContent = steamGamesCache.length;
    renderSteamGames();
  } catch (err) {
    container.innerHTML = `<p style="color: var(--accent-red); padding: 20px;">Falha ao escanear Steam: ${err}</p>`;
  }
}

function renderSteamGames(filterText = "") {
  const container = document.getElementById("steam-container");
  if (!container) return;

  container.innerHTML = "";
  const query = filterText.toLowerCase().trim();

  const games = steamGamesCache.filter(g => {
    if (!query) return true;
    if (g.name.toLowerCase().includes(query)) return true;
    return (g.executables || []).some(e => e.toLowerCase().includes(query));
  });

  if (games.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-dim);">
        <p style="font-size: 1.1rem;">Nenhum jogo localizado com esses termos.</p>
      </div>
    `;
    return;
  }

  games.forEach(g => {
    const card = document.createElement("div");
    card.className = "steam-card";

    const isConfigured = (currentConfig.profile || []).some(p =>
      (p.active_in || []).some(pe =>
        (g.executables || []).some(ge => ge.toLowerCase() === pe.toLowerCase())
      )
    );

    const badgeHtml = isConfigured
      ? '<span class="steam-configured-badge">LSFG CONFIGURADO ✓</span>'
      : '<span class="steam-unconfigured-badge">NÃO ATIVADO</span>';

    const exesTags = (g.executables || []).map(e => `<span class="exe-tag">${escapeHtml(e)}</span>`).join("");

    card.innerHTML = `
      <div class="steam-card-header">
        <span class="steam-card-title">${escapeHtml(g.name)}</span>
        ${badgeHtml}
      </div>

      <div class="card-exes">
        ${exesTags || '<span class="exe-tag">Executável padrão</span>'}
      </div>

      <div class="card-actions">
        <button class="btn btn-secondary btn-configure-steam" style="flex: 1;">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          <span>${isConfigured ? 'Ajustar Configuração' : 'Configurar LSFG'}</span>
        </button>
      </div>
    `;

    card.querySelector(".btn-configure-steam").addEventListener("click", () => {
      openModalForSteamGame(g);
    });

    container.appendChild(card);
  });
}

function openModalForSteamGame(game) {
  openNewProfileModal();
  document.getElementById("modal-profile-name").value = game.name;
  document.getElementById("modal-profile-exes").value = (game.executables || []).join(", ");
  document.getElementById("modal-title").textContent = `Configurar LSFG: ${game.name}`;
}

// ==========================================
// BENCHMARK REAL
// ==========================================
function setupBenchmark() {
  const btnRun = document.getElementById("btn-run-bench");
  const resultsCard = document.getElementById("bench-results");

  btnRun?.addEventListener("click", async () => {
    btnRun.disabled = true;
    btnRun.innerHTML = `
      <svg class="spin" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" stroke-dasharray="32" stroke-dashoffset="10"/>
      </svg>
      <span>Medindo Throughput Vulkan (2s)...</span>
    `;

    const mult = parseInt(document.getElementById("bench-multiplier").value, 10);
    const res = document.getElementById("bench-res").value.split("x");
    const width = parseInt(res[0], 10);
    const height = parseInt(res[1], 10);
    const perfMode = document.getElementById("bench-perf-mode").checked;

    try {
      const resData = await invoke("run_benchmark", {
        multiplier: mult,
        performanceMode: perfMode,
        width,
        height
      });

      if (resData.success) {
        document.getElementById("bench-fps-total").textContent = resData.fps_total.toFixed(2);
        document.getElementById("bench-fps-gen").textContent = resData.fps_generated.toFixed(2);
        document.getElementById("bench-frames").textContent = resData.total_frames;
        document.getElementById("bench-iter").textContent = resData.iterations;
        resultsCard.style.display = "block";
      } else {
        showToast("Falha no benchmark: " + (resData.error || "Erro desconhecido"), "danger");
      }
    } catch (err) {
      showToast("Erro ao executar benchmark: " + err, "danger");
    } finally {
      btnRun.disabled = false;
      btnRun.innerHTML = `
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        <span>Executar Benchmark Real (2 Segundos)</span>
      `;
    }
  });
}

// ==========================================
// CONFIGURAÇÕES GLOBAIS
// ==========================================
function setupGlobalSettings() {
  const btnSave = document.getElementById("btn-save-global");
  btnSave?.addEventListener("click", async () => {
    const dll = document.getElementById("cfg-dll-path").value.trim() || null;
    const allow_fp16 = document.getElementById("cfg-allow-fp16").checked;
    const default_gpu = document.getElementById("cfg-default-gpu-select").value || null;

    currentConfig.global = {
      dll,
      allow_fp16,
      default_gpu
    };

    await saveCurrentConfig();
    showToast("Configurações globais salvas com sucesso!");
    await loadSystemStatus();
  });
}

// ==========================================
// BUSCA E FILTROS EM TEMPO REAL
// ==========================================
function setupSearch() {
  const searchInput = document.getElementById("search-input");
  searchInput?.addEventListener("input", (e) => {
    const query = e.target.value;
    if (currentActiveTab === "profiles") {
      renderProfiles(query);
    } else if (currentActiveTab === "steam") {
      renderSteamGames(query);
    }
  });
}

// ==========================================
// DISPARO DE JOGOS & UTILITÁRIOS
// ==========================================
async function launchGame(exe) {
  try {
    const res = await invoke("launch_game", { command: exe });
    showToast(res);
  } catch (err) {
    showToast("Falha ao disparar jogo: " + err, "danger");
  }
}

function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type === "danger" ? "danger" : ""}`;
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
