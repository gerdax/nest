"""Create a portable Player and send an active chapter to a USB Android device."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shlex
import shutil
import subprocess
import tempfile
import threading
import time
from urllib.parse import quote, unquote, urlsplit
import zipfile

from build_pages import IMPORT_RE, URL_RE, local_reference
from image_catalog import IMAGE_SUFFIXES, image_files, legacy_image_source
from runtime_catalog import DICE_DIR, DICE_LICENSE, DICE_SUFFIXES

APP = 'org.nest.playtest'
LIMIT = 50 * 1024 * 1024
TRANSFER_LOCK = threading.Lock()
HEX = re.compile(r'[a-f0-9]{64}')
CHAPTER = 'chapter.json'


class TransferError(Exception):
    pass


def json_bytes(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=True, allow_nan=False).encode('utf-8')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def chapter_files(root, chapter, authority, *, excluded=lambda path: False):
    """Resolve URLs as served by Studio, then make them portable in the snapshot."""
    if (not isinstance(chapter, dict) or chapter.get('kind') != 'nest-chapter'
            or chapter.get('version') != 3 or not isinstance(chapter.get('chapter'), dict)
            or not isinstance(chapter.get('library'), list)
            or not isinstance(chapter['chapter'].get('id'), str)):
        raise TransferError('Studio musi przesłać rozdział Nest w wersji 3.')

    files, problems = {}, {}
    def portable(value):
        if not isinstance(value, str) or not value.strip():
            return value
        try:
            if '\\' in value or any(ord(char) < 32 for char in value):
                raise ValueError()
            url = urlsplit(value)
            if url.scheme == 'data' and re.match(r'data:image/(?:png|jpeg|webp|gif|svg\+xml)[;,]', value, re.I):
                return value
            if url.scheme or url.netloc:
                if url.scheme not in ('http', '') or url.netloc.lower() != authority.lower():
                    problems[value] = 'zdalny obraz'
                    return value
            if re.search(r'%(?![0-9a-fA-F]{2})', url.path):
                raise ValueError()
            path = unquote(url.path, errors='strict').removeprefix('./').removeprefix('/')
            parts = path.split('/')
            suffix = Path(path).suffix.lower()
            catalog_image = parts[:2] == ['assets', 'img'] and suffix in IMAGE_SUFFIXES
            dice_image = parts[:2] == ['assets', 'dice'] and suffix == '.png'
            if (not (catalog_image or dice_image) or len(parts) < 3 or len(path) > 1015
                    or any(not part or part.startswith('.') or len(part.encode()) > 255
                           or '\\' in part or ':' in part
                           or any(ord(char) < 32 for char in part) for part in parts)):
                raise ValueError()
            source = root / path
            if source.resolve() != source or excluded(source):
                raise ValueError()
            if not source.is_file():
                source = legacy_image_source(root, Path(*parts[2:])) if catalog_image else None
            if source is None or excluded(source):
                problems[value] = 'brak pliku'
                return value
            files[path] = source
            return '/' + quote(path, safe='/') + (f'?{url.query}' if url.query else '') + (f'#{url.fragment}' if url.fragment else '')
        except (ValueError, OSError, RuntimeError):
            problems[value] = 'nieobsługiwana ścieżka obrazu'
            return value

    def visit(value):
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            for key, child in value.items():
                if key == 'image':
                    value[key] = portable(child)
                else:
                    visit(child)

    chapter['chapter'].pop('backImage', None)  # Ignored by the existing Player parser.
    visit(chapter)
    back = chapter.get('cardBack')
    if isinstance(back, dict):
        if 'background' in back:
            back['background'] = portable(back['background'])
        if isinstance(back.get('icons'), dict) and 'default' in back['icons']:
            back['icons']['default'] = portable(back['icons']['default'])
    if problems:
        descriptions = [f'{reason}: {value[:240]}' for value, reason in problems.items()]
        detail = '; '.join(descriptions[:12])
        if len(descriptions) > 12:
            detail += f'; oraz {len(descriptions) - 12} kolejnych'
        raise TransferError(f'Nie można przygotować obrazów. {detail}')
    return files


def runtime_files(root):
    """Collect Player's local dependency graph, shared graphics and dice bundle."""
    pending = [root / 'player.html']
    files = {}

    def add(source):
        if (not source.is_relative_to(root) or source.resolve() != source or not source.is_file()):
            raise TransferError(f'Brak pliku Playera: {source.name}.')
        files[source.relative_to(root).as_posix()] = source

    while pending:
        source = pending.pop()
        if source in files.values():
            continue
        add(source)
        if source.suffix not in {'.html', '.js', '.css'}:
            continue
        content = source.read_text(encoding='utf-8')
        references = [match.group(1) for match in IMPORT_RE.finditer(content)]
        if source.suffix == '.html':
            references.extend(re.findall(r'(?:src|href)=["\']([^"\']+)["\']', content))
            # This optional web link is removed by the Android Player.
            references = [ref for ref in references if ref != './editor.html']
        if source.suffix == '.css':
            references.extend(match.group(2) for match in URL_RE.finditer(content))
        for ref in references:
            if '${' not in ref and (resolved := local_reference(ref, source.parent)):
                pending.append(resolved)

    for source in image_files(root):
        if source.is_relative_to(root / 'assets' / 'img' / 'player-ui'):
            add(source)
    for directory in ('assets/fonts', 'assets/img/player-ui/fonts'):
        for source in sorted((root / directory).glob('*.ttf')):
            add(source)
    dice_root = root / DICE_DIR
    for source in sorted(dice_root.rglob('*')):
        relative = source.relative_to(dice_root)
        if (source.is_file() and not any(part.startswith('.') for part in relative.parts)
                and (relative.as_posix() == DICE_LICENSE or source.suffix.lower() in DICE_SUFFIXES)):
            add(source)
    return files


def read_files(paths, *, excluded):
    files = {}
    remaining = 120 * 1024 * 1024
    for name, path in paths.items():
        if path.resolve() != path or excluded(path):
            raise TransferError(f'Plik poza katalogiem zasobów: {name}.')
        with path.open('rb') as source:
            content = source.read(min(remaining + 1, path.stat().st_size + 1))
            remaining -= len(content)
            if remaining < 0:
                raise TransferError('Zasoby przekraczają limit transferu.')
        files[name] = content
    return files


def write_archive(out, token, snapshot, runtime, runtime_manifest, include_runtime):
    entries = {'transfer.json': json_bytes({
        'version': 1, 'token': token, 'runtime': digest(runtime_manifest),
        'snapshot': {name: digest(data) for name, data in snapshot.items()},
    })}
    if include_runtime:
        entries['runtime.json'] = runtime_manifest
        entries.update({f'runtime/{name}': data for name, data in runtime.items()})
    entries.update({f'snapshot/{name}': data for name, data in snapshot.items()})
    if (len(entries) > 4096 or len(entries['transfer.json']) > 2 * 1024 * 1024
            or len(runtime_manifest) > 2 * 1024 * 1024
            or sum(map(len, entries.values())) > 256 * 1024 * 1024):
        raise TransferError('Pakiet przekracza limit transferu.')
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    if out.tell() > 128 * 1024 * 1024:
        raise TransferError('Archiwum przekracza limit transferu.')
    out.seek(0)


def find_adb():
    candidates = [shutil.which('adb')]
    for variable in ('ANDROID_HOME', 'ANDROID_SDK_ROOT'):
        if os.environ.get(variable):
            candidates.append(Path(os.environ[variable]) / 'platform-tools' / 'adb')
    candidates.append(Path.home() / 'Library/Android/sdk/platform-tools/adb')
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(Path(candidate).resolve())
    raise TransferError('Brak ADB. Zainstaluj Android SDK Platform-Tools i dodaj adb do PATH lub ustaw ANDROID_HOME przed uruchomieniem Studio.')


def adb_call(*args, timeout=10, stdin=None):
    return subprocess.run(args, stdin=subprocess.DEVNULL if stdin is None else stdin,
                          capture_output=True, timeout=timeout)


def adb_usb(adb):
    result = adb_call(adb, 'devices', '-l')
    if result.returncode:
        raise TransferError('ADB nie może wyświetlić urządzeń. Sprawdź instalację Platform-Tools.')
    devices = []
    for line in result.stdout.decode('utf-8', 'replace').splitlines():
        columns = line.split()
        if len(columns) >= 2 and any(column.startswith('usb:') for column in columns[2:]):
            devices.append(columns)
    if not devices:
        raise TransferError('Brak telefonu USB. Podłącz odblokowany telefon kablem do transmisji danych i włącz debugowanie USB.')
    if len(devices) != 1:
        raise TransferError('Podłączono kilka urządzeń USB. Zostaw podłączony tylko telefon do playtestu.')
    _, state, *properties = devices[0]
    if state == 'unauthorized':
        raise TransferError('Odblokuj telefon i zaakceptuj pytanie „Zezwolić na debugowanie USB?”.')
    if state != 'device':
        raise TransferError('Telefon USB jest niedostępny. Odblokuj go, odłącz i ponownie podłącz kabel.')
    transport = next((p.removeprefix('transport_id:') for p in properties if p.startswith('transport_id:')), '')
    if not re.fullmatch(r'[1-9][0-9]*', transport):
        raise TransferError('ADB nie podał identyfikatora połączenia USB. Zaktualizuj Platform-Tools.')
    return adb, '-t', transport


def device_file(device, *args, timeout=10, stdin=None):
    # The shell command uses fixed arguments and host-generated hex tokens only.
    command = shlex.join(['run-as', APP, *args])
    return adb_call(*device, 'shell', '-T', command, timeout=timeout, stdin=stdin)


def send_archive(device, archive, token):
    incoming = f'files/incoming-{token}.zip'
    ack = f'files/ack-{token}.json'
    try:
        upload = device_file(device, 'sh', '-c', f'umask 077 && mkdir -p files && cat > {incoming}.part && mv {incoming}.part {incoming}',
                             timeout=120, stdin=archive)
        if upload.returncode:
            raise TransferError('Nie udało się zapisać pakietu na telefonie. Sprawdź kabel, wolne miejsce i spróbuj ponownie.')
        launch = adb_call(*device, 'shell', '-T', 'am', 'start', '-n', f'{APP}/.MainActivity',
                          '-a', f'{APP}.IMPORT', '--es', 'token', token)
        if launch.returncode or b'Error:' in launch.stdout or b'Error:' in launch.stderr:
            raise TransferError('Android nie uruchomił importu. Otwórz Nest Playtest na odblokowanym telefonie.')
        deadline = time.monotonic() + 75
        while time.monotonic() < deadline:
            try:
                result = device_file(device, 'cat', ack, timeout=5)
            except subprocess.TimeoutExpired as error:
                raise TransferError('Nie odebrano potwierdzenia. Sprawdź, czy rozdział otworzył się na telefonie, lub ponów transfer.') from error
            if not result.returncode:
                try:
                    message = json.loads(result.stdout)
                except ValueError as error:
                    raise TransferError('Android zwrócił nieczytelne potwierdzenie importu.') from error
                if not isinstance(message, dict) or message.get('token') != token or type(message.get('ok')) is not bool:
                    raise TransferError('Android zwrócił potwierdzenie dla innego transferu.')
                return message
            # A missing ack is normal during import. A missing transport is terminal.
            if b'No such file or directory' not in result.stderr:
                raise TransferError('USB rozłączono przed potwierdzeniem. Sprawdź, czy rozdział otworzył się na telefonie, lub podłącz go ponownie i ponów transfer.')
            time.sleep(.4)
        raise TransferError('Brak potwierdzenia z Androida. Sprawdź, czy rozdział otworzył się w Nest Playtest, lub ponów transfer.')
    finally:
        try:
            device_file(device, 'rm', '-f', incoming, incoming + '.part', ack, timeout=3)
        except (OSError, subprocess.TimeoutExpired):
            pass


def transfer_chapter(root, chapter, authority, *, excluded):
    snapshot = read_files(chapter_files(root, chapter, authority, excluded=excluded), excluded=excluded)
    snapshot[CHAPTER] = json_bytes(chapter)
    if len(snapshot[CHAPTER]) > LIMIT:
        raise TransferError('Rozdział przekracza 50 MB po przygotowaniu.')
    runtime = read_files(runtime_files(root), excluded=excluded)
    runtime_manifest = json_bytes({name: digest(data) for name, data in runtime.items()})
    device = adb_usb(find_adb())
    check = device_file(device, 'id')
    if check.returncode:
        if b'not found' in check.stderr and b'transport' in check.stderr:
            raise TransferError('Utracono połączenie USB. Podłącz telefon i spróbuj ponownie.')
        raise TransferError('Zainstaluj debug APK Nest Playtest na telefonie poleceniem adb install -r.')
    active = device_file(device, 'cat', 'files/active.json')
    try:
        cached = json.loads(active.stdout).get('runtime')
    except (ValueError, AttributeError):
        cached = None
    include_runtime = cached != digest(runtime_manifest)
    for attempt in range(2):
        token = secrets.token_hex(16)
        with tempfile.TemporaryFile() as archive:
            write_archive(archive, token, snapshot, runtime, runtime_manifest, include_runtime)
            message = send_archive(device, archive, token)
        if message['ok']:
            return {'ok': True, 'runtimeTransferred': include_runtime}
        if attempt == 0 and not include_runtime and message.get('retryRuntime') is True:
            include_runtime = True
            continue
        raise TransferError(f"Android odrzucił pakiet. {str(message.get('error', ''))[:800]}")
