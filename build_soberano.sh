#!/usr/bin/env bash
# ==============================================================================
# SOBERANO LSFG-VK - AUTOMATED BUILD & PACKAGING ENGINE
# Frame Generation for Linux via Vulkan Implicit Layer & Lossless Scaling
# ==============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Defaults
BUILD_TYPE="Release"
TARGET_ARCH="native"
BUILD_UI=true
INSTALL=false
CLEAN=false
JOBS=$(nproc 2>/dev/null || echo 4)

# Color Palette
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

show_help() {
    cat << HELP_EOF
Uso: $0 [OPÇÕES]

Opções de Compilação:
  --native        Compila otimizado para a CPU local (-march=native -O3) [Padrão]
  --universal     Compila binário universal compatível com CPUs x86-64-v3 (-march=x86-64-v3)
  --no-ui         Pula a compilação do gerenciador gráfico Tauri
  --install       Instala automaticamente a Vulkan Layer, CLI e UI no sistema
  --clean         Limpa diretórios de build anteriores antes de compilar
  -h, --help      Exibe este menu de ajuda

Exemplos:
  $0                         # Build local ultra-otimizado (Host CPU + UI)
  $0 --universal             # Build para distribuição pública
  $0 --native --install      # Compila e instala tudo no sistema
HELP_EOF
    exit 0
}

# Parse command line flags
while [[ $# -gt 0 ]]; do
    case "$1" in
        --native)
            TARGET_ARCH="native"
            shift
            ;;
        --universal)
            TARGET_ARCH="universal"
            shift
            ;;
        --no-ui)
            BUILD_UI=false
            shift
            ;;
        --install)
            INSTALL=true
            shift
            ;;
        --clean)
            CLEAN=true
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            echo -e "${RED}[!] Opção desconhecida: $1${NC}"
            show_help
            ;;
    esac
done

echo -e "${PURPLE}================================================================${NC}"
echo -e "${CYAN}        SOBERANO LSFG-VK - BUILD & PACKAGING ENGINE             ${NC}"
echo -e "${PURPLE}================================================================${NC}"

# CPU Diagnostics
CPU_MODEL=$(lscpu 2>/dev/null | grep -E "Model name" | sed -r 's/Model name:\s+//' || uname -m)
echo -e "${PURPLE}[+]${NC} CPU Detectada: ${CYAN}${CPU_MODEL}${NC} (${JOBS} threads)"

if [ "$TARGET_ARCH" = "universal" ]; then
    echo -e "${PURPLE}[+]${NC} Modo de Otimização: ${YELLOW}UNIVERSAL (x86-64-v3 / AVX2)${NC}"
    CMAKE_ARCH_FLAG="-DLSFGVK_UNIVERSAL_BUILD=ON"
    BUILD_DIR="build_universal"
else
    echo -e "${PURPLE}[+]${NC} Modo de Otimização: ${GREEN}NATIVE (Auto-tuned para ${CPU_MODEL})${NC}"
    CMAKE_ARCH_FLAG="-DLSFGVK_NATIVE_ARCH=ON"
    BUILD_DIR="build_native"
fi

# Clean previous build if requested
if [ "$CLEAN" = true ]; then
    echo -e "${YELLOW}[*] Limpando diretórios de build anteriores...${NC}"
    rm -rf "$BUILD_DIR" dist
fi

mkdir -p "$BUILD_DIR" dist

# 1. Compilar Camada Vulkan & CLI C++
echo -e "\n${CYAN}==> [1/3] Configurando e compilando C++ Core (Layer + CLI)...${NC}"
cmake -B "$BUILD_DIR" \
    -DCMAKE_BUILD_TYPE="$BUILD_TYPE" \
    $CMAKE_ARCH_FLAG \
    -DLSFGVK_BUILD_VK_LAYER=ON \
    -DLSFGVK_BUILD_CLI=ON \
    -DLSFGVK_LAYER_MANGOHUD=ON

cmake --build "$BUILD_DIR" -j"$JOBS"

# Copiar artefatos C++ para dist
cp "$BUILD_DIR/lsfg-vk-layer/liblsfg-vk-layer.so" dist/
cp "$BUILD_DIR/lsfg-vk-cli/lsfg-vk-cli" dist/
cp "$BUILD_DIR/lsfg-vk-layer/VkLayer_LSFGVK_frame_generation.json" dist/

echo -e "${GREEN}[✓] Núcleo C++ compilado com sucesso!${NC}"

# 2. Compilar Interface Gráfica Tauri 2.0 (se habilitado)
if [ "$BUILD_UI" = true ]; then
    if command -v cargo &>/dev/null; then
        echo -e "\n${CYAN}==> [2/3] Compilando Soberano LSFG Manager (Rust / Tauri 2.0)...${NC}"
        cd lsfg-vk-ui-tauri/src-tauri
        cargo build --release
        cd "$SCRIPT_DIR"

        # Localizar binario gerado pelo Cargo
        UI_FOUND=false
        for out in "${CARGO_TARGET_DIR:-}" "/tmp/cargo_target" "$SCRIPT_DIR/lsfg-vk-ui-tauri/src-tauri/target"; do
            if [ -n "$out" ] && [ -f "$out/release/soberano-lsfg-manager" ]; then
                cp "$out/release/soberano-lsfg-manager" dist/
                echo -e "${GREEN}[✓] Gerenciador Gráfico copiado para dist/ com sucesso!${NC}"
                UI_FOUND=true
                break
            fi
        done
        if [ "$UI_FOUND" = false ]; then
            echo -e "${YELLOW}[!] Binário UI não localizado nos diretórios padrão do Cargo.${NC}"
        fi
    else
        echo -e "${YELLOW}[!] Cargo (Rust) não encontrado. Pulando compilação da UI.${NC}"
    fi
else
    echo -e "\n${YELLOW}==> [2/3] Compilação da UI desativada (--no-ui).${NC}"
fi

# 3. Gerar Script de Instalação Autônomo na pasta dist
cat << 'INSTALL_SCRIPT' > dist/install.sh
#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Instalando LSFG-VK no sistema..."
PREFIX="${1:-/usr/local}"

sudo mkdir -p "$PREFIX/lib" "$PREFIX/bin" /usr/share/vulkan/implicit_layer.d

sudo cp "$DIR/liblsfg-vk-layer.so" "$PREFIX/lib/"
sudo cp "$DIR/lsfg-vk-cli" "$PREFIX/bin/"

# Gerar manifesto Vulkan com caminho absoluto da lib instalada
sudo sed "s|\"library_path\": \".*\"|\"library_path\": \"$PREFIX/lib/liblsfg-vk-layer.so\"|g" \
    "$DIR/VkLayer_LSFGVK_frame_generation.json" > /tmp/VkLayer_LSFGVK_frame_generation.json
sudo mv /tmp/VkLayer_LSFGVK_frame_generation.json /usr/share/vulkan/implicit_layer.d/

if [ -f "$DIR/soberano-lsfg-manager" ]; then
    sudo cp "$DIR/soberano-lsfg-manager" "$PREFIX/bin/"
fi

echo "LSFG-VK instalado com sucesso em $PREFIX!"
INSTALL_SCRIPT
chmod +x dist/install.sh

# 4. Instalação no sistema se solicitado
if [ "$INSTALL" = true ]; then
    echo -e "\n${CYAN}==> [3/3] Instalando LSFG-VK no sistema...${NC}"
    ./dist/install.sh
else
    echo -e "\n${CYAN}==> [3/3] Pacote de distribuição pronto em ${GREEN}dist/${NC}"
fi

echo -e "\n${GREEN}================================================================${NC}"
echo -e "${GREEN}     BUILD CONCLUÍDO COM SUCESSO - PRONTO PARA AÇÃO!            ${NC}"
echo -e "${GREEN}================================================================${NC}"
echo -e "Artefatos disponíveis:"
ls -lh dist/
