# ArviointiApina BETA

Tämä haara on kokeellisia ominaisuuksia varten. `main` pysyy vakaana.

## Beta-version asennus

Asenna beta-userscript tästä:

https://raw.githubusercontent.com/ljrant/ArviointiApina/beta/userscript/ArviointiApina.user.js

Beta käyttää eri tallennusavainta kuin vakaa versio:

- vakaa: `arviointiapina_userscript_v1`
- beta: `arviointiapina_userscript_beta_v1`

Näin beta ei vahingossa muuta vakaan version arviointikirjaa. JSON-varmuuskopioilla tietoja voidaan siirtää versioiden välillä tarvittaessa.

## Google Forms -tuki, beta 1

Ensimmäinen toteutus tuo Google Forms -quizien tuloksia CSV-tiedostosta.

Suositeltu työnkulku:

1. Avaa Google Formsin vastaukset tai siihen liitetty Google Sheets -taulukko.
2. Vie vastaukset CSV-muodossa.
3. Avaa ArviointiApina BETA.
4. Valitse Data -> **Import Google Forms CSV (BETA)**.
5. Beta etsii automaattisesti:
   - opiskelijan nimen
   - sähköpostiosoitteen
   - Score / Points / Pisteet -sarakkeen
6. Jos Score sisältää esimerkiksi `8 / 10`, sekä saadut pisteet että maksimipisteet tunnistetaan.
7. Jos maksimipisteitä ei löydy tiedostosta, beta kysyy ne kerran.
8. Opiskelijat yhdistetään nykyisellä turvallisella järjestyksellä:
   - tarkka nimi / alias
   - fuzzy-nimiosuma
   - sähköposti
   - OmaAbitti UUID vain OmaAbitti-tuonnissa viimeisenä vihjeenä

## Miksi CSV ensin?

Google Formsin ja Google Sheetsin editorien DOM-rakenne on pitkälti Googlen sisäistä ja muuttuvaa. Suora sivun raapiminen olisi herkkä rikkoutumaan.

CSV antaa ensin vakaan testipohjan. Kun oikeista quiz-exporteista on nähty riittävästi esimerkkejä, voidaan lisätä:

- Google Sheets -sivun suora tuonti
- Google Forms -vastausten suora tunnistus
- useiden quizien automaattinen yhdistäminen
- kysymyskohtaiset pisteet
- tehtävien / kategorioiden automaattiset painot

## Testauksessa hyödyllistä

Jos CSV ei tunnistu, kirjaa ylös tai lähetä:

- CSV:n otsikkorivi
- esimerkki yhdestä anonymisoidusta opiskelijarivistä
- millä kielellä Google Forms / Sheets on käytössä
- miltä Score/Pisteet-arvo näyttää, esimerkiksi `8 / 10`, `8`, `80 %`

Älä julkaise oikeita opiskelijatietoja GitHub-issueen.
