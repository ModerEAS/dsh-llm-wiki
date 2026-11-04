<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | **Deutsch** | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**LLM Wiki als natives [DeepSeek Harness (DSH)](docs/dsh.md)-Plugin: eine
selbstpflegende, Obsidian-kompatible Wissensdatenbank, die in deinem Projekt lebt.**

Folgt Andrej Karpathys [LLM-Wiki-Muster](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
Rohe Quellen (URLs, PDFs, Markdown, JSON, XML) werden zu einem dauerhaften, verlinkten,
LLM-gepflegten Wiki, das **wächst**, statt bei jeder Frage neu abgeleitet zu werden.

Dieses Repository ist der DSH-Fork von
[`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki). Das Vault-Format ist
identisch — ein Vault lässt sich frei zwischen beiden Builds verschieben.

> **Für diesen DSH-Fork ist das [englische README](./README.md) maßgeblich**; diese Seite
> ist eine Zusammenfassung. Schichtenmodell, Tool- und Befehlsreferenz, Quellenpaket-Format
> und Zitierregeln stehen im englischen README.

---

## Schnellstart — DeepSeek Harness

Voraussetzungen: Node ≥ 22, pnpm 9. Das Plugin wird als DSH-**Bundle** in [`dsh/`](dsh/)
ausgeliefert — lokal und privat (`dsh-llm-wiki`), es gibt **keine** npm-Veröffentlichung
dieses Forks.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # kompiliert src/dsh → dist/dsh/, re-exportiert von dsh/host-index.js
```

Dann in DeepSeek Harness:

1. `plugin_manager` → `install_bundle` öffnen.
2. Auf den **absoluten** Pfad des `dsh/`-Verzeichnisses im Klon zeigen,
   z. B. `/Users/du/src/dsh-llm-wiki/dsh`.
3. Die Plugin-Zeile `llm-wiki` aktiviert sich per HMR. Ein beliebiges Projekt öffnen — mit
   oder ohne `.llm-wiki/`-Vault; ohne Vault wird still initialisiert.

Pro Projekt erhältst du: die LLM-Wiki-Tools, ein **Status-Panel in der Seitenleiste**
(`wiki-status`), einen Abschnitt **Einstellungen → LLM Wiki**, ein Agent-Preset
**LLM Wiki synthesis** und die `/wiki-*`-Slash-Befehle.

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall Was sind die wichtigsten Muster?
```

> **Vollständige Host-Dokumentation:** [`docs/dsh.md`](docs/dsh.md)

---

## Andere Hosts — MCP (nie gleichzeitig)

Außerhalb von DeepSeek Harness erreicht man denselben Vault über den mitgelieferten
stdio-MCP-Server:

```bash
pnpm install && pnpm build:mcp      # erzeugt dist/mcp/index.js
```

Den **absoluten** Pfad zu `dist/mcp/index.js` als lokalen Server im Client (Claude Code,
Codex CLI, Cursor, Windsurf, Zed, Cline) registrieren und den Vault über `WIKI_ROOT`
festlegen. MCP-Clients expandieren `~` nicht — immer absolute Pfade verwenden.
Client-spezifische Beispiele: [`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ Ein Schreiber pro Vault
> **Das native DSH-Plugin und der MCP-Server dürfen niemals gleichzeitig auf denselben
> Vault zugreifen.** Beide schreiben die `meta/`-Projektionen und beide schützen `raw/`;
> zwei Schreiber verschachteln Rebuilds und stören gegenseitig ihre Locks.

---

## Dokumentation

| Dokument | Inhalt |
|----------|--------|
| [DeepSeek-Harness-Plugin](docs/dsh.md) | DSH-Installation, Einstellungen, Seitenleiste, Locale, Port-Entscheidungen |
| [Architektur](docs/architecture.md) | Wie die vier Schichten funktionieren, Eigentumsmodell |
| [Befehle](docs/commands.md) | Referenz zu Befehlen und Tools |
| [Obsidian](docs/obsidian.md) | Vault-Einrichtung und empfohlene Plugins |
| [Konfiguration](docs/configuration.md) | Wiki-Modi, Themen, Umgebungsvariablen |
| [API](docs/api.md) | Parameterreferenz der Tools |
| [Harnesses](docs/harnesses.md) | MCP-Konfiguration für Nicht-DSH-Hosts |

---

## Lizenz

MIT — siehe [LICENSE](LICENSE). Gebaut von
[zosmaai](https://github.com/zosmaai) als
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki); dieser Fork pflegt den nativen
DeepSeek-Harness-Port. Mitwirkende:
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>DSH-Port gepflegt unter <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · Upstream <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
