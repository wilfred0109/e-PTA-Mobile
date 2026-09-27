"""
werk_model_bij.py  -  haalt de rekenkern uit Porteum_e-PTA.html en zet die in model.js

Gebruik:  python werk_model_bij.py "C:\\pad\\naar\\Porteum_e-PTA.html"
Draai dit na elke nieuwe versie van e-PTA, zodat e-PTA Light precies dezelfde
statussen, controles en kolomnummers berekent als het dashboard.
"""
import re
import sys
from pathlib import Path

START = "/* ===================== VERSIE ====================="
EINDE = "/* ===================== gedeelde bewerk-tabel"


def blok_functie(tekst, kop):
    """geeft de volledige functie vanaf 'kop' tot en met de afsluitende '}' op een eigen regel"""
    i = tekst.find(kop)
    if i < 0:
        raise SystemExit(f"Niet gevonden in e-PTA: {kop}")
    j = tekst.find("\n}\n", i)
    if j < 0:
        raise SystemExit(f"Einde van functie niet gevonden: {kop}")
    return tekst[i:j + 3]


def main():
    if len(sys.argv) < 2:
        raise SystemExit('Gebruik: python werk_model_bij.py "Porteum_e-PTA.html"')
    bron = Path(sys.argv[1])
    tekst = bron.read_text(encoding="utf-8")
    s = tekst.find(START)
    e = tekst.find(EINDE)
    if s < 0 or e < 0 or e < s:
        raise SystemExit("Begin- of eindmarkering niet gevonden; is dit wel Porteum_e-PTA.html?")
    kern = tekst[s:e]
    # regels afkappen tot de laatste volledige regel vóór de eindmarkering
    kern = kern[: kern.rfind("\n") + 1]
    migratie = "\n".join(blok_functie(tekst, k) for k in (
        "function migreer(p) {",
        "function compacteerStempels(p) {",
        "function migreerStatussen(p) {",
    ))
    versie = re.search(r"const VERSIE = '([^']+)'", kern)
    kop = (
        "/* model.js - automatisch overgenomen uit Porteum_e-PTA.html "
        f"({versie.group(1) if versie else 'onbekende versie'}) met werk_model_bij.py.\n"
        "   Niet met de hand bewerken: pas e-PTA aan en draai het script opnieuw. */\n"
    )
    uit = Path(__file__).with_name("model.js")
    uit.write_text(kop + kern + "\n/* ---- migratie (uit de UI-sectie van e-PTA) ---- */\n" + migratie + "\n", encoding="utf-8")
    print(f"model.js bijgewerkt uit {bron.name} ({versie.group(1) if versie else '?'}), {uit.stat().st_size // 1024} kB")


if __name__ == "__main__":
    main()
