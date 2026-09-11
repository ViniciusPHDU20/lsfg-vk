// SOBERANO LSFG MANAGER - FRONTEND CORE

const invoke = window.__TAURI__?.core?.invoke || window.__TAURI__?.invoke || (async () => ({}));

// Estado do App
let currentConfig = {
  version: 2,
  global: { dll: "", allow_fp16: true },
  profile: []
};

let editingProfileIndex = null;
let steamGamesCache = [];

// Inicialização
document.addEventListener("DOMContentLoaded", async () => {
  setupTabs();
  setupModal();
  setupBenchmark();
  setupGlobalSettings();
  
  await loadSystemStatus();
  await loadConfig();
  
  // Polling de status a cada 4 segundos
  setInterval(loadSystemStatus, 4000);
});

// NAVEGAÇÃO DE ABAS
function setupTabs() {
  const tabs = document.querySelectorAll(".nav-btn");
  tabs.forEach(btn => {
    btn.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      
      btn.classList.add("active");
      const tabId = btn.getAttribute("data-tab");
      const targetPane = document.getElementById(`tab-${tabId}`);
      if (targetPane) targetPane.classList.add("active");

      if (tabId === "steam" && steamGamesCache.length === 0) {
        scanSteam();
      }
    });
  });

  document.getElementById("btn-scan-steam")?.addEventListener("click", scanSteam);
}

// CARREGAR STATUS DO SISTEMA
async function loadSystemStatus() {
  try {
    const status = await invoke("get_system_status");
    document.getElementById("gpu-name").textContent = status.gpu_name;
    document.getElementById("gpu-temp").textContent = status.gpu_temp;
    document.getElementById("gpu-vram").textContent = `${status.gpu_memory_used} / ${status.gpu_memory_total}`;
    
    const layerDot = document.getElementById("layer-dot");
    const layerText = document.getElementById("layer-status-text");
    if (status.vulkan_layer_installed) {
      layerDot.style.background = "var(--accent-green)";
      layerText.textContent = "Vulkan Layer Ativa";
    } else {
      layerDot.style.background = "var(--accent-red)";
      layerText.textContent = "Layer Não Instalada";
    }

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

// CARREGAR CONFIGURAÇÃO
async function loadConfig() {
  try {
    const cfg = await invoke("get_config");
    currentConfig = cfg;
    
    // Atualizar Aba Perfis
    renderProfiles();
    
    // Atualizar Aba Configurações Globais
    if (currentConfig.global) {
      const dllInput = document.getElementById("cfg-dll-path");
      if (dllInput) dllInput.value = currentConfig.global.dll || "";
      const fp16Check = document.getElementById("cfg-allow-fp16");
      if (fp16Check) fp16Check.checked = currentConfig.global.allow_fp16 !== false;
    }
  } catch (err) {
    showToast("Erro ao carregar configurações: " + err, "danger");
  }
}

// RENDERIZAR PERFIS
function renderProfiles() {
  const container = document.getElementById("profiles-container");
  const countBadge = document.getElementById("profile-count-badge");
  if (!container) return;

  container.innerHTML = "";
  const profiles = currentConfig.profile || [];
  if (countBadge) countBadge.textContent = profiles.length;

  if (profiles.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-dim);">
        <p style="font-size: 1.2rem; margin-bottom: 10px;">Nenhum perfil cadastrado.</p>
        <p style="font-size: 0.9rem;">Clique em "+ Novo Perfil" ou vá até a aba "Biblioteca Steam" para adicionar seus jogos.</p>
      </div>
    `;
    return;
  }

  profiles.forEach((p, idx) => {
    const card = document.createElement("div");
    card.className = "profile-card";

    const exesTags = (p.active_in || []).map(exe => `<span class="exe-tag">${escapeHtml(exe)}</span>`).join("");

    card.innerHTML = `
      <div class="card-top">
        <h3 class="card-title">${escapeHtml(p.name)}</h3>
        <div class="card-pills">
          <span class="pill pill-mult">${p.multiplier || 2}x FG</span>
          ${p.performance_mode ? '<span class="pill pill-perf">PERF</span>' : ''}
        </div>
      </div>

      <div class="card-exes">
        ${exesTags || '<span class="exe-tag">Sem executável</span>'}
      </div>

      <div class="card-controls">
        <span style="font-size: 0.8rem; color: var(--text-dim); font-family: var(--font-mono);">
          Flow: ${Math.round((p.flow_scale || 1.0) * 100)}%
        </span>
        <div class="card-actions">
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

    card.querySelector(".edit-btn").addEventListener("click", () => openEditModal(idx));
    card.querySelector(".delete-btn").addEventListener("click", () => deleteProfile(idx));

    container.appendChild(card);
  });
}

// CONFIGURAÇÃO DO MODAL
function setupModal() {
  const modal = document.getElementById("profile-modal");
  const btnClose = document.getElementById("btn-close-modal");
  const btnCancel = document.getElementById("btn-cancel-modal");
  const btnSave = document.getElementById("btn-save-profile-modal");
  const btnNew = document.getElementById("btn-new-profile");

  const closeModal = () => { modal.style.display = "none"; editingProfileIndex = null; };

  btnClose?.addEventListener("click", closeModal);
  btnCancel?.addEventListener("click", closeModal);

  btnNew?.addEventListener("click", () => {
    editingProfileIndex = null;
    document.getElementById("modal-title").textContent = "Novo Perfil LSFG";
    document.getElementById("modal-profile-name").value = "";
    document.getElementById("modal-profile-exes").value = "";
    document.getElementById("modal-flow-scale").value = "1.0";
    document.getElementById("flow-scale-val").textContent = "100%";
    document.getElementById("modal-performance-mode").checked = false;
    setModalMultiplier(2);
    modal.style.display = "flex";
  });

  // Pill Selector
  document.querySelectorAll("#modal-multiplier-selector .pill-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#modal-multiplier-selector .pill-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });

  // Flow Slider
  const flowSlider = document.getElementById("modal-flow-scale");
  flowSlider?.addEventListener("input", (e) => {
    const pct = Math.round(parseFloat(e.target.value) * 100);
    document.getElementById("flow-scale-val").textContent = `${pct}%`;
  });

  // Salvar Modal
  btnSave?.addEventListener("click", async () => {
    const name = document.getElementById("modal-profile-name").value.trim();
    if (!name) {
      showToast("Informe o nome do perfil!", "danger");
      return;
    }

    const rawExes = document.getElementById("modal-profile-exes").value;
    const active_in = rawExes
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(s => s.length > 0);

    const activeMultBtn = document.querySelector("#modal-multiplier-selector .pill-btn.active");
    const multiplier = parseInt(activeMultBtn?.getAttribute("data-val") || "2", 10);
    const flow_scale = parseFloat(document.getElementById("modal-flow-scale").value || "1.0");
    const performance_mode = document.getElementById("modal-performance-mode").checked;

    const newProfile = {
      name,
      active_in,
      gpu: "NVIDIA GeForce RTX 3060 Ti",
      multiplier,
      flow_scale,
      performance_mode,
      pacing: "none"
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

function setModalMultiplier(val) {
  document.querySelectorAll("#modal-multiplier-selector .pill-btn").forEach(btn => {
    if (btn.getAttribute("data-val") == val) btn.classList.add("active");
    else btn.classList.remove("active");
  });
}

function openEditModal(idx) {
  editingProfileIndex = idx;
  const p = currentConfig.profile[idx];
  if (!p) return;

  document.getElementById("modal-title").textContent = "Editar Perfil: " + p.name;
  document.getElementById("modal-profile-name").value = p.name || "";
  document.getElementById("modal-profile-exes").value = (p.active_in || []).join(", ");
  document.getElementById("modal-flow-scale").value = p.flow_scale || 1.0;
  document.getElementById("flow-scale-val").textContent = `${Math.round((p.flow_scale || 1.0) * 100)}%`;
  document.getElementById("modal-performance-mode").checked = !!p.performance_mode;
  setModalMultiplier(p.multiplier || 2);

  document.getElementById("profile-modal").style.display = "flex";
}

async function deleteProfile(idx) {
  const p = currentConfig.profile[idx];
  if (!p) return;
  if (!confirm(`Deseja remover o perfil "${p.name}"?`)) return;

  currentConfig.profile.splice(idx, 1);
  await saveCurrentConfig();
  renderProfiles();
  showToast("Perfil removido!");
}

// ESCANEAR BIBLIOTECA STEAM
async function scanSteam() {
  const container = document.getElementById("steam-container");
  if (!container) return;

  container.innerHTML = `
    <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--accent-purple);">
      <p style="font-size: 1.2rem; font-family: var(--font-mono);">Escaneando diretórios Steam...</p>
    </div>
  `;

  try {
    const games = await invoke("scan_steam_games");
    steamGamesCache = games;
    container.innerHTML = "";

    if (games.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-dim);">
          <p>Nenhum jogo Steam detectado nas pastas padrão.</p>
        </div>
      `;
      return;
    }

    games.forEach(g => {
      const card = document.createElement("div");
      card.className = "steam-card";

      const mainExe = g.executables && g.executables.length > 0 ? g.executables[0] : "Sem .exe detectado";

      card.innerHTML = `
        <div class="steam-info">
          <span class="steam-name">${escapeHtml(g.name)}</span>
          <span class="steam-exe">${escapeHtml(mainExe)}</span>
        </div>
        <div>
          ${g.is_configured 
            ? '<span class="pill pill-mult">Ativo ✓</span>' 
            : `<button class="btn btn-secondary btn-add-steam" style="padding: 6px 12px; font-size: 0.85rem;">+ Ativar 2x</button>`
          }
        </div>
      `;

      if (!g.is_configured) {
        card.querySelector(".btn-add-steam")?.addEventListener("click", async () => {
          await addSteamGameToLSFG(g);
        });
      }

      container.appendChild(card);
    });
  } catch (err) {
    container.innerHTML = `<p style="color: var(--accent-red); padding: 20px;">Falha ao escanear Steam: ${err}</p>`;
  }
}

async function addSteamGameToLSFG(game) {
  const exes = game.executables && game.executables.length > 0 ? game.executables : [`${game.name}.exe`];
  const newProfile = {
    name: game.name,
    active_in: exes,
    gpu: "NVIDIA GeForce RTX 3060 Ti",
    multiplier: 2,
    flow_scale: 1.0,
    performance_mode: false,
    pacing: "none"
  };

  currentConfig.profile.push(newProfile);
  await saveCurrentConfig();
  showToast(`Jogo "${game.name}" adicionado ao LSFG com 2x!`);
  await scanSteam();
  renderProfiles();
}

// BENCHMARK REAL
function setupBenchmark() {
  const btnRun = document.getElementById("btn-run-bench");
  btnRun?.addEventListener("click", async () => {
    btnRun.disabled = true;
    btnRun.textContent = "Calculando frames na GPU...";

    const multiplier = parseInt(document.getElementById("bench-multiplier").value, 10);
    const perfMode = document.getElementById("bench-perf-mode").checked;
    const res = document.getElementById("bench-res").value.split("x");
    const width = parseInt(res[0], 10);
    const height = parseInt(res[1], 10);

    try {
      const res = await invoke("run_benchmark", {
        multiplier,
        performanceMode: perfMode,
        width,
        height
      });

      if (res.success) {
        document.getElementById("bench-results").style.display = "flex";
        document.getElementById("bench-fps-total").textContent = res.fps_total.toFixed(2);
        document.getElementById("bench-fps-gen").textContent = res.fps_generated.toFixed(2);
        document.getElementById("bench-iter").textContent = res.iterations;
        document.getElementById("bench-frames").textContent = res.total_frames;
        showToast("Benchmark finalizado com sucesso!");
      } else {
        showToast("Erro no benchmark: " + (res.error || "Desconhecido"), "danger");
      }
    } catch (err) {
      showToast("Falha na execução: " + err, "danger");
    } finally {
      btnRun.disabled = false;
      btnRun.textContent = "Iniciar Benchmark (2s)";
    }
  });
}

// CONFIGURAÇÕES GLOBAIS
function setupGlobalSettings() {
  document.getElementById("btn-save-global")?.addEventListener("click", async () => {
    const dll = document.getElementById("cfg-dll-path").value.trim();
    const allow_fp16 = document.getElementById("cfg-allow-fp16").checked;

    currentConfig.global = {
      dll: dll || undefined,
      allow_fp16
    };

    await saveCurrentConfig();
    showToast("Configurações globais salvas!");
    await loadSystemStatus();
  });
}

async function saveCurrentConfig() {
  try {
    await invoke("save_config", { config: currentConfig });
  } catch (err) {
    showToast("Erro ao salvar: " + err, "danger");
  }
}

// UTILITÁRIOS
function showToast(msg, type = "normal") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = "toast";
  if (type === "danger") toast.style.borderColor = "var(--accent-red)";
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
