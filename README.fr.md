<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | **Français** | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**LLM Wiki en tant que plugin natif de [DeepSeek Harness (DSH)](docs/dsh.md) : une base de
connaissances auto-entretenue et compatible Obsidian, qui vit dans votre projet.**

Suit le [modèle LLM Wiki d'Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) :
transformez des sources brutes (URLs, PDF, markdown, JSON, XML) en un wiki durable, lié,
maintenu par le LLM, qui **s'accumule** au lieu d'être redérivé à chaque question.

Ce dépôt est le fork DSH de
[`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki). Le format du vault est
identique — un vault se déplace librement entre les deux builds.

> **Le [README anglais](./README.md) fait foi** pour ce fork DSH ; cette page est un
> résumé. Le modèle de couches, les tableaux d'outils et de commandes, le format des
> paquets de sources et les règles de citation s'y trouvent.

---

## Démarrage rapide — DeepSeek Harness

Prérequis : Node ≥ 22, pnpm 9. Le plugin est livré comme **bundle** DSH dans
[`dsh/`](dsh/) — local et privé (`dsh-llm-wiki`) : ce fork n'est **pas** publié sur npm.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # compile src/dsh → dist/dsh/, ré-exporté par dsh/host-index.js
```

Puis, dans DeepSeek Harness :

1. Ouvrez `plugin_manager` → `install_bundle`.
2. Indiquez le chemin **absolu** du répertoire `dsh/` de votre clone,
   par ex. `/Users/vous/src/dsh-llm-wiki/dsh`.
3. La ligne de plugin `llm-wiki` s'active via HMR. Ouvrez n'importe quel projet — avec ou
   sans vault `.llm-wiki/` ; il s'initialise silencieusement.

Par projet, vous obtenez : les outils LLM Wiki, un **panneau d'état dans la barre latérale**
(`wiki-status`), une section **Paramètres → LLM Wiki**, un preset d'agent
**LLM Wiki synthesis**, et les commandes `/wiki-*`.

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall Quels sont les motifs clés ?
```

> **Documentation complète de l'hôte :** [`docs/dsh.md`](docs/dsh.md)

---

## Autres hôtes — MCP (jamais en même temps)

Hors de DeepSeek Harness, le même vault est accessible via le serveur MCP stdio fourni :

```bash
pnpm install && pnpm build:mcp      # produit dist/mcp/index.js
```

Enregistrez le chemin **absolu** de `dist/mcp/index.js` comme serveur local dans votre
client (Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline) et fixez le vault avec
`WIKI_ROOT`. Les clients MCP n'étendent pas `~` : utilisez toujours des chemins absolus.
Exemples par client dans [`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ Un seul écrivain par vault
> **Le plugin natif DSH et le serveur MCP ne doivent jamais tourner sur le même vault en
> même temps.** Les deux écrivent les projections `meta/` et protègent `raw/` ; deux
> écrivains entrelacent les reconstructions et se perturbent mutuellement.

---

## Documentation

| Document | Contenu |
|----------|---------|
| [Plugin DeepSeek Harness](docs/dsh.md) | Installation DSH, paramètres, barre latérale, locale, décisions du port |
| [Architecture](docs/architecture.md) | Fonctionnement des quatre couches, modèle de propriété |
| [Commandes](docs/commands.md) | Référence des commandes et des outils |
| [Obsidian](docs/obsidian.md) | Configuration du vault et plugins recommandés |
| [Configuration](docs/configuration.md) | Modes de wiki, thèmes, variables d'environnement |
| [API](docs/api.md) | Référence des paramètres des outils |
| [Harnais](docs/harnesses.md) | Configuration MCP pour les hôtes non-DSH |

---

## Licence

MIT — voir [LICENSE](LICENSE). Construit par
[zosmaai](https://github.com/zosmaai) sous le nom
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) ; ce fork maintient le port natif
DeepSeek Harness. Contributeurs :
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>Port DSH maintenu sur <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · upstream <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
