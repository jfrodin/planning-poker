# Planning Poker

[Repo](https://github.com/jfrodin/planning-poker) · [Senaste release](https://github.com/jfrodin/planning-poker/releases/latest)

En liten app för teamets refinement. Inga konton eller databas. Kör på en dator och dela ett slumpmässigt rum med kollegorna, även hemifrån via en tillfällig HTTPS-tunnel.

## Kom igång

Node.js **22.13 eller senare** behövs.

```sh
npm ci
npm run build
npm run share
```

`share` hämtar cloudflared från [Cloudflares officiella GitHub-release](https://github.com/cloudflare/cloudflared/releases) vid första körningen, kontrollerar dess SHA-256-checksumma, startar appen och skapar en publik länk. Öppna länken, skriv ditt namn och skapa ett rum. Klicka på **Dela rumslänk** och dela rumslänken. Kollegorna behöver bara en webbläsare.

Håll datorn vaken och terminalen öppen under mötet. Ctrl+C stoppar tunneln och den server som kommandot startade. Om servern startas om försvinner rummen och ni behöver skapa ett nytt rum. CSV-filer som redan sparats finns kvar.

Cloudflare Quick Tunnels är tillfälliga och saknar tillgänglighetsgaranti. Adressen ändras vid varje start. Ingen routerkonfiguration eller Cloudflare-inloggning behövs. Arbetsnätverket måste tillåta utgående tunneltrafik. Se [Cloudflares dokumentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

Om cloudflared redan är installerat kan du ange `CLOUDFLARED_BIN=/sökväg/till/cloudflared`.

## Kör lokalt

```sh
npm run build
npm start
```

Öppna http://localhost:3000. För lokal utveckling, med automatisk uppdatering:

```sh
npm run dev
```

Stoppa utvecklingsservern innan `npm run share`. Den publika tunneln använder produktionsservern.

## Så fungerar en omgång

1. Facilitatorn skapar ett rum och delar rumslänken.
2. Kollegorna skriver sitt namn och ansluter utan konto.
3. Facilitatorn skriver uppgiftens namn och väljer **Starta uppgift**.
4. Alla väljer ett kort. Kort kan ändras eller tas tillbaka tills facilitatorn väljer **Visa korten**. Värdena hålls på servern fram till avslöjandet.
5. Diskutera och använd **Rösta om** vid behov.
6. Facilitatorn väljer det överenskomna estimatet och klickar **Spara & gå vidare**.

Kort: 1, 2, 3, 5, 8, 13, 21, ? (osäker), ☕ (paus). Tangenterna 1–7 väljer motsvarande kortplats; ? och C väljer specialkorten. Facilitatorn röstar också. Ingen automatisk medelvärdesberäkning används för det slutliga estimatet.

Samma webbläsare återansluter efter omladdning. Facilitatorns privata nyckel sparas i den webbläsarens lokala lagring och ingår aldrig i den delade länken. Öppna ett privat fönster för att testa som en annan person på samma dator. Om facilitatorn lämnar kan hen komma tillbaka via samma rumslänk i samma webbläsare. En annan enhet eller en rensad webbläsare kan inte ta över facilitatorrollen.

## CSV-sparning

Varje serverstart skapar en ny `sessions/session-<UTC-tid>-<slump>.csv`, även om inga estimat sparas. Varje **Spara & gå vidare** skriver en rad och synkar filen till disk innan omgången återställs. Vid skrivfel behålls uppgiften och rösterna så att ni kan försöka igen.

Filen innehåller tidpunkt (UTC), rums-id, uppgiftsnamn och slutligt estimat. Alla rum på samma server delar sessionsfil. Individuella röster och personnamn skrivs inte till filen. **Hämta estimat som CSV** laddar ned bara det aktuella rummets sparade estimat.

CSV använder UTF-8 med BOM, semikolon och citerade fält för Excel. Fält med inledande formeltecken skyddas med en apostrof. Sessionsfiler och lokalt hämtade verktyg är git-ignorerade.

## Konfiguration

| Variabel | Standard | Funktion |
| --- | --- | --- |
| `PORT` | `3000` | Appens ingång och tunnelns mål |
| `HOST` | `127.0.0.1` | Använd `0.0.0.0` om datorer på LAN ska kunna nå appen direkt |
| `FRONTEND_PORT` | `3100` | Endast för `npm run dev`; separat utvecklingsserver |
| `DATA_DIR` | `sessions` | Katalog för sessionsfiler |
| `CLOUDFLARED_BIN` | `.runtime/cloudflared` | Egen cloudflared-installation |

Endast appens ingång behöver exponeras. En rumslänk är åtkomst till rummet; dela den med teamet. Det finns inga användarkonton. Alla rum och anslutningar finns i en enda Node-process och försvinner vid omstart. Det räcker för ett team; flera serverinstanser skulle kräva gemensam rumsstate.

## Verifiering

```sh
npm test
npm run check
npm run build
npm run test:production
```

Tester använder riktiga HTTP- och WebSocket-anslutningar för flera deltagare och kontrollerar privata röster, behörigheter, återanslutning, rumsisolering, CSV-sparning och fel vid filsparning.

## Hosting senare

Samma app kan köras som en Node-process på exempelvis en AWS-server, bakom en reverse proxy med HTTPS och stöd för WebSocket-upgrade på `/socket`. Peka proxyn på `PORT` och ge `DATA_DIR` en beständig disk om CSV ska överleva att servern byts ut. Ingen tunnel behövs när appen har en egen publik adress.

## Dela som ett färdigt paket

Bara värden behöver paketet; alla andra använder rumslänken.

```sh
npm run package:windows
npm run package:mac
```

Kommandona använder det befintliga produktionsbygget i `dist`. Bygg om först om gränssnittet har ändrats. Stoppa produktionsservern innan `npm run build`, och starta den igen efteråt; en server som kör kvar med gamla moduler kan annars peka på JavaScript-filer som har ersatts.

ZIP-filerna hamnar i `outputs`. Windows-paketet är för Windows 10/11 x64. Mac-paketet byggs för samma processor som byggdatorn (Apple Silicon eller Intel). Node och cloudflared ingår, tillsammans med deras licenser. Hämtade Windows-binärer verifieras mot officiella SHA-256-kontrollsummor. Windows-specifika npm-bibliotek installeras separat i arbetsmappen.

Mottagaren packar upp hela mappen och dubbelklickar på **Starta.cmd** (Windows) eller **Starta.command** (Mac). Appen väljer lediga lokala portar, öppnar webbläsaren och skapar en Cloudflare-länk. **Starta-lokalt** använder bara den egna datorn. Ingen Node- eller npm-installation behövs. Fönstret måste vara öppet under mötet; Ctrl+C avslutar sessionen. CSV-filer sparas i `sessions` i den uppackade mappen.

Paketet innehåller inga befintliga sessioner, privata rumsnycklar eller miljöfiler. Det är ett portabelt ZIP-paket med startfil, och är inte signerat som en installerad skrivbordsapp. Företagets Windows-policy kan därför kräva att IT godkänner körningen. Releaseflödet testar paketet på en Windows-runner. Företagets säkerhetsdialoger och regler kan ändå behöva kontrolleras på mottagarens dator.

Produktionsappen använder en enda port för gränssnitt, HTTP-API och WebSocket. Öppna bara adressen som skrivs ut av Planning Poker. Version 0.1.0 visade även en separat gränssnittsadress där formuläret syntes men skapa-rum-anropet saknade API; detta är åtgärdat i 0.1.1.

## GitHub och releaser

Repot är privat under `jfrodin/planning-poker`. Kollegor kan hämta färdiga ZIP-filer under **Releases** när de har åtkomst till repot. Sessionsfiler, lokala verktyg, byggen och ZIP-filer är git-ignorerade.

Vid push till `main` och vid pull requests kör GitHub Actions typkontroll, tester, produktionsbygge och API-test på Windows. En versionstagg, exempelvis `v0.1.2`, kör dessutom paketeringen på Windows, packar upp ZIP-filen och testar `Starta-lokalt.cmd` med den medföljande Node-versionen. Testet skapar ett rum, ansluter en deltagare och verifierar WebSocket utan att starta en publik tunnel.

Om alla kontroller lyckas skapas en GitHub Release med Windows-paketet, en SHA-256-kontrollsumma och automatiska versionsanteckningar. GitHub använder workflowets inbyggda token; inget separat publiceringslösenord behövs. Versionsnumret i taggen måste matcha `package.json`.

För en ny version, utgå från uppdaterad `main`:

```sh
npm version patch -m "Release v%s"
git push origin main --follow-tags
```

Det uppdaterar `package.json` och låsfilen och skapar en commit och en versionstagg. Använd `npm version minor` för en större funktionsversion. Paketet får samma versionsnummer i filnamnet. Återanvänd inte en publicerad versionstagg; skapa en ny version för nästa ändring.

Det första uppladdningssteget görs efter GitHub-inloggning. Exempel för ett nytt privat repo:

```sh
gh auth login
gh repo create planning-poker --private --source=. --remote=origin --push
```

Arbetsflödena ligger i `.github/workflows`. Första releasen, `v0.1.1`, har byggts, paketerats och funktionstestats på Windows i GitHub Actions. GitHub Releases distribuerar paketet; själva planning poker-sessionen körs fortfarande på värdens dator.
