# Nest TODO

## Travel

- [ ] Dodać sekwencje Travel: Lazarus przemieszcza się karta po karcie, a kolejne karty pokazują postęp podróży. Po drodze mogą pojawiać się losowe wydarzenia i spotkania zależne od aktualnego kontekstu. Zachować prosty rytm swipe’owania.

## Prezentacja kart

- Próba lekkiego, losowego obrotu kart została wycofana. Karty wróciły do pierwotnego ustawienia.
- [x] W kontekście wybranej Action zastępować `USING` hasłem `DISCARD`, jeśli konkretny używany przedmiot ma limit użyć i pozostało mu dokładnie 1 użycie. Dotyczy zarówno przedmiotów jednorazowych, jak i ostatniego użycia przedmiotów wielorazowych; przedmioty permanentne zachowują `USING`. Tutaj `DISCARD` zapowiada usunięcie przedmiotu po zatwierdzonym użyciu; odrzucanie niepodniesionej karty Item pozostaje osobną interakcją.
- [x] Ostrzeżenie o ostatnim użyciu pokazywać przed zatwierdzeniem, także przy teście z jednoczesnym podglądem szans i przedmiotu oraz przy triggerze wybieranym przez tag. Korzystać z pozostałych użyć faktycznie wybranego przedmiotu, bez zużywania go przez podgląd. Zatwierdzona próba zużywa użycie także przy nieudanym teście; anulowanie lub przerwanie go nie zużywa.

## Wydajność na telefonie

- Objaw zgłoszony przez użytkownika: przejście z ataku szczura do wachlarza wygląda jak spadek do około 3–4 klatek/s (subiektywna ocena, bez pomiaru).
- [ ] Podłączyć telefon do Maca przez USB i uruchomić zdalny profiler. Dla Androida włączyć debugowanie USB, otworzyć grę w Chrome na telefonie i wybrać jej kartę przez `chrome://inspect/#devices` na Macu. Dla iPhone’a włączyć Inspektor WWW w ustawieniach Safari i wybrać kartę gry z menu Programowanie w Safari na Macu.
- [ ] Nagrać przejście z ataku szczura do wachlarza w panelu Performance (Chrome) lub Timelines (Safari). Zacząć nagranie przed flipem, zatrzymać po rozwinięciu wachlarza i zapisać profil. W Chrome wyłączyć podgląd ekranu telefonu oraz ustawić CPU i sieć na `No throttling`. Zapisać model telefonu, system i wersję przeglądarki.
- [ ] Ustalić przyczynę przycięcia przy przejściu z ataku szczura do wachlarza wyboru akcji (przypadek karty dwustronnej). W `player.html?perf=1` powtórzyć to przejście na telefonie z ustawieniami domyślnymi i z lekkim presetem. Zapisać model telefonu, przeglądarkę i raporty z obu prób.
- [ ] Jeśli lekki preset pomaga, włączać efekty pojedynczo, zaczynając od `Image colorize`, `Paper texture`, `Card rim` i `Shadows`. W profilu obrotu sprawdzić koszt składania warstw, podmiany DOM przy 90° oraz odczytów geometrii w `poseContext()` po zapisach stylów w `renderContentTransition()`.
- [ ] Wdrożyć poprawkę na podstawie pomiarów i powtórzyć próbę na tym samym telefonie.
