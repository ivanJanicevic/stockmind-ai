# Evidencija ubačenih scenarija (izmišljeni podaci)

Ovde je tačno zapisano šta je namerno ubačeno u podatke i gde se to vidi. Brojevi redova su linije u fajlu, a zaglavlje je red 1. Svi brojevi su izračunati skriptom iz samih fajlova.

## 1. Schweppes Tonic prodat preko isporuke

Fajlovi: `promet_2026-11-26_do_2026-12-25.csv`, `otpremnice/otpremnica-04-sokovi.pdf`.

Isporučeno je 24 kom (OPT-2026-11-0931, šifra OPT-STW-025), a neto prodato 28, što je 4 više. Prvi red preko stanja je **red 1905**: račun `AB12CD34-EF56GH78-2193`, 2026-12-24 u 13:41:04, kumulativno 25.

| Red | Datum | Vreme | Račun | Kol. | Kumulativno |
|---:|---|---|---|---:|---:|
| 1905 | 2026-12-24 | 13:41:04 | AB12CD34-EF56GH78-2193 | 1 | 25 |
| 1911 | 2026-12-24 | 15:14:18 | AB12CD34-EF56GH78-2198 | 1 | 26 |
| 1962 | 2026-12-25 | 15:12:31 | AB12CD34-EF56GH78-2229 | 1 | 27 |
| 1991 | 2026-12-25 | 20:44:22 | AB12CD34-EF56GH78-2246 | 1 | 28 |

Sve prodaje ovog artikla (28 redova) su u `promet_2026-11-26_do_2026-12-25.csv` (šifra 207).

## 2. Karamel latte (106) sa opadajućom prodajom

Fajl: `promet_2026-11-26_do_2026-12-25.csv`. Cena je ista ceo period (330,00 RSD), pada samo potražnja.

| Nedelja | Period | Količina | Redova | Prvi red | Poslednji red |
|---:|---|---:|---:|---:|---:|
| 1 | 26.11–02.12 | 39 | 35 | 79 | 452 |
| 2 | 03.12–09.12 | 27 | 27 | 474 | 886 |
| 3 | 10.12–16.12 | 22 | 22 | 932 | 1389 |
| 4 | 17.12–23.12 | 7 | 7 | 1411 | 1839 |
| 5 | 24.12–25.12 (2 dana) | 0 | 0 | – | – |

Pad od 1. do 4. nedelje je -82.1%. Poslednja prodaja je u redu 1839 (2026-12-23); u poslednja 2 dana nema prodaje.

## 3. Poskupljenje dobavljača

Fajlovi: `nabavne_cene.csv` (cene), `normativi.json` i `artikli.json` (za maržu). Prodajne cene se ne menjaju.

| Artikal | Stara cena (red, faktura) | Nova cena (red, faktura, datum) | Rast |
|---|---|---|---:|
| Espresso kafa u zrnu 1 kg | 2.450,00 (red 19, F-ZP-2026-01197) | 3.480,00 (red 45, F-ZP-2026-01262, 2026-12-10) | +42.04% |
| Domaća kafa mlevena 200 g | 290,00 (red 21, F-ZP-2026-01197) | 380,00 (red 46, F-ZP-2026-01262, 2026-12-10) | +31.03% |
| Mleko trajno 2,8% m.m. 1 l | 138,00 (red 27, F-MD-2026-55302) | 179,00 (red 47, F-MD-2026-55390, 2026-12-12) | +29.71% |
| Mleko za barista 3,5% 1 l | 175,00 (red 28, F-MD-2026-55302) | 230,00 (red 48, F-MD-2026-55390, 2026-12-12) | +31.43% |

Nove isporuke OT-2026-01262 i MD-OTP-55390 postoje samo kao fakture; za njih nema otpremnice u folderu `otpremnice/`.

Marža po komadu (bez PDV, RSD):

| Artikal | Prodajna | Nabavna pre → posle | Marža pre → posle | Marža % pre → posle |
|---|---:|---:|---:|---:|
| Espresso | 166,67 | 18,75 → 25,96 | 147,92 → 140,71 | 88.75% → 84.42% |
| Makijato | 183,33 | 22,89 → 31,33 | 160,44 → 152,00 | 87.51% → 82.91% |
| Kapućino | 216,67 | 39,45 → 52,81 | 177,22 → 163,86 | 81.79% → 75.63% |
| Kafa latte | 241,67 | 57,25 → 76,56 | 184,42 → 165,11 | 76.31% → 68.32% |
| Karamel latte | 275,00 | 81,78 → 101,09 | 193,22 → 173,91 | 70.26% → 63.24% |
| Kapućino za poneti | 225,00 | 54,45 → 67,81 | 170,55 → 157,19 | 75.8% → 69.86% |
| Domaća kafa | 150,00 | 16,10 → 20,60 | 133,90 → 129,40 | 89.27% → 86.27% |

## 4. Operativni troškovi koji obaraju profitabilnost

Fajl: `troskovi.csv`.

| Kategorija | Novembar (red) | Decembar (red) | Razlika |
|---|---:|---:|---:|
| Kirija | 95.000,00 (12) | 109.250,00 (22) | +14.250,00 |
| Struja | 28.000,00 (14) | 46.000,00 (24) | +18.000,00 |
| Provizija kartice | 4.900,00 (21) | 5.200,00 (31) | +300,00 |
| Održavanje | 0,00 (–) | 18.000,00 (32) | +18.000,00 |
| **Ukupno fiksni** | **298.900,00** | **349.450,00** | **+50.550,00** |

Rezultat (promet bez PDV, nabavna vrednost po normativu i ceni važećoj na dan prodaje):

| | Pre (26.11–09.12) | Posle (10.12–25.12) |
|---|---:|---:|
| Dana | 14 | 16 |
| Promet bez PDV | 204.099,24 | 240.394,70 |
| Nabavna vrednost prodatog | 50.575,39 | 63.087,35 |
| Bruto marža | 153.523,85 (75.22%) | 177.307,35 (73.76%) |
| Bruto marža po danu | 10.965,99 | 11.081,71 |
| Fiksni troškovi meseca | 298.900,00 (nov.) | 349.450,00 (dec.) |
| **Procena mesečnog rezultata** | **30.079,68** | **-16.998,72** |

Procena mesečnog rezultata = bruto marža po danu × 30 − fiksni troškovi tog meseca. Promet po danu je u decembru čak malo veći, ali marža po komadu pada, a fiksni troškovi rastu, pa kafić prelazi iz dobiti u gubitak.
