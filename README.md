# Transskription

En app i browseren, der omsætter dansk tale fra møder til tekst, mens der tales.
Teksten gemmes som en `.md`-fil, som du giver til assistenten i vidensbasen.

## Sådan bruger du den

1. **Live-tekst.** Tryk *Start live-tekst*, og tal. Første gang spørger appen, om det er
   i orden, at lyden sendes til browserens tale-tjeneste. Tryk *Stop live-tekst*, når
   mødet er slut. Spørg deltagerne om lov, før du optager.
2. **Oplysninger.** Skriv en titel. Datoen er sat til i dag.
3. **Tekst.** Ret teksten, hvis der er fejl, og tryk *Gem som .md-fil*. Filen hedder fx
   `2026-10-29-projektmoede-om-cykelsti.md`.

Giv filen til assistenten i vidensbasen. **Læg den aldrig selv ind i vidensbasens
repo**, for alt, der kommer i git, bliver der for altid. Assistenten tjekker for navne
og private oplysninger først.

## Funktioner

- **Stemmekommandoer:** sig *punktum, komma, kolon, semikolon, udråbstegn, spørgsmålstegn,
  ny linje* eller *nyt afsnit*, så skrives tegnet i stedet for ordet.
- **Egne ord:** under *Indstillinger* kan du skrive `øjen = Jørgen`, så rettes navne, som
  tale-tjenesten hører forkert, mens der tales. Knappen *Ret egne ord i hele teksten*
  retter det, der allerede står der.
- **Markeringer:** knapperne *Beslutning*, *Handling* og *Vigtigt* sætter en fed
  overskrift med tidsstempel ind i teksten, så de er lette at finde bagefter.
- **Projekt:** feltet kommer med i `.md`-filen, så assistenten kan sortere den.
- **Del fil:** på telefonen sender knappen filen via delingsmenuen, fx til OneDrive eller mail.
- **Indstillinger:** stort begyndelsesbogstav, punktum efter sætninger, *vælg den længste
  udgave* (kan hjælpe, hvis der mangler tekst), skriftstørrelse og lyst eller mørkt udseende.
- **Ordtæller, udkast der huskes** og en advarsel, hvis appen har været i baggrunden eller
  ikke hører noget i et minut.

## Hvor lyden sendes hen

Appen bruger browserens indbyggede talegenkendelse, som er den samme som i
SpeechTexter. Lyden sendes til browserens leverandør, som laver den om til tekst:

| Browser | Lyden sendes til |
|---|---|
| Edge | Microsoft |
| Chrome (også Android) | Google |
| Safari og alle browsere på iPhone | Apple |

Brug kun appen, når det er i orden, at lyden forlader enheden. Er det arbejdsmøder, så
tjek med din arbejdsgiver. I `.md`-filen står der, hvilken tjeneste teksten kom fra.

Første udgave af appen havde også en sprogmodel, der kørte på selve enheden, så intet
blev sendt ud. Den var for svag til dansk og fyldte 250–450 MB, så den er fjernet. Har
du hentet den, sletter appen den selv, næste gang du åbner den.

## Godt at vide

- **Skærmen skal være tændt** og appen åben, mens der tales. En app i browseren kan
  ikke lytte i baggrunden. Appen viser en rød advarsel, hvis den har været i
  baggrunden, og starter selv igen, når du kommer tilbage.
- **iPhone:** *Diktering* skal være slået til (Indstillinger → Generelt → Tastatur).
  Virker live-tekst ikke i appen på hjemmeskærmen, så åbn siden i Safari.
- **Firefox** har ikke talegenkendelse. Brug Edge, Chrome eller Safari.
- **Teksten huskes.** Titel, dato og tekst gemmes løbende i browseren på enheden og er
  der igen, hvis du lukker appen. Tryk *Ny optagelse* for at slette dem. Tælleren under
  teksten viser antal ord (tidsstempler tælles ikke med).
- **Versionsnummer** står nederst på siden.

## Udgiv på GitHub Pages

Appen ligger på `https://jacobjensen89.github.io/transskription/`. Den udgives af sig
selv, når der kommer ændringer i `main` (Settings → Pages → *Deploy from a branch*,
`main`, `/ (root)`).

Installér den med *Installér app* i menuen i Edge eller Chrome (computer) eller
*Føj til hjemmeskærm* (telefon).

## Filerne

| Fil | Hvad den gør |
|---|---|
| `index.html` | Selve siden |
| `style.css` | Udseende (lyst og mørkt) |
| `app.js` | Live-tekst, advarsel om baggrund, gem som .md |
| `sw.js` | Gemmer appen i browseren, så den åbner hurtigt |
| `manifest.webmanifest`, `icons/` | Gør, at den kan installeres som en app |
