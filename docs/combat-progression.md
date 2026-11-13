# Progresja trudności walki, broni i statystyk

Propozycja projektowa zapisana 12 listopada 2026. Parametry są punktem wyjścia do sprawdzenia w balansie, nie zweryfikowanymi wynikami symulacji ani zmianą obecnych definicji gry. Dokument rozwija [scenariusze pierwszych pięciu rozdziałów](first-five-chapters.md), opierając się na układzie Atak / Obrona / Przygotowanie z [alternatywnej walki](alternative-combat.md).

## Główne założenie

Kolejni wrogowie wymagają coraz lepszego czytania ich zachowania, a mocniejsze bronie pozwalają szybciej kończyć walkę. Samo podnoszenie HP przeciwników prowadziłoby do powtarzania tych samych ruchów.

Obrona kosztuje Energię, a Przygotowanie wzmacnia następny atak albo pozwala przełamać obronę. Różnice między przeciwnikami powinny zmieniać opłacalność tych decyzji.

## Pierwsze pięć rozdziałów

Obrażenia w tabeli oznaczają obrażenia po trafieniu, przed obroną. Nazwy przeciwników i ich umiejscowienie są propozycjami. Parametry zakładają rozwój wyposażenia opisany niżej; wymagają osobnego sprawdzenia dla gracza bez opcjonalnej broni.

| Etap / przeciwnik | Proponowane parametry | Charakter walki i nowa umiejętność gracza |
| --- | --- | --- |
| 1. Szczur — Przebudzenie | 5–6 HP; ugryzienie 1–2, szarża 3 | Krótkie wprowadzenie. Przewaga zwykłych ataków, sporadyczne przygotowanie. Uczy, że czasem warto wydać Energię na obronę, a czasem zaryzykować dobicie. |
| 2. Zdziczałe zwierzę — okolice ochrony | 8–9 HP; atak 2, szarża 4 | Agresor: przygotowanie częściej prowadzi do szarży niż uniku. Uczy oszczędzania Energii na groźne momenty. Wrażliwy na szybkie, zdecydowane atakowanie. |
| 3. Zmieniony pracownik — Recepcja | 10–12 HP; atak 2–3, szarża 4 | Ostrożniejszy przeciwnik, częściej broni się po przygotowaniu. Uczy przygotowanego ataku przełamującego obronę. Bezmyślne atakowanie wydłuża walkę. |
| 4. Zmutowany mechanik — Maszynownia | 13–15 HP; atak 3, mocny cios 5 | Powolny, czytelny cykl: atak → przygotowanie → odpoczynek. Uczy planowania dwóch ruchów naprzód i wykorzystywania bezpiecznego okna. |
| 5. Masywny zmieniony — Garaż | 17–20 HP; atak 3, szarża 5–6 | Sprawdza obronę, przełamanie i dobicie. Ma rozpoznawalny rytm oraz okazje do kontrataku. Otoczenie może pozwolić osłabić go przed walką. |

Wieżyczka w rozdziale ochrony pozostaje osobnym zagrożeniem środowiskowym: można ją obejść, odłączyć zasilanie lub odwrócić jej uwagę. Nie każdy problem wymaga odejmowania HP. Zgodnie ze scenariuszami wymagany postęp nie powinien zależeć od znalezienia opcjonalnej broni; garaż może zakończyć się również uniknięciem lub odizolowaniem zagrożenia.

## Zachowania dostępne w obecnej mechanice

Stan sprawdzony w kodzie edytora, koordynatora walki i walidacji 12 listopada 2026; bez dodatkowej próby w interfejsie. Szczegóły konfiguracji przygotowanych odpowiedzi opisuje [alternatywna walka](alternative-combat.md).

W **Library → Enemy → Combat Actions** można już ustawić:

| Możliwość | Zastosowanie i ograniczenia |
| --- | --- |
| **Action selection: Order** | Akcje wykonywane od góry do dołu, potem cykl się powtarza. Pozwala ustawić przewidywalny rytm ataków, przygotowania i odpoczynku. |
| **Action selection: Random** i **Random weight** | Losowanie normalnej akcji według stałych wag. Pozwala tworzyć agresywnych lub ostrożnych wrogów. Wagi nie zmieniają się automatycznie wraz z sytuacją w walce. |
| **Attack / Defend / Prepare / Wait** | Atak, obrona, przygotowanie odpowiedzi i oddanie tury. Wait daje okno na działanie gracza. |
| Osobny profil obrażeń i test trafienia ataku | Pozwala różnicować siłę oraz celność zwykłego ataku i szarży. |
| **Prepare → Prepared actions**, z osobnymi wagami | W wariancie `opposed-preparation` przygotowanie potajemnie wybiera odpowiedź należącą do tego wroga. Można np. ustawić szarżę trzy razy częściej niż unik. Są to inne wagi niż wagi normalnych akcji. |
| Wyzwalacz **incoming-hit** | Przygotowana obrona reaguje na trafiony atak gracza. Może zatrzymać cały cios, bez rzutu lub po własnym teście. Przygotowany atak gracza przełamuje tę obronę i zadaje bazowe obrażenia. |
| Wyzwalacz **after-player-action** | Przygotowany Attack lub Wait wykonuje się po akcji gracza. Zabicie wroga anuluje oczekującą szarżę. |
| Odpowiedź zastępcza **fallback** | Przygotowana obrona może wskazać Wait jako odpowiedź po wybranych akcjach gracza: Defend, Wait lub Prepare. To ograniczona reakcja, nie ogólny system warunkowego wyboru taktyki. |

Przygotowanie w wariancie `opposed-preparation` dotyczy następnej akcji gracza. Nie jest dowolnym systemem ładowania ataku przez kilka tur. Przygotowane odpowiedzi nie zajmują dodatkowej pozycji w normalnym cyklu Order.

Proponowane style z pierwszych pięciu rozdziałów można skonfigurować następująco:

| Przeciwnik | Konfiguracja obecnymi narzędziami |
| --- | --- |
| Szczur | Random z przewagą Attack nad Prepare. |
| Zdziczałe zwierzę | W Prepare większa waga szarży niż obrony. |
| Zmieniony pracownik | W Prepare większa waga obrony niż szarży. |
| Zmutowany mechanik | Order: Attack → Prepare → Wait. Mocny cios jest przygotowaną odpowiedzią rozstrzyganą po ruchu gracza, a Wait daje późniejsze okno odpoczynku. |
| Masywny zmieniony | Zestaw mocniejszych ataków, przygotowanych odpowiedzi i przerw w stałym cyklu. W tej wersji taktyka pozostaje taka sama przez całe starcie. |

## Zachowania wymagające rozbudowy mechaniki

| Zachowanie | Obecne ograniczenie / potrzebne rozszerzenie |
| --- | --- |
| Fazy zależne od HP, np. większa agresja poniżej połowy zdrowia | Health reactions pokazują reakcję narracyjną; nie przełączają taktyki. Potrzebny jest wybór fazy i jej zestawu akcji lub wag. |
| Wybór akcji zależny od zasobów gracza, np. szarża przy małej Energii | Warunki akcji wroga są obecnie niedopuszczone przez walidację. Potrzebne jest filtrowanie dostępnych akcji i określenie zachowania, gdy żadna nie spełnia warunków. |
| Cooldowny akcji wroga i zakaz powtarzania silnego ataku | Cooldowny wroga są obecnie niedopuszczone przez walidację. Order pozwala zaplanować odstępy; Random może wylosować tę samą akcję kilka razy z rzędu. |
| Adaptacja do historii ruchów gracza | Nie ma reguł typu „po trzech zwykłych atakach gracza wybierz obronę”. Potrzebna jest pamięć istotnych ruchów i reguły jej użycia. |
| Ładowanie ataku przez kilka tur | Obecne przygotowane odpowiedzi wygasają po następnej akcji gracza. Potrzebny jest osobny stan ładowania i zasady jego przerywania. |

Interakcje z otoczeniem przed walką można projektować na ścieżce fabularnej, np. kierując gracza do osobnego wariantu Enemy. Nie oznacza to obsługi dowolnego osłabiania aktywnego wroga ani ucieczki w trakcie starcia. Takie akcje wymagałyby osobnego projektu i integracji z walką.

Obecne narzędzia wystarczają do zróżnicowania stylów w pierwszych pięciu rozdziałach. Pierwszym proponowanym rozszerzeniem są fazy zależne od HP; nie są wymagane do przygotowania początkowych wariantów przeciwników.

## Rozwój broni

Na otwarcie wystarczy kilka wyraźnych progów siły. Strzelba jest propozycją na późniejszy etap, nie obowiązkową zdobyczą w pierwszych pięciu rozdziałach.

| Broń | Obrażenia | Rola |
| --- | --- | --- |
| Pięści | 1–2 | Awaryjna możliwość walki, zawsze dostępna. |
| Rura / prowizoryczna broń | 2–3 | Pierwszy wyraźny wzrost skuteczności. |
| Pałka / solidny łom | 3–4 | Pewna broń na środkową część otwarcia. |
| Pistolet | 3–5 | Mocny zwykły atak; specjalny strzał może kosztować Energię. |
| Strzelba, później | 5–7 | Duże obrażenia ograniczane kosztem lub cooldownem. |

Nowa broń powinna również zmieniać decyzje. Łom może mieć kosztowny, silny zamach z cooldownem, a pistolet celniejszy strzał za Energię. Nie każda broń powinna otrzymać identyczny zestaw zwykłego i mocniejszego ataku.

Amunicja pozostaje na później. Obecny system pozwala różnicować bronie kosztami i cooldownami bez kolejnego zasobu.

Po znalezieniu lepszej broni gracz powinien spotkać jeszcze słabego przeciwnika. Szczur, który wcześniej wymagał kilku trafień, teraz pada po jednym lub dwóch. Wcześniejsze spotkania zachowują swoje parametry, dzięki czemu gracz odczuwa rozwój.

## Statystyki

Rozwój statystyk jest wolniejszy niż rozwój broni. Propozycja na pierwsze pięć rozdziałów: dwa punkty do rozdania, np. po rozdziale 2 i 4. Startowe wartości 3 mogą wzrosnąć do 4–5 w wybranej specjalizacji. Sposób przyznawania i wyboru punktów wymaga osobnego projektu; obecne efekty umożliwiają zmianę wartości statystyk.

W obecnym [teście statystyki](stat-checks.md), przy trudności 3, szanse trafienia wynoszą:

| Zwinność | Szansa |
| --- | --- |
| 3 | 62,5% |
| 4 | 74,1% |
| 5 | 83,8% |

To już duża poprawa. Na tym etapie statystyka nie dodaje obrażeń: broń zwiększa siłę trafienia, Zwinność jego niezawodność.

Żeby Zwinność nie stała się oczywistym wyborem, pozostałe statystyki powinny przynosić porównywalne korzyści. Inteligencja może pozwalać osłabić zagrożenie przez otoczenie, a Opanowanie udostępniać wybrane skuteczne akcje pod presją. Konkretne możliwości pozostają do zaprojektowania.

## Tempo i sprawdzenie balansu

Cele długości starć, liczone w decyzjach gracza, a nie liczbie kart czy rzutów:

- Łatwa walka: 3–5 decyzji.
- Zwykła walka: 5–7 decyzji.
- Walka kulminacyjna: 7–10 decyzji.

To cele do pomiaru, nie potwierdzone wyniki zaproponowanych parametrów. Nie należy równocześnie zwiększać HP, celności i obrażeń każdego kolejnego wroga. Jeden jest groźny przez agresję, drugi przez obronę, trzeci przez potężny, przewidywalny cios. Między nimi pojawiają się łatwiejsze starcia.

Przy starcie z 10 HP i 3 Energii trzeba ograniczyć liczbę obowiązkowych walk bez odpoczynku. Trudność rozdziału zależy od dostępnego leczenia i regeneracji Energii równie mocno jak od parametrów pojedynczego przeciwnika.

Przed przyjęciem liczb należy sprawdzić długość walk, przeżywalność i zużycie zasobów dla oczekiwanego oraz słabszego wyposażenia, różnych przydziałów statystyk i kilku sposobów gry. Weryfikacja powinna objąć także ciąg spotkań bez pełnej regeneracji oraz to, czy jedna akcja nie dominuje wszystkich pozostałych. Symulacje nie zastępują oceny czytelności zachowania wroga i rytmu kart podczas gry.
