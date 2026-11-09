# Nest Playtest na Androida

Nest Playtest uruchamia rozdział przesłany z lokalnego Nest Studio przez USB. Aplikacja używa systemowego WebView. Wymagany jest Android 9 lub nowszy i aktualny Android System WebView (Chromium 131 lub nowszy do kości 3D offline).

## Pierwsze uruchomienie

1. Na Macu zainstaluj JDK 17 oraz Android SDK Platform 35, Build-Tools 35.0.0 i Platform-Tools. Ustaw `ANDROID_HOME` na ścieżkę do SDK (zwykle `$HOME/Library/Android/sdk`). Ustaw `JAVA_HOME`, jeśli JDK 17 nie jest domyślnym JDK.
2. W katalogu projektu uruchom `./android/build-debug.sh`. Wynik trafia do `android/build/nest-playtest-debug.apk`. Skrypt przechowuje lokalny klucz debug w `android/build/debug.keystore`. Przy kolejnej instalacji zachowaj ten klucz, aby użyć `adb install -r` z zachowaniem danych. Ścieżkę do własnego klucza debug można ustawić przez `NEST_ANDROID_DEBUG_KEYSTORE`.
3. Włącz opcje programistyczne i debugowanie USB na telefonie. Podłącz odblokowany telefon kablem do transmisji danych i potwierdź zgodę na debugowanie.
4. Uruchom `"$ANDROID_HOME/platform-tools/adb" install -r android/build/nest-playtest-debug.apk` i otwórz na telefonie aplikację Nest Playtest.

## Playtest

Uruchom Studio przez lokalny serwer (`python3 serve.py --host 127.0.0.1`, strona `http://127.0.0.1:8937/editor.html`). Przy podłączonym telefonie wybierz rozdział i kliknij **APK Test** za **Import Chapter**. Transfer obejmuje zastosowane zmiany, także te wciąż niezapisane. Po udanym transferze rozdział zaczyna się od początku. Możesz odłączyć kabel i ponownie otworzyć aplikację offline. Mały link **Restart** w prawym dolnym rogu zaczyna od początku. Przesunięcie od krawędzi ekranu chwilowo odsłania paski systemowe.

APK zawiera natywną powłokę. Studio wysyła Player osobno przy pierwszym transferze i po zmianie jego plików. Każdy transfer zawiera pełną migawkę rozdziału. Aplikacja sprawdza pakiet i uruchamia kandydata w WebView przed podmianą aktywnej migawki.

Informacje o trybie pełnoekranowym i lokalnych zasobach WebView są w dokumentacji Androida. [Tryb pełnoekranowy](https://developer.android.com/develop/ui/views/layout/immersive) · [Lokalne zasoby WebView](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content)
