# Nest TODO

## Travel

- [ ] Zaprojektować Travel pomiędzy fabularnymi discoveries i wątkami pchającymi historię do przodu: Lazarus przemieszcza się karta po karcie, a kolejne karty pokazują kroki podróży. Oprzeć rozwiązanie w dużej mierze na Auto i rozważyć jego rozszerzenie. Osobny typ beatu Travel pozostaje do decyzji.
- [ ] Wplatać w Travel kontekstowe, losowe wydarzenia: znaleziska, drzwi, okazje, zagrożenia, spotkania i rozstaje lewo/prawo. Uwzględnić stan gry, inventory i zdobytą wiedzę. Zachować prosty rytm swipe’owania i możliwość spokojnych odcinków bez wydarzenia.
- [ ] Przygotować mały przykład rozstajów z konsekwencją natychmiastową lub pojawiającą się kilka kart później. Ścieżki mogą spotkać się przy wspólnym punkcie fabuły, zachowując istotne skutki wcześniejszych wyborów.

## Sprawczość i rozwój

- [ ] Na małym grywalnym fragmencie zaplanować relacje statystyki → przedmioty → dostępne reakcje na sytuacje, tak aby gracz mógł dobierać inventory do swojego rozwoju. Zweryfikować alternatywne sposoby działania bez projektowania od razu całego systemu progresji i balansu.

Założenia projektowe: [Storytelling principles — Contextual agency and uncertainty](storytelling-principles.md#contextual-agency-and-uncertainty) oraz [Travel between discoveries](storytelling-principles.md#travel-between-discoveries--agreed-direction-not-yet-implemented).

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
