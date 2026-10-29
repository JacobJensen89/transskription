# Transskription

En app, der omsætter dansk tale fra møder til tekst. Den kører i browseren, og
resultatet gemmes som en `.md`-fil, som du giver til assistenten i vidensbasen.

Der er to måder at få tekst på:

| | Live-tekst | Kun på denne computer |
|---|---|---|
| Hvordan | Teksten kommer, mens der tales | Optag eller vælg en lydfil, og omsæt den bagefter |
| Kvalitet på dansk | God (samme motor som SpeechTexter) | Middel (`whisper-small`) |
| Lyden sendes til | Browserens tale-tjeneste: Microsoft i Edge, Google i Chrome, Apple på iPhone | Ingen. Den bliver på computeren |
| Kræver | Internet | Sprogmodellen hentet én gang (250–450 MB) |

Brug kun live-tekst, når det er i orden, at lyden forlader computeren. Appen spørger,
før den bruges første gang, og skriver i `.md`-filen, hvilken måde teksten er lavet på.

## Sådan bruger du den

**Live-tekst:** Tryk *Start live-tekst*, og tal. Tryk *Stop live-tekst*, når mødet er
slut. Skriv titel, og gem som `.md`-fil. Appen starter selv genkendelsen igen, hvis
browseren stopper den efter en pause.

**Kun på denne computer:**

1. **Sprogmodel.** Første gang trykker du på *Hent sprogmodel*. Den fylder 250–450 MB
   og ligger bagefter i browseren. Næste gang starter den af sig selv.
2. **Lyd.** Tryk *Optag*, eller vælg en lydfil (fx mp3, m4a, wav eller en video fra
   Teams). Spørg deltagerne om lov, før du optager.
3. **Oplysninger.** Skriv en titel. Datoen er sat til i dag.
4. **Omsæt til tekst.** Lyden deles i stykker på højst 30 sekunder. Du kan se, hvor
   langt den er, og hvor lang tid der er tilbage. Teksten kan rettes bagefter.
5. **Gem som .md-fil.** Filen hedder fx `2026-10-29-projektmoede-om-cykelsti.md`.

Giv filen til assistenten i vidensbasen. **Læg den aldrig selv ind i vidensbasens
repo**, for alt, der kommer i git, bliver der for altid. Assistenten tjekker for navne
og private oplysninger først.

## Hvorfor intet forlader computeren (Optag og Vælg lydfil)

- Sprogmodellen hentes én gang fra Hugging Face og gemmes i browseren.
- Selve omsætningen sker i browseren, på grafikkortet (WebGPU) hvis det kan, ellers
  på processoren (WASM, langsommere).
- Browserens egen talegenkendelse bruges kun ved live-tekst, fordi den sender lyden
  til browserens leverandør.
- Programkoden til modellen ligger i mappen `vendor/` i stedet for at blive hentet
  fra en fremmed server.

**Prøv selv:** Når modellen er hentet, kan du slå wifi fra og omsætte en optagelse.
Det virker stadig, fordi intet bliver sendt.

## Udgiv på GitHub Pages (gratis)

Det gøres én gang:

1. Flet ændringerne ind i `main` (fx ved at godkende en pull request).
2. Gå til repoets **Settings → Pages**.
3. Under *Build and deployment* vælger du *Source: Deploy from a branch*,
   *Branch: main* og mappen */ (root)*. Tryk *Save*.
4. Efter et par minutter ligger appen på
   `https://jacobjensen89.github.io/transskription/`.

Åbn adressen i Chrome eller Edge. Vælg *Installér app* i menuen (computer) eller
*Føj til hjemmeskærm* (telefon), så den ligger som en app.

## Godt at vide

- **Bedste browser:** Chrome eller Edge på en computer. De kan bruge grafikkortet, så
  det går meget hurtigere. Firefox og Safari virker, men langsommere.
- **Skærmen skal være tændt:** En app i browseren kan ikke optage med slukket skærm
  eller i baggrunden. Appen viser en rød advarsel, hvis det er sket. Skal skærmen være
  slukket, så optag med telefonens egen optager og brug *Vælg lydfil*.
- **Versionsnummer** står nederst på siden.
- **Telefon:** virker, men en lang optagelse tager lang tid. Optag gerne på telefonen,
  gem lydfilen, og omsæt den på computeren.
- **Lange møder:** en time lyd fylder ca. 250 MB hukommelse under omsætningen.
  Hold fanen åben, til den er færdig.
- **Kvalitet:** `whisper-small` er svag til dansk. Ret teksten igennem, før du gemmer.
  Den danske model (røst) kommer i trin 2.

## Filerne

| Fil | Hvad den gør |
|---|---|
| `index.html` | Selve siden |
| `style.css` | Udseende (lyst og mørkt) |
| `app.js` | Optagelse, opdeling af lyd, fremdrift, gem som .md |
| `worker.js` | Kører sprogmodellen i baggrunden. Modelnavnet står øverst |
| `sw.js` | Gemmer appen i browseren, så den kan åbnes uden internet |
| `manifest.webmanifest`, `icons/` | Gør, at den kan installeres som en app |
| `vendor/` | Modelbiblioteket (se `vendor/README.md`) |

## Næste trin

1. ~~Appen med en færdig model~~ (denne version)
2. Omdan den danske model `CoRal-project/roest-v3-wav2vec2-315m` til ONNX
3. Test på en rigtig mødeoptagelse
4. Indbakke og automatisk afhentning
