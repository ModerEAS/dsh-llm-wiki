<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | **한국어** | <a href="./README.hi.md">हिंदी</a>

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**네이티브 [DeepSeek Harness(DSH)](docs/dsh.md) 플러그인으로 동작하는 LLM Wiki:
프로젝트 안에서 스스로 유지·성장하는 Obsidian 호환 지식 베이스.**

Andrej Karpathy의 [LLM Wiki 패턴](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)을
따릅니다. 원본 소스(URL, PDF, markdown, JSON, XML)를 질문할 때마다 다시 유도하는 대신
**누적되는** 영속적이고 상호 연결된 LLM 관리 Wiki로 바꿉니다.

이 저장소는 [`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki)의 DSH
포크입니다. Vault 형식은 동일하여 두 빌드 사이에서 자유롭게 이동할 수 있습니다.

> **이 DSH 포크에서는 [영문 README](./README.md)가 기준**입니다. 이 페이지는 요약입니다.
> 계층 구조, 도구/명령 표, 소스 패킷 형식, 인용 규칙은 영문 README를 참고하세요.

---

## 빠른 시작 — DeepSeek Harness

요구 사항: Node ≥ 22, pnpm 9. 플러그인은 [`dsh/`](dsh/)에 DSH **번들**로 들어 있습니다.
로컬 전용 비공개 번들(`dsh-llm-wiki`)이며, 이 포크는 **npm에 게시되지 않습니다**.

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # src/dsh → dist/dsh/ 빌드 (dsh/host-index.js가 재export)
```

그다음 DeepSeek Harness에서:

1. `plugin_manager` → `install_bundle`을 엽니다.
2. 클론 안의 `dsh/` 디렉터리 **절대 경로**를 지정합니다
   (예: `/Users/you/src/dsh-llm-wiki/dsh`).
3. 플러그인 행 `llm-wiki`가 HMR로 활성화됩니다. 아무 프로젝트나 열면 됩니다 —
   `.llm-wiki/` vault가 있어도 없어도 되고, 없으면 조용히 초기화합니다.

프로젝트마다 얻게 되는 것: LLM Wiki 도구들, **사이드바 상태 패널**(`wiki-status`),
**설정 → LLM Wiki** 섹션, **LLM Wiki synthesis** 에이전트 프리셋, `/wiki-*` 슬래시 명령.

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall 핵심 패턴은 무엇인가?
```

> **호스트 전체 문서:** [`docs/dsh.md`](docs/dsh.md)

---

## 다른 호스트 — MCP (동시 사용 금지)

DeepSeek Harness 밖에서는 함께 제공되는 stdio MCP 서버로 같은 vault에 접근합니다:

```bash
pnpm install && pnpm build:mcp      # dist/mcp/index.js 생성
```

클라이언트(Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline)에
`dist/mcp/index.js`의 **절대 경로**를 로컬 서버로 등록하고 `WIKI_ROOT`로 vault를
고정하세요. MCP 클라이언트는 `~`를 확장하지 않으므로 항상 절대 경로를 사용해야 합니다.
클라이언트별 예시는 [`docs/harnesses.md`](docs/harnesses.md).

> ### ⚠️ vault당 작성자는 하나만
> **네이티브 DSH 플러그인과 MCP 서버를 같은 vault에 동시에 실행하면 안 됩니다.**
> 둘 다 `meta/` 투영을 쓰고 둘 다 `raw/`를 보호합니다. 작성자가 둘이면 재빌드가
> 교차되고 서로의 락을 방해합니다.

---

## 문서

| 문서 | 내용 |
|------|------|
| [DeepSeek Harness 플러그인](docs/dsh.md) | DSH 설치, 설정, 사이드바, 로케일, 포팅 결정 |
| [아키텍처](docs/architecture.md) | 4계층 동작 방식과 소유 모델 |
| [명령](docs/commands.md) | 명령 및 도구 레퍼런스 |
| [Obsidian](docs/obsidian.md) | Vault 설정과 권장 플러그인 |
| [설정](docs/configuration.md) | Wiki 모드, 주제, 환경 변수 |
| [API](docs/api.md) | 도구 파라미터 레퍼런스 |
| [하네스](docs/harnesses.md) | 비DSH 호스트용 MCP 설정 |

---

## 라이선스

MIT — [LICENSE](LICENSE) 참고. [zosmaai](https://github.com/zosmaai)가
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki)로 만들었고, 이 포크가 DeepSeek
Harness 네이티브 포팅을 유지합니다. 기여자:
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>DSH 포팅 유지: <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · 업스트림 <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
