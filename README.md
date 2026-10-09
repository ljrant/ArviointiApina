# ArviointiApina

ArviointiApina on ensisijaisesti **Tampermonkey-userscript** opettajan OmaAbitti-arvioinnin ja kurssiarvosanojen hallintaan.

## Pääprojekti: Tampermonkey-userscript

Asenna nykyinen versio:

https://raw.githubusercontent.com/ljrant/ArviointiApina/main/userscript/ArviointiApina.user.js

Projektin esittelysivu:

https://ljrant.github.io/ArviointiApina/

Sivun oletuskieli on suomi ja englannin voi valita FI / EN -valitsimesta.

### Nykyiset tavoitteet

- kerää kokonaispisteet OmaAbitin tarkastelusivuilta
- hallitse useita kursseja ja ryhmiä
- tunnista opiskelijat ensisijaisesti normalisoidulla tai fuzzy-nimiosumalla, sitten sähköpostilla
- käytä OmaAbitin UUID:tä vain viimeisenä vihjeenä, koska se voi vaihtua kokeiden välillä
- tallenna saadut pisteet ja arvioinnin erilliset maksimipisteet
- painotetut arvioinnit ja opiskelijakohtaiset painopoikkeukset / poissulut
- suomalainen 4–10- ja IB 1–7 -arviointiasteikko
- CSV-vienti ja täydellinen JSON-varmuuskopio / palautus
- kompakti arvosanapaneeli käytettäväksi myös muilla verkkosivuilla

## Repon rakenne

- `userscript/ArviointiApina.user.js` — ensisijainen Tampermonkey-userscript
- `web/` — userscriptin esittely- ja asennussivusto
- `src/`, `manifest.json` — kokeellinen Chrome-laajennusprototyyppi
- `.github/workflows/pages.yml` — julkaisee esittelysivuston GitHub Pagesiin

## Selainlaajennus / standalone-sovellus

Repon nykyinen Chrome-laajennuskoodi on kokeellinen. Siitä voidaan myöhemmin kehittää itsenäinen selainlaajennus tai sovellus, mutta userscript on toistaiseksi projektin pääversio.

## Data ja yksityisyys

ArviointiApina toimii local-first-periaatteella. Arviointikirjan tiedot tallennetaan paikallisesti userscript-managerin tallennustilaan. Projekti ei vaadi ArviointiApina-pilvitiliä tai palvelinta.

Opettajan tulee suojata selainprofiili ja viedyt varmuuskopiot asianmukaisesti, koska tiedot voivat sisältää opiskelijoiden arviointitietoja.

## Kehitys

Userscriptin muutokset tehdään tiedostoon `userscript/ArviointiApina.user.js`. Verkkosivusto pidetään esittely-, asennus-, yksityisyys- ja projektitietosivuna eikä erillisenä verkkopohjaisena arviointikirjana.
