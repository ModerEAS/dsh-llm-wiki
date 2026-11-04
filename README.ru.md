<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | **Русский** | <a href="./README.ko.md">한국어</a> | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**LLM Wiki как нативный плагин [DeepSeek Harness (DSH)](docs/dsh.md): самоподдерживаемая
база знаний, совместимая с Obsidian, живущая внутри вашего проекта.**

Следует [паттерну LLM Wiki Андрея Карпати](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f):
сырые источники (URL, PDF, markdown, JSON, XML) превращаются в долговечную, связанную
wiki, которую ведёт LLM. Она **накапливается**, а не выводится заново при каждом вопросе.

Этот репозиторий — DSH-форк
[`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki). Формат vault идентичен:
один и тот же vault свободно переносится между обеими сборками.

> **Для этого DSH-форка авторитетен [английский README](./README.md)**; эта страница —
> краткое изложение. Слоистая модель, таблицы инструментов и команд, формат пакетов
> источников и правила цитирования описаны там.

---

## Быстрый старт — DeepSeek Harness

Требования: Node ≥ 22, pnpm 9. Плагин поставляется как DSH-**бандл** в [`dsh/`](dsh/) —
локальный и приватный (`dsh-llm-wiki`); публикации этого форка в npm **нет**.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # собирает src/dsh → dist/dsh/, реэкспортируется из dsh/host-index.js
```

Затем в DeepSeek Harness:

1. Откройте `plugin_manager` → `install_bundle`.
2. Укажите **абсолютный** путь к каталогу `dsh/` в вашем клоне,
   например `/Users/you/src/dsh-llm-wiki/dsh`.
3. Строка плагина `llm-wiki` активируется через HMR. Откройте любой проект — с vault
   `.llm-wiki/` или без него; без vault он инициализируется молча.

Для каждого проекта вы получаете: инструменты LLM Wiki, **панель состояния в боковой
панели** (`wiki-status`), раздел **Настройки → LLM Wiki**, пресет агента
**LLM Wiki synthesis** и команды `/wiki-*`.

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall Какие здесь ключевые паттерны?
```

> **Полная документация по хосту:** [`docs/dsh.md`](docs/dsh.md)

---

## Другие хосты — MCP (никогда одновременно)

Вне DeepSeek Harness тот же vault доступен через встроенный stdio MCP-сервер:

```bash
pnpm install && pnpm build:mcp      # создаёт dist/mcp/index.js
```

Зарегистрируйте **абсолютный** путь к `dist/mcp/index.js` как локальный сервер в клиенте
(Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline) и зафиксируйте vault через
`WIKI_ROOT`. MCP-клиенты не раскрывают `~` — всегда используйте абсолютные пути.
Примеры для конкретных клиентов: [`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ Один писатель на vault
> **Нативный плагин DSH и MCP-сервер никогда не должны работать с одним и тем же vault
> одновременно.** Оба пишут проекции `meta/` и оба защищают `raw/`; два писателя
> перемежают пересборки и мешают друг другу в блокировках.

---

## Документация

| Документ | Содержание |
|----------|------------|
| [Плагин DeepSeek Harness](docs/dsh.md) | Установка в DSH, настройки, боковая панель, локаль, решения порта |
| [Архитектура](docs/architecture.md) | Как работают четыре слоя, модель владения |
| [Команды](docs/commands.md) | Справочник команд и инструментов |
| [Obsidian](docs/obsidian.md) | Настройка vault и рекомендуемые плагины |
| [Конфигурация](docs/configuration.md) | Режимы wiki, темы, переменные окружения |
| [API](docs/api.md) | Справочник параметров инструментов |
| [Хосты](docs/harnesses.md) | Настройка MCP для хостов, отличных от DSH |

---

## Лицензия

MIT — см. [LICENSE](LICENSE). Создано
[zosmaai](https://github.com/zosmaai) как
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki); этот форк поддерживает нативный
порт для DeepSeek Harness. Участники:
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>DSH-порт поддерживается в <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · upstream <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
