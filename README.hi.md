<div align="center">

# dsh-llm-wiki

<a href="./README.md">English</a> | <a href="./README.zh.md">中文</a> | <a href="./README.es.md">Español</a> | <a href="./README.ja.md">日本語</a> | <a href="./README.de.md">Deutsch</a> | <a href="./README.fr.md">Français</a> | <a href="./README.pt.md">Português</a> | <a href="./README.ru.md">Русский</a> | <a href="./README.ko.md">한국어</a> | **हिंदी**

[![CI](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml/badge.svg)](https://github.com/ModerRAS/dsh-llm-wiki/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

</div>

<br/>

**नेटिव [DeepSeek Harness (DSH)](docs/dsh.md) प्लगइन के रूप में LLM Wiki: एक
स्वयं-अनुरक्षित, Obsidian-संगत नॉलेज बेस जो आपके प्रोजेक्ट के अंदर रहता है।**

Andrej Karpathy के [LLM Wiki पैटर्न](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
का अनुसरण करता है: कच्चे स्रोतों (URL, PDF, markdown, JSON, XML) को हर प्रश्न पर दोबारा
व्युत्पन्न करने के बजाय एक टिकाऊ, परस्पर जुड़े, LLM-अनुरक्षित wiki में बदलता है जो
**संचित** होता जाता है।

यह रिपॉज़िटरी [`zosmaai/pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) का DSH
फ़ोर्क है। Vault फ़ॉर्मैट बिल्कुल वही है — एक ही vault दोनों बिल्ड्स के बीच स्वतंत्र रूप से
स्थानांतरित हो सकता है।

> **इस DSH फ़ोर्क के लिए [अंग्रेज़ी README](./README.md) ही प्रामाणिक है**; यह पृष्ठ एक
> सारांश है। लेयर मॉडल, टूल/कमांड तालिकाएँ, स्रोत पैकेट फ़ॉर्मैट और उद्धरण नियम वहाँ
> दिए गए हैं।

---

## त्वरित शुरुआत — DeepSeek Harness

आवश्यकताएँ: Node ≥ 22, pnpm 9. प्लगइन [`dsh/`](dsh/) में DSH **बंडल** के रूप में आता है —
स्थानीय और निजी (`dsh-llm-wiki`); इस फ़ोर्क का npm प्रकाशन **नहीं** है।

```bash
git clone https://github.com/ModerRAS/dsh-llm-wiki.git
cd dsh-llm-wiki
pnpm install
pnpm build:dsh          # src/dsh → dist/dsh/ बनाता है, dsh/host-index.js इसे re-export करता है
```

फिर DeepSeek Harness में:

1. `plugin_manager` → `install_bundle` खोलें।
2. अपने क्लोन में `dsh/` फ़ोल्डर का **पूर्ण (absolute) पथ** दें,
   जैसे `/Users/you/src/dsh-llm-wiki/dsh`।
3. प्लगइन पंक्ति `llm-wiki` HMR पर सक्रिय होती है। कोई भी प्रोजेक्ट खोलें — `.llm-wiki/`
   vault हो या न हो; न होने पर यह चुपचाप इनिशियलाइज़ कर देता है।

प्रति प्रोजेक्ट आपको मिलता है: LLM Wiki टूल्स, **साइडबार स्टेटस पैनल** (`wiki-status`),
**सेटिंग्स → LLM Wiki** सेक्शन, **LLM Wiki synthesis** एजेंट प्रीसेट, और `/wiki-*`
स्लैश कमांड।

```
/wiki-bootstrap "AI Engineering"
/wiki-capture https://example.com/some-article
/wiki-ingest
/wiki-recall मुख्य पैटर्न क्या हैं?
```

> **पूर्ण होस्ट दस्तावेज़:** [`docs/dsh.md`](docs/dsh.md)

---

## अन्य होस्ट — MCP (एक साथ कभी नहीं)

DeepSeek Harness के बाहर वही vault साथ में आने वाले stdio MCP सर्वर से उपलब्ध होता है:

```bash
pnpm install && pnpm build:mcp      # dist/mcp/index.js बनाता है
```

अपने क्लाइंट (Claude Code, Codex CLI, Cursor, Windsurf, Zed, Cline) में
`dist/mcp/index.js` का **पूर्ण पथ** स्थानीय सर्वर के रूप में रजिस्टर करें और `WIKI_ROOT`
से vault तय करें। MCP क्लाइंट `~` का विस्तार नहीं करते — सदैव absolute पथ दें। क्लाइंट-विशिष्ट
उदाहरण [`docs/harnesses.md`](docs/harnesses.md) में हैं।

> ### ⚠️ प्रति vault केवल एक लेखक
> **नेटिव DSH प्लगइन और MCP सर्वर कभी भी एक ही vault पर साथ न चलाएँ।** दोनों `meta/`
> प्रोजेक्शन लिखते हैं और दोनों `raw/` की रक्षा करते हैं; दो लेखक रीबिल्ड को इंटरलीव
> करते हैं और एक-दूसरे के लॉक में बाधा डालते हैं।

---

## दस्तावेज़

| दस्तावेज़ | विषय |
|-----------|------|
| [DeepSeek Harness प्लगइन](docs/dsh.md) | DSH इंस्टॉल, सेटिंग्स, साइडबार, लोकेल, पोर्ट निर्णय |
| [आर्किटेक्चर](docs/architecture.md) | चार परतें कैसे काम करती हैं, स्वामित्व मॉडल |
| [कमांड](docs/commands.md) | कमांड और टूल संदर्भ |
| [Obsidian](docs/obsidian.md) | Vault सेटअप और अनुशंसित प्लगइन |
| [कॉन्फ़िगरेशन](docs/configuration.md) | Wiki मोड, विषय, पर्यावरण चर |
| [API](docs/api.md) | टूल पैरामीटर संदर्भ |
| [हैर्नेस](docs/harnesses.md) | गैर-DSH होस्ट के लिए MCP कॉन्फ़िगरेशन |

---

## लाइसेंस

MIT — देखें [LICENSE](LICENSE)। इसे [zosmaai](https://github.com/zosmaai) ने
[`pi-llm-wiki`](https://github.com/zosmaai/pi-llm-wiki) के रूप में बनाया; यह फ़ोर्क नेटिव
DeepSeek Harness पोर्ट बनाए रखता है। योगदानकर्ता:
[README.md#contributors](./README.md#contributors).

<div align="center">
  <sub>DSH पोर्ट: <a href="https://github.com/ModerRAS/dsh-llm-wiki">ModerRAS/dsh-llm-wiki</a> · अपस्ट्रीम <a href="https://github.com/zosmaai/pi-llm-wiki">zosmaai/pi-llm-wiki</a> · <a href="https://github.com/ModerRAS/dsh-llm-wiki/issues">Issues</a></sub>
</div>
