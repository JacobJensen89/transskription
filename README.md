# Transskription

Dansk tale til tekst i browseren. Sort baggrund, grøn skrift, ingen indstillinger.

Appen ligger på https://jacobjensen89.github.io/transskription/ og kan installeres som app
(Chrome eller Edge: *Installér app*, på telefonen *Føj til startskærm*).

## Sådan bruger du den

- Tryk **START** (eller Ctrl+Mellemrum på en computer) og tal. Teksten kommer i noten.
- Sig *punktum, komma, kolon, semikolon, spørgsmålstegn, udråbstegn, ny linje, linjeskift* eller
  *nyt afsnit*, så skrives tegnet i stedet for ordet. Stort begyndelsesbogstav kommer efter punktum,
  spørgsmålstegn, udråbstegn og ny linje.
- Står markøren i teksten, bliver ny tekst sat ind dér. Ellers kommer den til sidst.
- Skriv en **overskrift** øverst. Datoen sætter appen selv. **☰** viser alle tidligere noter, **+** laver
  en ny. Uden overskrift hedder noten det samme som dens første linje.
- **Kopiér alt** kopierer teksten. **Download** gemmer noten som en `.md`-fil med overskrift og dato.
  **Slet** fjerner noten efter en bekræftelse.
- Under knappen står status (Lytter / Genforbinder / Stoppet), tid og antal ord.

## Noter og lyd

- Noter gemmes løbende i browseren på enheden og er der igen, hvis du lukker appen. De deles ikke
  mellem telefon og computer. Download en note for at tage den med.
- Lyden sendes til browserens tale-tjeneste (Google i Chrome, Microsoft i Edge, Apple i Safari),
  som laver den om til tekst. Brug den kun, når det er i orden, at lyden forlader enheden, og
  spørg deltagerne om lov, før du optager et møde.
- Filen må ikke lægges direkte i en vidensbase. Giv den til assistenten, som tjekker for navne og
  private oplysninger først.

## Hvordan den holder til lange optagelser

- Browseren lukker genkendelsen af sig selv med jævne mellemrum, bl.a. efter cirka 5 minutter.
  Appen starter den forfra efter 150 millisekunder, og der går ikke tekst tabt.
- Uafsluttet tekst gemmes efter 1,5 sekunds pause, hvert 10. sekund under sammenhængende tale og
  ved genstart. Kommer et færdigt resultat bagefter, erstatter det den gemte tekst.
- En vagt tjekker hvert tredje sekund, om genkendelsen stadig kører, og starter den forfra, hvis den
  hænger i 40 sekunder uden livstegn.
- Skærmen holdes tændt, mens der lyttes. **Skærmen skal være tændt, og appen åben**, på en telefon.
  En app i browseren kan ikke lytte i baggrunden.
- På en computer lytter appen videre, også når fanen ligger bag en anden, fx et møde i et andet vindue.

## Til test

Adressen med `?kort` bagest (`.../transskription/?kort`) lader genkendelsen lukke efter hver
sætning i stedet for at køre i ét stræk. Det vises ikke i appen.

## Filerne

| Fil | Hvad den gør |
|---|---|
| `index.html`, `style.css` | Siden og udseendet |
| `app.js` | Optagelse, noter, kommandoer, kopiér og download |
| `sw.js` | Gemmer appen, så den åbner hurtigt. Henter altid den nyeste udgave fra nettet |
| `manifest.webmanifest`, `icons/` | Gør, at den kan installeres som en app |

Versionsnummeret står nederst på siden.
