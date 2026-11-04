<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | **Português** | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**LLM Wiki como plugin nativo do [DeepSeek Harness (DSH)](docs/dsh.md): uma base de
conhecimento auto-mantida e compatível com Obsidian, que vive dentro do seu projeto.**

Segue o [padrão LLM Wiki de Andrej Karpathy](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
transforme fontes brutas (URLs, PDFs, markdown, JSON, XML) em um wiki durável,
interligado e mantido pelo LLM que **se acumula** em vez de ser rederivado a cada pergunta.

Este repositório é o fork DSH de
[`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki). O formato do vault é
idêntico — um vault migra livremente entre as duas builds.

> **O [README em inglês](./README.md) é a versão autoritativa** para este fork DSH; esta
> página é um resumo. O modelo de camadas, as tabelas de ferramentas e comandos, o formato
> dos pacotes de fontes e as regras de citação estão lá.

---

## Início rápido — DeepSeek Harness

Requisitos: Node ≥ 22, pnpm 9. O plugin é distribuído como **bundle** DSH em
[`dsh/`](dsh/) — local e privado (`dsh-llm-wiki`); este fork **não** é publicado no npm.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # compila src/dsh → dist/dsh/, reexportado por dsh/host-index.js
```

Depois, no DeepSeek Harness:

1. Abra `plugin_manager` → `install_bundle`.
2. Aponte para o caminho **absoluto** do diretório `dsh/` do seu clone,
   por exemplo `/Users/voce/src/dsh-llm-wiki/dsh`.
3. A linha de plugin `llm-wiki` ativa via HMR. Abra qualquer projeto — com ou sem um vault
   `.llm-wiki/`; sem vault ele inicializa em silêncio.

Por projeto você recebe: as ferramentas LLM Wiki, um **painel de status na barra lateral**
(`wiki-status`), uma seção **Configurações → LLM Wiki**, um preset de agente
**LLM Wiki synthesis** e os comandos `/wiki-*`.

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall Quais são os padrões principais?
```

> **Documentação completa do host:** [`docs/dsh.md`](docs/dsh.md)

---

## Outros hosts — MCP (nunca ao mesmo tempo)

Fora do DeepSeek Harness, o mesmo vault é acessado pelo servidor MCP stdio incluído:

```bash
pnpm install && pnpm build:mcp      # gera dist/mcp/index.js
```

Registre o caminho **absoluto** de `dist/mcp/index.js` como servidor local no seu cliente
(Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline) e fixe o vault com `WIKI_ROOT`.
Clientes MCP não expandem `~`: use sempre caminhos absolutos. Exemplos por cliente em
[`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ Um único escritor por vault
> **O plugin nativo do DSH e o servidor MCP nunca devem rodar no mesmo vault ao mesmo
> tempo.** Ambos escrevem as projeções de `meta/` e ambos protegem `raw/`; dois escritores
> intercalam reconstruções e atrapalham os locks um do outro.

---

## Documentação

| Documento | Conteúdo |
|-----------|----------|
| [Plugin DeepSeek Harness](docs/dsh.md) | Instalação DSH, configurações, barra lateral, locale, decisões da porta |
| [Arquitetura](docs/architecture.md) | Como as quatro camadas funcionam e o modelo de propriedade |
| [Comandos](docs/commands.md) | Referência de comandos e ferramentas |
| [Obsidian](docs/obsidian.md) | Configuração do vault e plugins recomendados |
| [Configuração](docs/configuration.md) | Modos de wiki, tópicos, variáveis de ambiente |
| [API](docs/api.md) | Referência de parâmetros das ferramentas |
| [Harnesses](docs/harnesses.md) | Configuração MCP para hosts que não são DSH |

---

## Licença

MIT — veja [LICENSE](LICENSE). Construído por
[zosmaai](https://github.com/zosmaai) como
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki); este fork mantém a porta nativa
para DeepSeek Harness. Contribuidores:
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>Porte DSH mantido em <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · upstream <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
