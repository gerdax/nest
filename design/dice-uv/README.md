# Tekstura kostek do edycji w Photoshopie

Otwórz `nest-texture-edit.psd` (1024 × 1024 px, RGB/8).

- `Nest texture - edit this`: aktualna tekstura Nest z kropkami na d6.
- `UV edges - d4` … `UV edges - d100`: osobne warstwy turkusowych obrysów ścian dla każdego typu kostki. Można je niezależnie wyłączać.
- `Triangulation + bevels (optional)`: domyślnie ukryta, różowa siatka wszystkich trójkątów, również zaokrągleń krawędzi.

Maluj na warstwie tekstury lub dodaj nad nią własne warstwy. Przed eksportem tekstury wyłącz wszystkie warstwy `UV edges` i opcjonalną triangulację. Zachowaj rozmiar, pozycje i orientację elementów atlasu. Aby uniknąć szwów, kolor tła przedłużaj poza obrys ścian na zaokrąglenia.

Pliki pomocnicze:

- `nest-texture-with-grid.png`: podgląd tekstury z nałożonymi krawędziami.
- `nest-uv-overlay.png`: same krawędzie na przezroczystym tle; pasuje do tekstury 1:1 bez skalowania.
- `nest-texture.png`: tekstura bez siatki.
- `nest-uv-triangulation.png`: pełna siatka na przezroczystym tle.

Obrysy pochodzą z UV rzeczywistych modeli w `dice/vendor/dice-box/assets/themes/default/default.json`, z odwróceniem osi V na współrzędne obrazu. Pominięto przekątne wewnątrz płaskich ścian; są dostępne w opcjonalnej triangulacji. Tekstura pochodzi z `dice/themes/nest/numbers.svg`. Oryginalne zasoby i konfiguracja gry pozostały bez zmian. Modele i oryginalne znaki: Frank Ali / Dice Box, licencja MIT w `dice/vendor/dice-box/LICENSE`.

Generator `generate.py` wymaga Pillow oraz wcześniej zrasteryzowanej tekstury `nest-texture.png`. W tej sesji SVG zrasteryzowano przez Sharp z pakietu środowiska Codex, bez instalowania zależności projektu.

Weryfikacja: obejrzano podgląd PNG; Pillow odczytał kompozycję PSD i potwierdził jej zgodność piksel po pikselu z podglądem. Warstwy PSD również odczytano przez Pillow. Nie sprawdzano pliku bezpośrednio w Photoshopie.
