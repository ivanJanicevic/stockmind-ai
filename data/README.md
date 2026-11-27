# Promet kase – Kafe „Plava Šolja“ (izmišljeni podaci)

Sintetički izvoz prometa iz ESIR kase za hakaton demo. Svi podaci su izmišljeni.

## Fajlovi

| Fajl | Sadržaj |
|---|---|
| `promet_2026-11-26_do_2026-12-25.csv` | Promet po stavkama računa za 30 dana, 2000 redova |
| `artikli.json` | Šifrarnik: šifra, GTIN, naziv, prodajna cena, PDV oznaka, veza sa stavkom otpremnice |
| `normativi.json` | Potrošnja sirovina po prodatom artiklu (npr. espresso = 7 g kafe) i pretvaranje u jedinice sa otpremnica |
| `scenariji.md` | Evidencija namerno ubačenih scenarija i kontrolnih rezultata |
| `nabavne_cene.csv` | Nabavne cene po fakturama (veza sa otpremnicama), uključujući poskupljenje |
| `troskovi.csv` | Mesečni operativni troškovi okt–dec 2026 |
| `fakture/*.pdf` | Sintetičke ulazne fakture dobavljača |
| `otpremnice/*.pdf` | Sintetičke otpremnice sa količinama i rokovima trajanja |

## Format CSV-a

Separator `;`, decimalni zarez, UTF-8. Jedan red je jedna stavka jednog fiskalnog računa, pa se isti `pfr_broj_racuna` ponavlja za više artikala. Refundacija je poseban račun (`Promet Refundacija`) sa negativnom količinom i iznosom. Poreske oznake: Ђ = 20%, Е = 10% (samo jogurt). Cene sadrže PDV.

Tri šifre dobavljača za pekarske proizvode (`ZK-KRO-001`, `ZK-KIF-001`, `ZK-MAF-001`) su sintetičke demo vrednosti dodate jer su polja bila prazna; nisu preuzete iz stvarnih dokumenata.

## Pretpostavke

- Period je 26.11.–25.12.2026, jer su sve otpremnice od 26. do 28.11. Artikal se prodaje tek od dana kad je stigao (pivo od 27.11, Sprite/Cockta/sok od jabuke od 28.11), a ne posle isteka roka (Fanta do 18.12, IVI do 22.12, bečka kafa do 19.12 zbog pavlake).
- Biljni napitak sa otpremnice MD-OTP-55271 je istekao na dan isporuke, pa se kapućino ovas prodaje tek od 27.11 iz nove isporuke.
- Kafić ima 16 stolova, ali je broj računa smanjen na oko 28–59 dnevno da bi fajl imao oko 2.000 redova. Vikendi i praznični dani imaju više prometa; ujutru dominira kafa i pecivo, uveče pivo i sokovi.
- Pekara isporučuje svaki dan; u setu je samo otpremnica 47/2026 za 26.11, pa se pecivo poredi sa otpremnicom samo za taj dan (prodaja je ispod isporuke). Za ostale dane dnevna prodaja peciva ne prelazi tu istu dnevnu količinu.
- Sve ostale flaširane stavke i sirovine prodate su u manjoj količini nego što je isporučeno, osim zamke.

## Ubačeni scenariji

Tačna evidencija (redovi, računi, nedeljni zbirovi, cene i marže) je u `scenariji.md`. Ukratko:

1. Schweppes Tonic prodat preko isporučene količine (detalji ispod).
2. Karamel latte (106) sa opadajućom prodajom iz nedelje u nedelju, uz nepromenjenu cenu.
3. Poskupljenje kafe (+42%) i mleka (+30%) od 10. i 12.12, u `nabavne_cene.csv`.
4. Rast operativnih troškova u decembru (kirija, struja, servis aparata), u `troskovi.csv`.

## Zamka: Schweppes Tonic

**Schweppes Tonic 0,25 (207): isporučeno 24, prodato 28 (4 više nego što je ikad stiglo).** Prvi račun koji prelazi stanje: `AB12CD34-EF56GH78-2193`, 2026-12-24 u 13:41:04. Agent koji proverava zalihe prema otpremnicama treba ovo da uhvati.

## Kontrolni zbirovi (ceo period)

| Stavka | Vrednost |
|---|---|
| Redova | 2000 |
| Računa prodaje | 1196 |
| Računa refundacije | 13 |
| Prodaja (RSD) | 532.700,00 |
| Refundacije (RSD) | -3.420,00 |
| **Neto promet sa PDV (RSD)** | **529.280,00** |
| Ђ 20%: promet / osnovica / PDV | 527.780,00 / 439.816,67 / 87.963,33 |
| Е 10%: promet / osnovica / PDV | 1.500,00 / 1.363,64 / 136,36 |
| Kartica | 311.440,00 |
| Gotovina | 217.840,00 |

PDV je izračunat iz zbira po oznaci (iznos × stopa / (100 + stopa)), zaokružen na 2 decimale.

## Po danu

| Datum | Računa | Refund. | Prodaja | Refundacije | Neto |
|---|---:|---:|---:|---:|---:|
| 2026-11-26 | 42 | 1 | 14.070,00 | -260,00 | 13.810,00 |
| 2026-11-27 | 44 | 1 | 19.760,00 | -300,00 | 19.460,00 |
| 2026-11-28 | 50 | 0 | 23.900,00 | 0,00 | 23.900,00 |
| 2026-11-29 | 47 | 0 | 21.920,00 | 0,00 | 21.920,00 |
| 2026-11-30 | 29 | 1 | 12.270,00 | -220,00 | 12.050,00 |
| 2026-12-01 | 31 | 1 | 15.800,00 | -200,00 | 15.600,00 |
| 2026-12-02 | 41 | 0 | 18.590,00 | 0,00 | 18.590,00 |
| 2026-12-03 | 31 | 0 | 13.110,00 | 0,00 | 13.110,00 |
| 2026-12-04 | 47 | 0 | 20.920,00 | 0,00 | 20.920,00 |
| 2026-12-05 | 48 | 1 | 20.360,00 | -180,00 | 20.180,00 |
| 2026-12-06 | 42 | 1 | 18.930,00 | -290,00 | 18.640,00 |
| 2026-12-07 | 39 | 1 | 17.540,00 | -200,00 | 17.340,00 |
| 2026-12-08 | 28 | 0 | 12.420,00 | 0,00 | 12.420,00 |
| 2026-12-09 | 36 | 0 | 15.060,00 | 0,00 | 15.060,00 |
| 2026-12-10 | 36 | 0 | 15.930,00 | 0,00 | 15.930,00 |
| 2026-12-11 | 43 | 1 | 19.900,00 | -260,00 | 19.640,00 |
| 2026-12-12 | 59 | 0 | 26.800,00 | 0,00 | 26.800,00 |
| 2026-12-13 | 41 | 0 | 19.650,00 | 0,00 | 19.650,00 |
| 2026-12-14 | 30 | 1 | 13.880,00 | -320,00 | 13.560,00 |
| 2026-12-15 | 33 | 0 | 15.060,00 | 0,00 | 15.060,00 |
| 2026-12-16 | 36 | 0 | 18.200,00 | 0,00 | 18.200,00 |
| 2026-12-17 | 44 | 0 | 23.010,00 | 0,00 | 23.010,00 |
| 2026-12-18 | 46 | 0 | 20.320,00 | 0,00 | 20.320,00 |
| 2026-12-19 | 48 | 0 | 19.490,00 | 0,00 | 19.490,00 |
| 2026-12-20 | 47 | 1 | 18.730,00 | -350,00 | 18.380,00 |
| 2026-12-21 | 35 | 0 | 14.880,00 | 0,00 | 14.880,00 |
| 2026-12-22 | 39 | 1 | 15.870,00 | -260,00 | 15.610,00 |
| 2026-12-23 | 33 | 1 | 15.540,00 | -320,00 | 15.220,00 |
| 2026-12-24 | 29 | 0 | 11.150,00 | 0,00 | 11.150,00 |
| 2026-12-25 | 42 | 1 | 19.640,00 | -260,00 | 19.380,00 |

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

Veza refundacije sa originalnim računom nije u CSV-u (kao ni u formatu primera); pojedinačni slučajevi su opisani u `scenariji.md`.
