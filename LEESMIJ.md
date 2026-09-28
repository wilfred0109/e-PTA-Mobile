# e-PTA Mobile

Een web-app (PWA) voor de telefoon die het projectbestand van Porteum e-PTA **alleen leest**:

- **Overzicht**: per studie hoeveel vakken binnen zijn, de retourdatum, en welke vakken nog bij de sectie liggen, nog niet zijn uitgezet of fouten hebben.
- **PTA per vak**: studie en vak kiezen, de status van het vak, eventuele fouten en per toets het kolomnummer, de periode, de toetsvorm, de weging, duur, afnamemoment en herkansbaarheid. Tik op een toets voor leerstof, eindtermen en hulpmiddelen. Daaronder de vakinleiding en studie-inleiding, en een knop om het PTA van het vak te delen (WhatsApp, mail).
- **Toetsweken**: alle toetsen van één afnamemoment in een studie, per dag als ze in het toetsrooster zijn ingepland. Schrijfwijzen als TW1, tw 1 en Toetsweek 1 worden samengenomen.
- **Zoeken**: in omschrijving, leerstof, eindtermen en hulpmiddelen van alle toetsen, ook op vakcode, kolomnummer of afnamemoment.
- **Logboek** (onder Meer): wie wat wanneer heeft gewijzigd, te filteren op studie en soort. Tik op een wijziging om de toets te openen.

De statussen, controles en kolomnummers worden berekend met **dezelfde code als e-PTA zelf** (`model.js`). Wat de app toont, klopt dus met het dashboard.

De gegevens gaan alleen tussen de telefoon en Microsoft. In deze repository staat geen enkel gegeven van school.

## Bestanden

| Bestand | Wat |
|---|---|
| `index.html` | de app |
| `model.js` | rekenkern, automatisch overgenomen uit `Porteum_e-PTA.html` |
| `werk_model_bij.py` | haalt `model.js` opnieuw uit e-PTA na een nieuwe versie |
| `manifest.webmanifest`, `sw.js`, `icon-*.png` | nodig om de app te installeren en offline te openen |

## 1. Op GitHub Pages zetten

1. Maak op github.com (account **wilfred0109**) een repository, bijvoorbeeld `e-PTA-Mobile`.
   Let op: GitHub Pages werkt bij een gratis account alleen met een **publieke** repository. Daarmee is ook de code van `model.js` openbaar. Wil je dat niet, dan heb je GitHub Pro nodig (privé-repository met Pages).
2. Upload alle bestanden uit deze map (**Add file › Upload files**).
3. Ga naar **Settings › Pages**, kies bij *Source* **Deploy from a branch**, branch `main`, map `/ (root)`, en **Save**.
4. Na een minuut staat de app op `https://wilfred0109.github.io/e-PTA-Mobile/`.

## 2. App-registratie in Microsoft Entra ID

Nodig om het bestand rechtstreeks uit Teams/SharePoint te lezen. Stem eerst met school af of een eigen app-registratie is toegestaan.

1. Ga naar entra.microsoft.com › **Applicaties › App-registraties › Nieuwe registratie**.
2. Naam: `e-PTA Mobile`. Accounttype: *alleen accounts in deze organisatiemap*.
3. Omleidings-URI: platform **Single-page application (SPA)**, adres `https://wilfred0109.github.io/e-PTA-Mobile/`. Je ziet het precieze adres ook in de app onder Instellingen.
4. Na het aanmaken: **API-machtigingen › Machtiging toevoegen › Microsoft Graph › Gedelegeerd › `Files.Read.All`**. `openid`, `profile` en `offline_access` horen er standaard bij.
5. Noteer op de pagina **Overzicht** de *Application (client) ID* en de *Directory (tenant) ID*.

Krijg je bij het inloggen de melding dat een beheerder moet goedkeuren, dan staat toestemming door gebruikers bij Porteum uit. Dan is eenmalige goedkeuring door beheer nodig.

## 3. Installeren op de telefoon (Samsung / Chrome)

1. Open `https://wilfred0109.github.io/e-PTA-Mobile/` in Chrome.
2. Menu (⋮) › **Toevoegen aan startscherm** › **Installeren**.
3. Open de app › **Instellingen**: vul tenant-ID en client-ID in › **Opslaan en inloggen**.
4. Kopieer in Teams de link van het projectbestand: … bij het bestand › **Koppeling kopiëren**. Plak die bij *Projectbestand koppelen* › **Koppelen en ophalen**.

Vanaf dan haalt de app bij het openen de nieuwste stand op, en na elke tik op de ververs-knop rechtsboven. Is het bestand niet gewijzigd, dan wordt het niet opnieuw gedownload. Zonder internet zie je de laatst opgehaalde stand.

Een Microsoft-sessie in een web-app is maximaal 24 uur geldig. Daarna vraagt de app om opnieuw in te loggen, meestal met één tik.

**Testen zonder koppeling**: Instellingen › *Projectbestand openen…* en kies een JSON-bestand. Dat is een momentopname die niet vanzelf ververst.

## 4. Na een nieuwe versie van e-PTA

De app rekent met de code van e-PTA. Na een nieuwe e-PTA-versie:

```
python werk_model_bij.py "C:\pad\naar\Porteum_e-PTA.html"
```

Upload daarna de nieuwe `model.js` naar GitHub. Verhoog in `sw.js` het versienummer (bijvoorbeeld `epta-mobile-1.1` → `epta-mobile-1.2`), zodat telefoons de nieuwe code ophalen. Onder Instellingen staat met welke e-PTA-versie de app rekent.

Werkt het na een update niet, dan is waarschijnlijk de opbouw van het projectbestand of een functienaam in e-PTA veranderd. De app gebruikt uit e-PTA: `migreer`, `valideerProject`, `standVanZaken`, `vakStatus`, `berekenKolomnummers`, `sorteerRijen`, `mapToetsvorm`, `kolomkopVoor`, `deadlineTekst`, `studieInfo` en `Kern.zonderOpmaak`.
