use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ConfigFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub global: GlobalConfig,
    #[serde(default)]
    pub profile: Vec<ProfileConfig>,
}

fn default_version() -> u32 {
    2
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct GlobalConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dll: Option<String>,
    #[serde(default = "default_true")]
    pub allow_fp16: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_gpu: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfileConfig {
    pub name: String,
    #[serde(deserialize_with = "deserialize_active_in")]
    pub active_in: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gpu: Option<String>,
    #[serde(default = "default_multiplier")]
    pub multiplier: u32,
    #[serde(default = "default_flow_scale")]
    pub flow_scale: f32,
    #[serde(default)]
    pub performance_mode: bool,
    #[serde(default = "default_pacing")]
    pub pacing: String,
    #[serde(default)]
    pub real_fps_limit: u32,
}

fn default_multiplier() -> u32 {
    2
}
fn default_flow_scale() -> f32 {
    1.0
}
fn default_pacing() -> String {
    "none".to_string()
}

fn deserialize_active_in<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum StringOrVec {
        Single(String),
        Multiple(Vec<String>),
    }

    match StringOrVec::deserialize(deserializer)? {
        StringOrVec::Single(s) => Ok(vec![s]),
        StringOrVec::Multiple(v) => Ok(v),
    }
}

fn get_home_dir() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn get_config_path() -> PathBuf {
    get_home_dir().join(".config/lsfg-vk/conf.toml")
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GpuDevice {
    pub id: String,
    pub name: String,
    pub device_type: String,
    pub driver_info: String,
    pub is_discrete: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SystemStatus {
    pub gpu_name: String,
    pub gpu_temp: String,
    pub gpu_memory_total: String,
    pub gpu_memory_used: String,
    pub gpu_utilization: String,
    pub driver_version: String,
    pub vulkan_layer_installed: bool,
    pub lossless_dll_found: bool,
    pub lossless_dll_path: String,
    pub available_gpus: Vec<GpuDevice>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SteamGame {
    pub appid: String,
    pub name: String,
    pub path: String,
    pub executables: Vec<String>,
    pub is_configured: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BenchmarkResult {
    pub success: bool,
    pub error: Option<String>,
    pub iterations: u32,
    pub generated_frames: u32,
    pub total_frames: u32,
    pub fps_generated: f32,
    pub fps_total: f32,
}

fn find_steam_libraries() -> Vec<PathBuf> {
    let home = get_home_dir();
    let mut libraries = Vec::new();

    let default_roots = [
        home.join(".local/share/Steam"),
        home.join(".steam/steam"),
        home.join(".steam/root"),
        home.join(".var/app/com.valvesoftware.Steam/data/Steam"),
    ];

    for root in &default_roots {
        let steamapps = root.join("steamapps");
        if steamapps.exists() && !libraries.contains(&steamapps) {
            libraries.push(steamapps.clone());
        }

        let vdf_path = steamapps.join("libraryfolders.vdf");
        if let Ok(content) = fs::read_to_string(&vdf_path) {
            for line in content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("\"path\"") {
                    let parts: Vec<&str> = trimmed.split('"').collect();
                    if parts.len() >= 4 {
                        let extra_steamapps = PathBuf::from(parts[3]).join("steamapps");
                        if extra_steamapps.exists() && !libraries.contains(&extra_steamapps) {
                            libraries.push(extra_steamapps);
                        }
                    }
                }
            }
        }
    }

    libraries
}

fn find_default_lossless_dll() -> Option<PathBuf> {
    let home = get_home_dir();
    let fragments = [
        ".local/share/Steam/steamapps/common/Lossless Scaling/Lossless.dll",
        ".steam/steam/steamapps/common/Lossless Scaling/Lossless.dll",
        ".steam/debian-installation/steamapps/common/Lossless Scaling/Lossless.dll",
        ".var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/Lossless Scaling/Lossless.dll",
        "snap/steam/common/.local/share/Steam/steamapps/common/Lossless Scaling/Lossless.dll",
    ];

    for frag in &fragments {
        let candidate = home.join(frag);
        if candidate.exists() {
            return Some(candidate);
        }
    }

    for lib in find_steam_libraries() {
        let candidate = lib.join("common/Lossless Scaling/Lossless.dll");
        if candidate.exists() {
            return Some(candidate);
        }
    }

    let local = PathBuf::from("Lossless.dll");
    if local.exists() {
        return Some(local);
    }

    None
}

#[tauri::command]
fn detect_system_gpus() -> Vec<GpuDevice> {
    let mut gpus = Vec::new();

    if let Ok(output) = Command::new("vulkaninfo").arg("--summary").output() {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let mut current_id = String::new();
            let mut current_name = String::new();
            let mut current_type = "Unknown".to_string();
            let mut current_driver = String::new();
            let mut is_discrete = false;
            let mut in_devices = false;

            for line in out_str.lines() {
                let trimmed = line.trim();
                if trimmed == "Devices:" {
                    in_devices = true;
                    continue;
                }
                if !in_devices {
                    continue;
                }

                if trimmed.starts_with("GPU") && trimmed.contains(':') {
                    if !current_name.is_empty() {
                        gpus.push(GpuDevice {
                            id: current_id,
                            name: current_name,
                            device_type: current_type,
                            driver_info: current_driver,
                            is_discrete,
                        });
                    }
                    current_id = trimmed.trim_end_matches(':').to_string();
                    current_name = String::new();
                    current_type = "Unknown".to_string();
                    current_driver = String::new();
                    is_discrete = false;
                } else if trimmed.starts_with("deviceName") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        current_name = val.trim().to_string();
                    }
                } else if trimmed.starts_with("deviceType") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        let t = val.trim();
                        if t.contains("INTEGRATED") {
                            current_type = "Integrated".to_string();
                            is_discrete = false;
                        } else if t.contains("DISCRETE") {
                            current_type = "Discrete".to_string();
                            is_discrete = true;
                        } else if t.contains("CPU") {
                            current_type = "CPU".to_string();
                            is_discrete = false;
                        } else if t.contains("VIRTUAL") {
                            current_type = "Virtual".to_string();
                            is_discrete = false;
                        } else {
                            current_type = t.to_string();
                        }
                    }
                } else if trimmed.starts_with("driverInfo") {
                    if let Some(val) = trimmed.split('=').nth(1) {
                        current_driver = val.trim().to_string();
                    }
                }
            }

            if !current_name.is_empty() {
                gpus.push(GpuDevice {
                    id: current_id,
                    name: current_name,
                    device_type: current_type,
                    driver_info: current_driver,
                    is_discrete,
                });
            }
        }
    }

    if gpus.is_empty() {
        if let Ok(output) = Command::new("nvidia-smi")
            .args(["--query-gpu=name,driver_version", "--format=csv,noheader"])
            .output()
        {
            if output.status.success() {
                let out = String::from_utf8_lossy(&output.stdout);
                for (idx, line) in out.lines().enumerate() {
                    let parts: Vec<&str> = line.split(',').map(|s| s.trim()).collect();
                    if !parts.is_empty() && !parts[0].is_empty() {
                        gpus.push(GpuDevice {
                            id: format!("GPU{}", idx),
                            name: parts[0].to_string(),
                            device_type: "Discrete".to_string(),
                            driver_info: parts.get(1).unwrap_or(&"").to_string(),
                            is_discrete: true,
                        });
                    }
                }
            }
        }
    }

    gpus
}

#[tauri::command]
fn get_config() -> Result<ConfigFile, String> {
    let path = get_config_path();
    if !path.exists() {
        let detected_dll = find_default_lossless_dll()
            .map(|p| p.to_string_lossy().to_string());

        return Ok(ConfigFile {
            version: 2,
            global: GlobalConfig {
                dll: detected_dll,
                allow_fp16: true,
                default_gpu: None,
            },
            profile: Vec::new(),
        });
    }

    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Erro ao ler arquivo de configuração: {}", e))?;

    toml::from_str::<ConfigFile>(&content)
        .map_err(|e| format!("Erro ao processar TOML: {}", e))
}

#[tauri::command]
fn save_config(config: ConfigFile) -> Result<String, String> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let toml_str = toml::to_string_pretty(&config)
        .map_err(|e| format!("Erro ao serializar TOML: {}", e))?;

    fs::write(&path, toml_str)
        .map_err(|e| format!("Erro ao salvar arquivo de configuração: {}", e))?;

    Ok("Configuração salva com sucesso!".to_string())
}

#[tauri::command]
fn get_system_status() -> SystemStatus {
    let available_gpus = detect_system_gpus();
    let primary_gpu = available_gpus.iter().find(|g| g.is_discrete).or_else(|| available_gpus.first());

    let mut gpu_name = primary_gpu.map(|g| g.name.clone()).unwrap_or_else(|| "GPU não detectada".to_string());
    let mut gpu_temp = "N/A".to_string();
    let mut gpu_memory_total = "N/A".to_string();
    let mut gpu_memory_used = "0 MB".to_string();
    let mut gpu_utilization = "0%".to_string();
    let mut driver_version = primary_gpu.map(|g| g.driver_info.clone()).unwrap_or_default();

    if let Ok(output) = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,temperature.gpu,memory.total,memory.used,utilization.gpu,driver_version",
            "--format=csv,noheader,nounits",
        ])
        .output()
    {
        if output.status.success() {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let parts: Vec<&str> = out_str.trim().split(',').map(|s| s.trim()).collect();
            if parts.len() >= 6 {
                gpu_name = parts[0].to_string();
                gpu_temp = format!("{} °C", parts[1]);
                gpu_memory_total = format!("{} MB", parts[2]);
                gpu_memory_used = format!("{} MB", parts[3]);
                gpu_utilization = format!("{}%", parts[4]);
                driver_version = parts[5].to_string();
            }
        }
    }

    let vulkan_layer_installed = Path::new("/usr/lib/liblsfg-vk-layer.so").exists()
        && Path::new("/usr/share/vulkan/implicit_layer.d/VkLayer_LSFGVK_frame_generation.json").exists();

    let dll_candidate = find_default_lossless_dll();
    let lossless_dll_found = dll_candidate.is_some();
    let lossless_dll_path = dll_candidate
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|| "Não encontrada".to_string());

    SystemStatus {
        gpu_name,
        gpu_temp,
        gpu_memory_total,
        gpu_memory_used,
        gpu_utilization,
        driver_version,
        vulkan_layer_installed,
        lossless_dll_found,
        lossless_dll_path,
        available_gpus,
    }
}

#[tauri::command]
fn scan_steam_games() -> Vec<SteamGame> {
    let mut games = Vec::new();
    let library_folders = find_steam_libraries();

    let current_conf = get_config().ok();
    let configured_exes: Vec<String> = current_conf
        .map(|c| {
            c.profile
                .into_iter()
                .flat_map(|p| p.active_in)
                .map(|e| e.to_lowercase())
                .collect()
        })
        .unwrap_or_default();

    for steamapps in &library_folders {
        if !steamapps.exists() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(steamapps) {
            for entry in entries.flatten() {
                let p = entry.path();
                if let Some(file_name) = p.file_name().and_then(|n| n.to_str()) {
                    if file_name.starts_with("appmanifest_") && file_name.ends_with(".acf") {
                        if let Ok(content) = fs::read_to_string(&p) {
                            let appid = extract_vdf_field(&content, "appid").unwrap_or_default();
                            let name = extract_vdf_field(&content, "name").unwrap_or_default();
                            let installdir = extract_vdf_field(&content, "installdir").unwrap_or_default();

                            if !name.is_empty()
                                && !installdir.is_empty()
                                && name != "Lossless Scaling"
                                && name != "Proton Hotfix"
                                && name != "Proton Experimental"
                            {
                                let common_dir = steamapps.join("common").join(&installdir);
                                if common_dir.exists() {
                                    let mut exes = Vec::new();
                                    find_executables(&common_dir, &mut exes, 3);

                                    let is_configured = exes.iter().any(|e| {
                                        configured_exes.contains(&e.to_lowercase())
                                    });

                                    games.push(SteamGame {
                                        appid,
                                        name,
                                        path: common_dir.to_string_lossy().to_string(),
                                        executables: exes,
                                        is_configured,
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    games.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    games
}

fn extract_vdf_field(content: &str, field: &str) -> Option<String> {
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with(&format!("\"{}\"", field)) {
            let parts: Vec<&str> = trimmed.split('"').collect();
            if parts.len() >= 4 {
                return Some(parts[3].to_string());
            }
        }
    }
    None
}

fn find_executables(dir: &Path, exes: &mut Vec<String>, depth: usize) {
    if depth == 0 {
        return;
    }
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.is_dir() {
                find_executables(&p, exes, depth - 1);
            } else if p.is_file() {
                if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
                    if ext.eq_ignore_ascii_case("exe") {
                        if let Some(name) = p.file_name().and_then(|n| n.to_str()) {
                            let name_lower = name.to_lowercase();
                            if !name_lower.contains("unitycrashhandler")
                                && !name_lower.contains("unins")
                                && !name_lower.contains("setup")
                                && !name_lower.contains("dxsetup")
                                && !name_lower.contains("vcredist")
                            {
                                if !exes.contains(&name.to_string()) {
                                    exes.push(name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[tauri::command]
async fn run_benchmark(
    multiplier: u32,
    performance_mode: bool,
    width: u32,
    height: u32,
) -> BenchmarkResult {
    let dll_candidate = find_default_lossless_dll();
    let dll_path = match dll_candidate {
        Some(p) => p.to_string_lossy().to_string(),
        None => "Lossless.dll".to_string(),
    };

    let mut args = vec![
        "benchmark".to_string(),
        "-d".to_string(),
        dll_path,
        "-w".to_string(),
        width.to_string(),
        "-h".to_string(),
        height.to_string(),
        "-m".to_string(),
        multiplier.to_string(),
        "-a".to_string(),
        "-t".to_string(),
        "2".to_string(),
    ];

    if performance_mode {
        args.push("-p".to_string());
    }

    match Command::new("lsfg-vk-cli").args(&args).output() {
        Ok(output) => {
            let out_str = String::from_utf8_lossy(&output.stdout);
            let mut iterations = 0;
            let mut generated_frames = 0;
            let mut total_frames = 0;
            let mut fps_generated = 0.0;
            let mut fps_total = 0.0;

            for line in out_str.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("iterations:") {
                    iterations = trimmed
                        .split(':')
                        .nth(1)
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                } else if trimmed.starts_with("generated frames:") {
                    generated_frames = trimmed
                        .split(':')
                        .nth(1)
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                } else if trimmed.starts_with("total frames:") {
                    total_frames = trimmed
                        .split(':')
                        .nth(1)
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                } else if trimmed.starts_with("fps (generated):") {
                    let part = trimmed.split(':').nth(1).unwrap_or("").replace("fps", "");
                    fps_generated = part.trim().parse().unwrap_or(0.0);
                } else if trimmed.starts_with("fps (total):") {
                    let part = trimmed.split(':').nth(1).unwrap_or("").replace("fps", "");
                    fps_total = part.trim().parse().unwrap_or(0.0);
                }
            }

            BenchmarkResult {
                success: true,
                error: None,
                iterations,
                generated_frames,
                total_frames,
                fps_generated,
                fps_total,
            }
        }
        Err(e) => BenchmarkResult {
            success: false,
            error: Some(format!("Falha ao executar lsfg-vk-cli: {}", e)),
            iterations: 0,
            generated_frames: 0,
            total_frames: 0,
            fps_generated: 0.0,
            fps_total: 0.0,
        },
    }
}

#[tauri::command]
fn launch_game(target: String) -> Result<String, String> {
    let target = target.trim();
    if target.is_empty() {
        return Err("Nenhum executável ou ID de jogo informado".to_string());
    }

    // 1. Se for um AppID numérico direto da Steam (ex: "4001890")
    if target.chars().all(|c| c.is_ascii_digit()) {
        Command::new("xdg-open")
            .arg(format!("steam://rungameid/{}", target))
            .spawn()
            .map_err(|e| format!("Falha ao invocar Steam: {}", e))?;

        return Ok(format!("Disparando jogo Steam (AppID: {}) com LSFG ativo", target));
    }

    // 2. Se for um executável, verificar se pertence a algum jogo Steam instalado
    let steam_games = scan_steam_games();
    if let Some(game) = steam_games.iter().find(|g| {
        g.executables
            .iter()
            .any(|e| e.eq_ignore_ascii_case(target))
    }) {
        Command::new("xdg-open")
            .arg(format!("steam://rungameid/{}", game.appid))
            .spawn()
            .map_err(|e| format!("Falha ao invocar Steam: {}", e))?;

        return Ok(format!(
            "Disparando '{}' via Steam (AppID: {}) com LSFG ativo",
            game.name, game.appid
        ));
    }

    // 3. Fallback: Se for comando/binário nativo do Linux (ex: vkcube)
    Command::new("sh")
        .args(["-c", &format!("{} &", target)])
        .spawn()
        .map_err(|e| format!("Falha ao executar processo nativo: {}", e))?;

    Ok(format!("Executando processo nativo: {}", target))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_system_status,
            detect_system_gpus,
            scan_steam_games,
            run_benchmark,
            launch_game
        ])
        .run(tauri::generate_context!())
        .expect("error while running Soberano LSFG Manager");
}
