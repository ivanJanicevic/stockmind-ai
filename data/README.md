# Promet kase – Kafe „Plava Šolja“ (izmišljeni podaci)

Sintetički izvoz prometa iz ESIR kase za hakaton demo. Svi podaci su izmišljeni.

## Fajlovi

| Fajl | Sadržaj |
|---|---|
| `promet_2026-11-26_do_2026-12-25.csv` | Promet po stavkama računa za 30 dana, 2000 redova |
| `artikli.json` | Šifrarnik: šifra, GTIN, naziv, prodajna cena, PDV oznaka, veza sa stavkom otpremnice |
| `normativi.json` | Potrošnja sirovina po prodatom artiklu (npr. espresso = 7 g kafe) i pretvaranje u jedinice sa otpremnica |
| `scenariji.md` | Evidencija svih namerno ubačenih scenarija |
| `nabavne_cene.csv` | Nabavne (ugovorene) cene po fakturama i količine sa otpremnica, uključujući poskupljenje |
| `troskovi.csv` | Mesečni operativni troškovi okt–dec 2026 |
| `fakture/*.pdf`, `otpremnice/*.pdf` | 7 faktura i 7 otpremnica (faktura/otpremnica 02 – pekara – nije u setu); `fakture/scenariji-fakture.md` opisuje zamke |
| `text/*.txt` | Tekstualni sloj PDF-ova (`scripts/extract-pdf-text.sh`); aplikacija čita ove fajlove |
| `dobavljaci.json` | Matični podaci kupca i dobavljača (PIB, račun, e-mail – izmišljeno) |
| `schema.sql` | Predlog šeme baze (aplikacija je ne koristi) |

## Format CSV-a

Separator `;`, decimalni zarez, UTF-8. Jedan red je jedna stavka jednog fiskalnog računa, pa se isti `pfr_broj_racuna` ponavlja za više artikala. Refundacija je poseban račun (`Promet Refundacija`) sa negativnom količinom i iznosom. Poreske oznake: Ђ = 20%, Е = 10% (samo jogurt). Cene sadrže PDV.

## Pretpostavke

- Period je 26.11.–25.12.2026, jer su sve otpremnice od 26. do 28.11. Artikal se prodaje tek od dana kad je stigao (pivo od 27.11, Sprite/Cockta/sok od jabuke od 28.11), a ne posle isteka roka (Fanta do 18.12, IVI do 22.12, bečka kafa do 19.12 zbog pavlake).
- Biljni napitak sa otpremnice MD-OTP-55271 je istekao na dan isporuke, pa se kapućino ovas prodaje tek od 27.11 iz nove isporuke.
- Kafić ima 16 stolova, ali je broj računa smanjen na oko 28–59 dnevno da bi fajl imao oko 2.000 redova. Vikendi i praznični dani imaju više prometa; ujutru dominira kafa, uveče pivo i sokovi.
- Pekara isporučuje svaki dan; u setu je samo otpremnica 47/2026 za 26.11, pa se pecivo poredi sa otpremnicom samo za taj dan (prodaja je ispod isporuke). Za ostale dane dnevna prodaja peciva ne prelazi tu istu dnevnu količinu.
- Sve ostale flaširane stavke i sirovine prodate su u manjoj količini nego što je isporučeno, osim zamke.

## Ubačeni scenariji

Tačna evidencija (redovi, računi, nedeljni zbirovi, cene i marže) je u `scenariji.md`. Sve brojke ispod aplikacija sama računa iz podataka (`src/analytics.ts`), a testovi u `test/analytics.test.ts` ih proveravaju. Ukratko:

1. Schweppes Tonic prodat preko isporučene količine (detalji ispod).
2. Karamel latte (106) sa opadajućom prodajom iz nedelje u nedelju, uz nepromenjenu cenu.
3. Poskupljenje kafe (+42%) i mleka (+30%) od 10. i 12.12, u `nabavne_cene.csv`.
4. Rast operativnih troškova u decembru (kirija, struja, provizija kartica, servis aparata), u `troskovi.csv`. Zajedno sa poskupljenjem, procena mesečnog rezultata pada sa 30.079,68 na -16.998,72 RSD (bruto marža po danu × 30 − fiksni troškovi meseca bez PDV-a; period podeljen na dan prvog poskupljenja, 10.12).

## Zamka: Schweppes Tonic

**Schweppes Tonic 0,25 (207): isporučeno 24, prodato 28 (4 više nego što je ikad stiglo).** Prvi račun koji prelazi stanje: `AB12CD34-EF56GH78-2193`, 2026-12-24 u 13:41:04. Agent koji proverava zalihe prema otpremnicama treba ovo da uhvati.

## Kontrolni zbirovi (ceo period)

| Stavka | Vrednost |
|---|---|
| Redova | 2000 |
| Računa prodaje | 1196 |
| Računa refundacije | 13 |
| Prodaja (RSD) | 536.540,00 |
| Refundacije (RSD) | -3.420,00 |
| **Neto promet sa PDV (RSD)** | **533.120,00** |
| Ђ 20%: promet / osnovica / PDV | 530.120,00 / 441.766,67 / 88.353,33 |
| Е 10%: promet / osnovica / PDV | 3.000,00 / 2.727,27 / 272,73 |
| Kartica | 313.710,00 |
| Gotovina | 219.410,00 |

PDV je izračunat iz zbira po oznaci (iznos × stopa / (100 + stopa)), zaokružen na 2 decimale.

## Po danu

Dnevne zbirove računa aplikacija iz `promet_2026-11-26_do_2026-12-25.csv` (raniji ručni zbirovi po danu nisu odgovarali fajlu, pa su uklonjeni).

## Refundacije

| Datum | Vreme | Refundacija | Originalni račun | Artikal | Iznos |
|---|---|---|---|---|---:|
| 2026-11-26 | 09:25:52 | AB12CD34-EF56GH78-1051 | AB12CD34-EF56GH78-1049 | Kapućino | -260,00 |
| 2026-11-27 | 17:44:20 | AB12CD34-EF56GH78-1111 | AB12CD34-EF56GH78-1110 | Schweppes Bitter Lemon 0,25 | -300,00 |
| 2026-11-30 | 16:58:03 | AB12CD34-EF56GH78-1250 | AB12CD34-EF56GH78-1249 | Espresso bez kofeina | -220,00 |
| 2026-12-01 | 20:31:49 | AB12CD34-EF56GH78-1280 | AB12CD34-EF56GH78-1279 | Espresso | -200,00 |
| 2026-12-05 | 19:51:36 | AB12CD34-EF56GH78-1445 | AB12CD34-EF56GH78-1441 | Domaća kafa | -180,00 |
| 2026-12-06 | 14:44:06 | AB12CD34-EF56GH78-1479 | AB12CD34-EF56GH78-1477 | Kafa latte | -290,00 |
| 2026-12-07 | 11:01:36 | AB12CD34-EF56GH78-1516 | AB12CD34-EF56GH78-1515 | Espresso | -200,00 |
| 2026-12-11 | 17:42:35 | AB12CD34-EF56GH78-1663 | AB12CD34-EF56GH78-1662 | Kapućino | -260,00 |
| 2026-12-14 | 19:48:04 | AB12CD34-EF56GH78-1808 | AB12CD34-EF56GH78-1806 | Lav 0,33 | -320,00 |
| 2026-12-20 | 20:50:03 | AB12CD34-EF56GH78-2059 | AB12CD34-EF56GH78-2056 | Energetsko piće 0,25 | -350,00 |
| 2026-12-22 | 16:28:33 | AB12CD34-EF56GH78-2132 | AB12CD34-EF56GH78-2131 | Kapućino | -260,00 |
| 2026-12-23 | 18:45:47 | AB12CD34-EF56GH78-2171 | AB12CD34-EF56GH78-2170 | Lav 0,33 | -320,00 |
| 2026-12-25 | 07:46:47 | AB12CD34-EF56GH78-2210 | AB12CD34-EF56GH78-2209 | Kapućino | -260,00 |

Veza refundacije sa originalnim računom nije u CSV-u (kao ni u formatu primera); data je samo ovde.
