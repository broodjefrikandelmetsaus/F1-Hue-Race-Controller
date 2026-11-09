# F1 Hue Race Controller

Een replay-first webapp om historische Formule 1-sessies te laden, race-events op een tijdlijn te bekijken en effecten te synchroniseren met het terugkijken.

## Huidige bouw (v0.2.0)

- Seizoenen 2023 t/m huidig jaar laden via OpenF1.
- Grand Prix-weekends en sessies selecteren.
- Race Control-signalen, pitstops, inhaalacties, bandensets, snelste ronde en uitslagen ophalen waar de databron ze heeft.
- Replay-tijdlijn met start/pauze/reset, event-scrubbing en buffer-offset van -10 tot +10 seconden.
- Visuele previews voor vlag-effecten en Red Bull-standby.
- Instellingen voor buffer-offset en standby worden lokaal opgeslagen.

## Nog in ontwikkeling

- Philips Hue Remote API OAuth + daadwerkelijke lampaansturing.
- Per event effecten/kleur aanpassen en per lamp selecteren.
- Supabase-login en synchronisatie van instellingen tussen apparaten.
- Extra eventbronnen en kwaliteitscontrole van de dekking.

**Let op:** de huidige versie toont lichteffecten als scherm-preview; ze sturen nog geen fysieke Hue-lampen aan. De Hue-koppeling wordt pas als actief getoond zodra de OAuth-flow en veilige tokenopslag af zijn.

## Data en grenzen

De app gebruikt de onofficiële OpenF1 API. Gratis historische data is volgens OpenF1 beschikbaar vanaf 2023. Eventdekking verschilt per sessie en endpoint; sommige gegevens (zoals inhaalacties) kunnen onvolledig zijn. Ontbrekende data wordt niet verzonnen.

OpenF1: https://openf1.org/

## Publiceren via GitHub Pages

1. Open **Settings → Pages** in deze repository.
2. Kies **GitHub Actions** als Build and deployment source.
3. De workflow in `.github/workflows/deploy-pages.yml` bouwt en publiceert de site na een push naar `main`.
4. De website staat daarna op: https://broodjefrikandelmetsaus.github.io/F1-Hue-Race-Controller/

## Status

De GitHub Pages-workflow mag Pages automatisch inschakelen wanneer dit nog niet is gebeurd.

## Lokale test

Open `index.html` via een eenvoudige lokale webserver (bijvoorbeeld VS Code Live Server). De API vraagt een internetverbinding.
