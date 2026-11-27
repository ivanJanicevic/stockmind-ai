# Scenariji (zamke) u ulaznim fakturama

Fakture su napravljene po otpremnicama 01–08; cene su dogovorene nabavne cene iz `../nabavne_cene.csv`.
Očekivano = otpremnica / potvrđen prijem i ugovorena cena. Sve ostale stavke se slažu.

| # | Tip | Faktura | Fajl | Red | Artikal | Očekivano | Na fakturi | Razlika |
|---|---|---|---|---|---|---|---|---|
| 1 | Povećana cena | F-OPT-2026-0931 | faktura-04-sokovi.pdf | 1 | Coca-Cola 0,25 l staklo | cena 72,00 (ugovorena) | cena 79,00 | +7,00 RSD/kom (+9,72%) |
| 2 | Količina ne odgovara | F-ZP-2026-01197 | faktura-05-kafa.pdf | 1 | Espresso kafa u zrnu 1 kg | 20 kom (otpremnica/prijem) | 22 kom | razlika +2 kom, 5.880,00 RSD sa PDV |
| 3 | Količina ne odgovara | F-OPT-2026-0988 | faktura-07-sokovi-dopuna.pdf | 3 | Sprite 0,25 l staklo | 48 kom (otpremnica/prijem) | 72 kom | razlika +24 kom, 2.016,00 RSD sa PDV |
| 4 | Količina ne odgovara | F-HS-2026-0412 | faktura-08-pivo.pdf | 1 | Jelen pivo 0,5 l povratna boca | 120 kom (otpremnica/prijem) | 140 kom | razlika +20 kom, 2.880,00 RSD sa PDV |

## Napomene

- Faktura 03 (F-MD-2026-55271) fakturiše 18 kom pavlake, isto kao otpremnica 03. Razlika je u odnosu na narudžbenicu (12), ne na fakturu; to je zamka iz otpremnice, ne iz fakture.
- Poskupljenja kafe (+42% od 10.12.) i mleka (+30% od 12.12.) iz `nabavne_cene.csv` odnose se na decembarske isporuke i ne pojavljuju se u ovim novembarskim fakturama. Zamka sa cenom (Coca-Cola) je namerno van tih artikala da se ne meša.

## Fakture

| Fajl | Broj računa | Za uplatu (RSD) |
|---|---|---|
| faktura-01-kafa-distributer.pdf | F-ZP-2026-01184 | 89.024,00 |
| faktura-02-lokalna-pekara.pdf | R-47/2026 | 8.668,00 |
| faktura-03-zamka-kolicina-rok.pdf | F-MD-2026-55271 | 16.438,00 |
| faktura-04-sokovi.pdf | F-OPT-2026-0931 | 33.408,00 |
| faktura-05-kafa.pdf | F-ZP-2026-01197 | 94.700,00 |
| faktura-06-mleko.pdf | F-MD-2026-55302 | 35.102,80 |
| faktura-07-sokovi-dopuna.pdf | F-OPT-2026-0988 | 28.396,80 |
| faktura-08-pivo.pdf | F-HS-2026-0412 | 67.651,20 |
