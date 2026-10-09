const translations = {
  fi: {
    nav_features: "Ominaisuudet",
    nav_install: "Asennus",
    nav_privacy: "Yksityisyys",
    hero_eyebrow: "Tampermonkey-lisäosa opettajalle",
    hero_title: "Kerää OmaAbitti-tulokset.<br>Laske kurssiarvosanat.",
    hero_lead: "ArviointiApina lisää OmaAbitin päälle paikallisesti toimivan arvosanatyökalun. Voit tuoda koetulokset, yhdistää useita arviointeja painotuksilla, käsitellä opiskelijakohtaisia poikkeuksia ja kopioida lopulliset arvosanat sinne missä niitä tarvitset.",
    hero_install: "Asenna userscript",
    hero_source: "Avaa lähdekoodi",
    hero_fine: "Vaatii Tampermonkeyn tai muun yhteensopivan userscript-managerin.",
    mock_import: "TUO OMAABITISTA",
    mock_gradebook: "ARVIOINTIKIRJA",
    mock_export: "VIE TIEDOT",
    table_student: "Opiskelija",
    table_weighted: "Painotettu",
    table_grade: "Arvosana",
    features_eyebrow: "Toiminnot",
    features_title: "Käytännöllinen työnkulku OmaAbitti-arviointiin",
    f1_title: "Tuonti OmaAbitista",
    f1_text: "Lukee opiskelijoiden nimet, sähköpostit ja kokonaispisteet OmaAbitin tarkastelusivulta. Kokeen maksimipisteet pysyvät erillisenä tietona.",
    f2_title: "Useita kursseja",
    f2_text: "Hallitse useita ryhmiä ja kursseja samassa työkalussa ja vaihda niiden välillä nopeasti.",
    f3_title: "Painotetut arvioinnit",
    f3_text: "Anna kokeille, quizzeille ja muille suorituksille eri painotukset ja laske niistä kurssin kokonaisprosentti.",
    f4_title: "Opiskelijakohtaiset poikkeukset",
    f4_text: "Voit poistaa tai muuttaa yksittäisen arvioinnin painoa vain yhdelle opiskelijalle ilman että kurssin oletukset muuttuvat.",
    f5_title: "Nimipohjainen tunnistus",
    f5_text: "Tunnistus tehdään ensisijaisesti nimellä, myös osittaisella tai fuzzy-osumalla, sitten sähköpostilla. OmaAbitin UUID toimii vain viimeisenä vihjeenä.",
    f6_title: "Varmuuskopio ja vienti",
    f6_text: "Vie CSV taulukkolaskentaa varten tai koko tietokanta JSON-varmuuskopiona toiseen selaimeen tai laitteeseen.",
    install_eyebrow: "Asennus",
    install_title: "Kolme vaihetta käyttöön",
    s1_title: "1. Asenna Tampermonkey",
    s1_text: "Asenna Tampermonkey tai muu yhteensopiva userscript-manager selaimeesi.",
    s2_title: "2. Asenna ArviointiApina",
    s2_text: "Avaa alla oleva asennuslinkki ja hyväksy scriptin asennus.",
    s3_title: "3. Avaa OmaAbitti",
    s3_text: "Täysi paneeli avautuu oletuksena OmaAbitin tulossivulla. Muilla sivuilla voit käyttää kompaktia Grades-painiketta.",
    install_cta: "Asenna ArviointiApina.user.js",
    privacy_eyebrow: "Yksityisyys",
    privacy_title: "Paikallinen tallennus oletuksena",
    privacy_text1: "ArviointiApina tallentaa tiedot userscript-managerin paikalliseen tallennustilaan. Työkalu ei vaadi pilvipalvelua eikä lähetä opiskelijatietoja ArviointiApinan palvelimelle.",
    privacy_text2: "Koska aineisto voi sisältää opiskelijoiden arviointitietoja, suojaa selainprofiilisi ja vie vain tarpeelliset varmuuskopiot.",
    roadmap_eyebrow: "Projektin suunta",
    roadmap_title: "Userscript ensin. Selainlaajennus myöhemmin.",
    roadmap_text: "Tämä repo on ensisijaisesti ArviointiApinan Tampermonkey-userscriptin kehityskoti. Chrome-laajennus / standalone-sovellus on mahdollinen myöhempi kehityssuunta, mutta nykyinen pääversio on userscript.",
    footer_link: "Lähdekoodi ja issuet GitHubissa"
  },
  en: {
    nav_features: "Features",
    nav_install: "Install",
    nav_privacy: "Privacy",
    hero_eyebrow: "Tampermonkey userscript for teachers",
    hero_title: "Collect OmaAbitti results.<br>Calculate course grades.",
    hero_lead: "ArviointiApina adds a local-first grading utility on top of OmaAbitti. Import exam totals, combine several assessments with adjustable weights, handle per-student exceptions, and copy final grades where you need them.",
    hero_install: "Install userscript",
    hero_source: "View source",
    hero_fine: "Requires Tampermonkey or another compatible userscript manager.",
    mock_import: "IMPORT OMAABITTI",
    mock_gradebook: "GRADEBOOK",
    mock_export: "EXPORT",
    table_student: "Student",
    table_weighted: "Weighted",
    table_grade: "Grade",
    features_eyebrow: "Features",
    features_title: "A practical workflow for OmaAbitti grading",
    f1_title: "Import from OmaAbitti",
    f1_text: "Reads student names, emails and total scores from the OmaAbitti review page. Maximum exam points remain explicit.",
    f2_title: "Multiple courses",
    f2_text: "Manage several classes and courses in the same local tool and switch between them quickly.",
    f3_title: "Weighted assessments",
    f3_text: "Give exams, quizzes and other work different weights and calculate a weighted course percentage.",
    f4_title: "Per-student exceptions",
    f4_text: "Exclude or reweight an assessment for one student without changing the course defaults.",
    f5_title: "Name-first matching",
    f5_text: "Student identity is matched by exact or fuzzy name first, then email. OmaAbitti UUID is only a last-resort hint.",
    f6_title: "Backup and export",
    f6_text: "Export CSV for spreadsheets or a full JSON backup for moving data to another browser or device.",
    install_eyebrow: "Install",
    install_title: "Get started in three steps",
    s1_title: "1. Install Tampermonkey",
    s1_text: "Install Tampermonkey or another compatible userscript manager in your browser.",
    s2_title: "2. Install ArviointiApina",
    s2_text: "Open the install link below and confirm the script installation.",
    s3_title: "3. Open OmaAbitti",
    s3_text: "The full panel opens by default on the OmaAbitti results page. On other sites you can use the compact Grades button.",
    install_cta: "Install ArviointiApina.user.js",
    privacy_eyebrow: "Privacy",
    privacy_title: "Local-first by default",
    privacy_text1: "ArviointiApina stores data in the local storage of the userscript manager. It does not require a cloud account and does not send student data to an ArviointiApina server.",
    privacy_text2: "Because the data may include student assessment information, protect your browser profile and exported backups appropriately.",
    roadmap_eyebrow: "Project direction",
    roadmap_title: "Userscript first. Browser extension later.",
    roadmap_text: "This repository is primarily the development home of the ArviointiApina Tampermonkey userscript. A Chrome extension / standalone app may follow later, but the current primary version is the userscript.",
    footer_link: "Source code and issues on GitHub"
  }
};

function applyLanguage(lang) {
  const selected = translations[lang] ? lang : "fi";
  localStorage.setItem("aa_site_lang", selected);
  document.documentElement.lang = selected;

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    const value = translations[selected][key];
    if (value === undefined) return;
    if (value.includes("<br>")) el.innerHTML = value;
    else el.textContent = value;
  });

  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.lang === selected);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  applyLanguage(localStorage.getItem("aa_site_lang") || "fi");
  document.querySelectorAll(".lang-btn").forEach((btn) => {
    btn.addEventListener("click", () => applyLanguage(btn.dataset.lang));
  });
});