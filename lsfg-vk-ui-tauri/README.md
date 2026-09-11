# Soberano LSFG Manager (Tauri 2.0 & Rust)

Uma suíte gráfica moderna, reativa e de alta performance desenvolvida em **Rust + Tauri 2.0** com tema **Purple Abyss / Cyberpunk**, substituindo a interface padrão em Qt/QML para o ecossistema [lsfg-vk](https://github.com/PancakeTAS/lsfg-vk).

---

## ⚡ Recursos Principais
- 🎮 **Gerenciamento Tátil de Perfis:** Ajuste multiplicadores (2x, 3x, 4x), resolução de fluxo (Flow Scale) e modo performance com hot-reload instantâneo sem reiniciar o jogo.
- 🔍 **Auto-Scanner da Biblioteca Steam:** Detecção automática de jogos instalados na Steam (`~/.local/share/Steam` e `/mnt/GAMES`) com adição em 1 clique.
- 📊 **Monitoramento de Hardware em Tempo Real:** Leitura em tempo real da temperatura, uso de VRAM e clock da GPU dedicada (RTX 3060 Ti / NVIDIA).
- 🚀 **Benchmark Integrado:** Teste de estresse sintético em tempo real com cálculo de FPS gerados via IA e projeção final de quadros.
- 🛡️ **Zero Bloatware:** Backend nativo em Rust consumindo menos de 30MB de memória RAM.

---

## 🛠️ Como Compilar
```bash
cd lsfg-vk-ui-tauri/src-tauri
cargo build --release
```

O binário final será gerado em `target/release/soberano-lsfg-manager`.
