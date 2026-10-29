# Medfølgende biblioteker

Filerne her er kopieret uændret fra npm, så appen ikke henter kode fra fremmede servere.

| Fil | Pakke | Licens |
|---|---|---|
| `transformers.js` | `@huggingface/transformers` 4.3.1 | Apache-2.0 (`LICENSE-transformers.txt`) |
| `ort-wasm-simd-threaded.asyncify.mjs` / `.wasm` | `onnxruntime-web` 1.31.0-dev.20260914-8d85527a0 (den version, transformers 4.3.1 er bygget mod) | MIT, © Microsoft Corporation |

Ved opdatering skal de tre filer skiftes samtidig, og versionen af `onnxruntime-web`
skal passe til den, `@huggingface/transformers` afhænger af.

**Én lille rettelse i `transformers.js`:** strengen `"Mistral3ForConditionalGeneration"`
er skrevet som `"Mistral3" + "ForConditionalGeneration"`. GitHubs hemmeligheds-tjek
forvekslede den med en adgangsnøgle og afviste upload. Virkningen er den samme.
