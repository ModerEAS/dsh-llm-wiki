<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | **Español** | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**LLM Wiki como plugin nativo de [DeepSeek Harness (DSH)](docs/dsh.md): una base de
conocimiento auto-mantenida y compatible con Obsidian, que vive dentro de tu proyecto.**

Sigue el [patrón LLM Wiki de Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
convierte fuentes crudas (URLs, PDFs, markdown, JSON, XML) en un wiki duradero,
interconectado y mantenido por el LLM que **se acumula** en lugar de re-derivarse en
cada pregunta.

Este repositorio es el fork DSH de
[`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki). El formato del vault es
idéntico: un vault se mueve libremente entre ambas compilaciones.

> **El [README en inglés](./README.md) es la versión autoritativa** para este fork DSH;
> esta página es un resumen. El README completo en inglés incluye el modelo de capas,
> las tablas de herramientas y comandos, el formato de los paquetes de fuentes y las
> reglas de citación.

---

## Inicio rápido — DeepSeek Harness

Requisitos: Node ≥ 22, pnpm 9. El plugin se distribuye como **bundle** de DSH en
[`dsh/`](dsh/) — es local y privado (`dsh-llm-wiki`), **no** hay publicación en npm de
este fork.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # compila src/dsh → dist/dsh/, reexportado por dsh/host-index.js
```

Después, en DeepSeek Harness:

1. Abre `plugin_manager` → `install_bundle`.
2. Apunta a la ruta **absoluta** del directorio `dsh/` de tu clon,
   p. ej. `/Users/tu-usuario/src/dsh-llm-wiki/dsh`.
3. La fila de plugin `llm-wiki` se activa por HMR. Abre cualquier proyecto — con o sin
   un vault `.llm-wiki/`; se inicializa en silencio.

Obtienes, por proyecto: las herramientas LLM Wiki, un **panel de estado en la barra
lateral** (`wiki-status`), una sección **Ajustes → LLM Wiki**, un preset de agente
**LLM Wiki synthesis** y los comandos `/wiki-*`.

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall ¿Cuáles son los patrones clave?
```

> **Documentación completa del host:** [`docs/dsh.md`](docs/dsh.md).

---

## Otros hosts — MCP (nunca a la vez)

Fuera de DeepSeek Harness, el mismo vault se alcanza por el servidor MCP stdio:

```bash
pnpm install && pnpm build:mcp      # genera dist/mcp/index.js
```

Registra la ruta **absoluta** de `dist/mcp/index.js` como servidor local en tu cliente
(Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline) y fija el vault con `WIKI_ROOT`.
Los clientes MCP no expanden `~`: usa siempre rutas absolutas. Ejemplos por cliente en
[`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ Un solo escritor por vault
> **El plugin nativo de DSH y el servidor MCP nunca deben ejecutarse contra el mismo
> vault al mismo tiempo.** Ambos escriben las proyecciones de `meta/` y ambos protegen
> `raw/`; dos escritores intercalan reconstrucciones y confunden sus bloqueos.

---

## Documentación

| Documento | Contenido |
|-----------|-----------|
| [Plugin DeepSeek Harness](docs/dsh.md) | Instalación DSH, ajustes, barra lateral, locale, decisiones del port |
| [Arquitectura](docs/architecture.md) | Cómo funcionan las cuatro capas y el modelo de propiedad |
| [Comandos](docs/commands.md) | Referencia de comandos y herramientas |
| [Obsidian](docs/obsidian.md) | Configuración del vault y plugins recomendados |
| [Configuración](docs/configuration.md) | Modos de wiki, temas, variables de entorno |
| [API](docs/api.md) | Referencia de parámetros de las herramientas |
| [Harnesses](docs/harnesses.md) | Configuración MCP para hosts que no son DSH |

---

## Licencia

MIT — ver [LICENSE](LICENSE). Construido por
[zosmaai](https://github.com/zosmaai) como
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki); este fork mantiene el port
nativo de DeepSeek Harness. Contribuyentes:
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>Port DSH mantenido en <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · upstream <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
