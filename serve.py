"""Serve the player, chapter editor and in-game dice assets without caching modules."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import ipaddress
import json
import re
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urlsplit

from android_transfer import LIMIT as ANDROID_LIMIT, TRANSFER_LOCK, TransferError, transfer_chapter
from image_catalog import IMAGE_SUFFIXES, image_manifest_bytes, legacy_image_source
from project_file_store import InvalidProject, MAX_PROJECT_BYTES, ProjectFileStore
from runtime_catalog import DEBUG_ONLY_FILES, DICE_DIR, DICE_LICENSE, DICE_SUFFIXES, RUNTIME_FILES, RUNTIME_MODULE_DIRS


def public_file(path):
    parts, suffix = path.parts, path.suffix.lower()
    if not parts or any(part.startswith('.') for part in parts):
        return False
    name = path.as_posix()
    if name.casefold() in DEBUG_ONLY_FILES:
        return False
    if name in RUNTIME_FILES:
        return True
    if parts[0] in RUNTIME_MODULE_DIRS and len(parts) == 2:
        return suffix in {'.js', '.css'}
    if parts[:2] == ('assets', 'img'):
        return suffix in IMAGE_SUFFIXES or (parts[:4] == ('assets', 'img', 'player-ui', 'fonts') and suffix == '.ttf')
    if parts[:2] == ('assets', 'fonts'):
        return suffix == '.ttf'
    if name.startswith(DICE_DIR + '/'):
        return name == f'{DICE_DIR}/{DICE_LICENSE}' or suffix in DICE_SUFFIXES
    # Browser-facing developer fixtures use the same local server as the app.
    return parts[:2] == ('tests', 'fixtures') and suffix in {'.html', '.js', '.css', '.json'}


def is_storage_path(candidate, directory):
    if candidate.is_relative_to(directory):
        return True
    # On case-insensitive or normalization-insensitive volumes, a different
    # spelling can still name the same directory.
    ancestor = Path(*candidate.parts[:len(directory.parts)])
    try:
        return ancestor.samefile(directory)
    except FileNotFoundError:
        return False


class PlaygroundHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, project_dir=None, **kwargs):
        root = Path(kwargs.get('directory') or '.').resolve()
        kwargs['directory'] = str(root)
        self.project_store = ProjectFileStore(project_dir or root / 'saved-projects')
        super().__init__(*args, **kwargs)

    def _json(self, status, value, head=False):
        content = json.dumps(value, ensure_ascii=True).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(content)))
        self.end_headers()
        if not head:
            self.wfile.write(content)

    @staticmethod
    def _authority(value):
        parsed = urlsplit('//' + value)
        if parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
            raise ValueError('Invalid host')
        host = parsed.hostname
        if host != 'localhost':
            ipaddress.ip_address(host)
        return host, parsed.port or 80

    def _allowed_request(self):
        try:
            hosts = self.headers.get_all('Host', [])
            if len(hosts) != 1:
                raise ValueError('One Host header required')
            authority = self._authority(hosts[0])
            origins = self.headers.get_all('Origin', [])
            if origins:
                if len(origins) != 1:
                    raise ValueError('One Origin header required')
                origin = urlsplit(origins[0])
                if origin.scheme != 'http' or origin.path or origin.query or origin.fragment:
                    raise ValueError('Invalid Origin')
                if self._authority(origin.netloc) != authority:
                    raise ValueError('Cross-origin request denied')
            return True
        except (ValueError, TypeError):
            self._json(403, {'error': 'Request host or origin denied'})
            return False

    def _selected_store(self):
        query = urlsplit(self.path).query
        if not query:
            return self.project_store
        if re.search(r'%(?![0-9A-Fa-f]{2})', query):
            raise InvalidProject('Invalid query encoding')
        pairs = parse_qsl(query, keep_blank_values=True, strict_parsing=True, errors='strict')
        if not pairs:
            return self.project_store
        if len(pairs) != 1 or pairs[0][0] != 'file':
            raise InvalidProject('Expected one file query parameter')
        return ProjectFileStore(self.project_store.directory, pairs[0][1])

    def _get_project_api(self, head=False):
        route = urlsplit(self.path)
        if route.path == '/api/android-transfer':
            self._json(200, {'available': self._android_request(require_origin=False)}, head=head)
            return True
        if route.path == '/api/reveal-image':
            self._json(200, {'available': self._finder_available()}, head=head)
            return True
        if route.path not in ('/api/project', '/api/projects'):
            return False
        if self._allowed_request():
            try:
                if route.path == '/api/projects':
                    if route.query:
                        raise InvalidProject('Project listing takes no query parameters')
                    result = self.project_store.list_projects()
                else:
                    result = self._selected_store().read()
                self._json(200, result, head=head)
            except (InvalidProject, ValueError, UnicodeError):
                self._json(400, {'error': 'Invalid project selection or project file'}, head=head)
            except OSError:
                self._json(500, {'error': 'Unable to read project file'}, head=head)
        return True

    def do_GET(self):
        if not self._get_project_api():
            super().do_GET()

    def do_HEAD(self):
        if not self._get_project_api(head=True):
            super().do_HEAD()

    def do_POST(self):
        route = urlsplit(self.path).path
        if route == '/api/android-transfer':
            self._android_transfer()
            return
        if route not in ('/api/project', '/api/reveal-image'):
            self._json(404, {'error': 'Unknown endpoint'})
            return
        if not self._allowed_request():
            return
        reveal = route == '/api/reveal-image'
        if reveal and not self._finder_available():
            self._json(403, {'error': 'Finder is only available in local macOS Studio'})
            return
        if self.headers.get_content_type() != 'application/json':
            self._json(415, {'error': 'Content-Type must be application/json'})
            return
        try:
            if self.headers.get('Transfer-Encoding'):
                raise InvalidProject('Transfer-Encoding is unsupported')
            lengths = self.headers.get_all('Content-Length', [])
            if len(lengths) != 1:
                raise InvalidProject('Content-Length is required')
            length = int(lengths[0])
            if length < 0 or length > (8192 if reveal else MAX_PROJECT_BYTES):
                self._json(413, {'error': 'Request is too large' if reveal else 'Request exceeds 50 MB'})
                return
            body = self.rfile.read(length)
            if len(body) != length:
                raise InvalidProject('Incomplete body')
            request = json.loads(body)
            if reveal:
                self._reveal_image(request)
                return
            status, result = self._selected_store().save(request)
            self._json(status, result)
        except (InvalidProject, ValueError, UnicodeError):
            self._json(400, {'error': 'Invalid image path' if reveal else 'Invalid project save request'})
        except OSError:
            self._json(500, {'error': 'Unable to open Finder' if reveal else 'Unable to save project file'})

    def _android_request(self, *, require_origin):
        if not ipaddress.ip_address(self.client_address[0]).is_loopback:
            return False
        hosts = self.headers.get_all('Host', [])
        origins = self.headers.get_all('Origin', [])
        if len(hosts) != 1 or len(origins) > 1 or (require_origin and not origins):
            return False
        if not re.fullmatch(r'(?:localhost|[0-9.]+|\[[a-f0-9:]+\])(?::[0-9]+)?', hosts[0], re.I):
            return False
        try:
            host, port = self._authority(hosts[0])
            return (port == self.server.server_port
                    and (host == 'localhost' or ipaddress.ip_address(host).is_loopback)
                    and (not origins or origins[0].lower() == 'http://' + hosts[0].lower()))
        except (ValueError, TypeError):
            return False

    def _android_transfer(self):
        if not self._android_request(require_origin=True):
            self._json(403, {'error': 'Transfer jest dostępny tylko z lokalnego Studio.'})
            return
        if self.headers.get_content_type() != 'application/json':
            self._json(415, {'error': 'Transfer wymaga rozdziału w formacie JSON.'})
            return
        lengths = self.headers.get_all('Content-Length', [])
        if (self.headers.get_all('Transfer-Encoding') or len(lengths) != 1
                or not re.fullmatch(r'[0-9]{1,10}', lengths[0])):
            self._json(400, {'error': 'Nieprawidłowa długość żądania.'})
            return
        length = int(lengths[0])
        if not 0 < length <= ANDROID_LIMIT:
            self._json(413, {'error': 'Rozdział musi mieścić się w limicie 50 MB.'})
            return
        if not TRANSFER_LOCK.acquire(blocking=False):
            self._json(409, {'error': 'Trwa już transfer na Androida.'})
            return
        try:
            # Bound the whole request body, including clients sending it slowly.
            self.connection.settimeout(2)
            deadline = time.monotonic() + 15
            body = bytearray()
            while len(body) < length and time.monotonic() < deadline:
                chunk = self.rfile.read1(min(1024 * 1024, length - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
            if len(body) != length:
                raise ValueError('Incomplete chapter')
            self.connection.settimeout(None)
            result = transfer_chapter(Path(self.directory), json.loads(body), self.headers['Host'],
                                      excluded=lambda path: is_storage_path(path, self.project_store.directory))
            status = 200
        except TransferError as error:
            status, result = 422, {'error': str(error)}
        except (ValueError, RecursionError):
            status, result = 400, {'error': 'Nie udało się odczytać rozdziału. Sprawdź go w Studio.'}
        except TimeoutError:
            status, result = 408, {'error': 'Przekroczono czas przesyłania rozdziału ze Studio.'}
        except (OSError, subprocess.SubprocessError):
            status, result = 503, {'error': 'Transfer przerwany. Sprawdź ADB i połączenie USB, a następnie spróbuj ponownie.'}
        finally:
            self.connection.settimeout(5)
            TRANSFER_LOCK.release()
        try:
            self._json(status, result)
        except OSError:
            pass

    def _finder_available(self):
        if sys.platform != 'darwin' or not ipaddress.ip_address(self.client_address[0]).is_loopback:
            return False
        try:
            host, _ = self._authority(self.headers.get('Host', ''))
            return host == 'localhost' or ipaddress.ip_address(host).is_loopback
        except (ValueError, TypeError):
            return False

    def _reveal_image(self, request):
        value = request.get('image') if isinstance(request, dict) else None
        if not isinstance(value, str) or any(ord(char) < 32 for char in value):
            raise ValueError('Invalid image path')
        url = urlsplit(value)
        path = unquote(url.path, errors='strict')
        parts = path.removeprefix('./').removeprefix('/').split('/')
        if (url.scheme or url.netloc or parts[:2] != ['assets', 'img']
                or any(not part or part.startswith('.') or '\\' in part or '\0' in part for part in parts)):
            raise ValueError('Invalid image path')
        relative = Path(*parts[2:])
        if relative.suffix.lower() not in IMAGE_SUFFIXES:
            raise ValueError('Unsupported image type')
        root = Path(self.directory)
        source = root / 'assets' / 'img' / relative
        if source.resolve() != source or is_storage_path(source, self.project_store.directory):
            raise ValueError('Invalid image path')
        if not source.exists():
            source = legacy_image_source(root, relative)
        if source is None or not source.is_file() or is_storage_path(source, self.project_store.directory):
            self._json(404, {'error': 'Artwork file not found'})
            return
        try:
            subprocess.run(['/usr/bin/open', '-R', str(source)], check=True, capture_output=True, timeout=5)
        except (subprocess.SubprocessError, OSError):
            self._json(500, {'error': 'Unable to open Finder'})
            return
        self._json(200, {'ok': True})

    def send_head(self):
        root = Path(self.directory)
        if urlsplit(self.path).path == '/assets/image-manifest.json':
            content = image_manifest_bytes(root)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(content)))
            self.end_headers()
            return BytesIO(content)
        translated = Path(self.translate_path(self.path))
        requested_root = translated == root
        candidate = root / 'index.html' if requested_root else translated
        try:
            resolved = candidate.resolve()
            allowed = (resolved == candidate and resolved.is_relative_to(root)
                       and public_file(resolved.relative_to(root))
                       and not is_storage_path(resolved, self.project_store.directory)
                       and (not requested_root or candidate.is_file())
                       and not candidate.is_dir())
        except (OSError, RuntimeError):
            allowed = False
        if not allowed:
            self.send_error(403, 'Path is outside the public runtime')
            return None
        if not candidate.exists() and (images := root / 'assets' / 'img') in candidate.parents:
            source = legacy_image_source(root, candidate.relative_to(images))
            if source is not None and not is_storage_path(source, self.project_store.directory):
                original_path = self.path
                try:
                    self.path = '/' + quote(source.relative_to(root).as_posix())
                    return super().send_head()
                finally:
                    self.path = original_path
        return super().send_head()

    def list_directory(self, path):
        self.send_error(403, 'Directory listings are disabled')
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', default='0.0.0.0',
                        help='interface to listen on (default: all IPv4 interfaces; use 127.0.0.1 for local only)')
    parser.add_argument('--port', type=int, default=8937)
    parser.add_argument('--project-dir', type=Path, help='project storage directory (default: saved-projects beside serve.py)')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    handler = partial(PlaygroundHandler, directory=str(root), project_dir=args.project_dir)
    with ThreadingHTTPServer((args.host, args.port), handler) as server:
        local_host = '127.0.0.1' if args.host == '0.0.0.0' else args.host
        print(f'nest: http://{local_host}:{server.server_port}/', flush=True)
        if args.host == '0.0.0.0':
            print(f'Wi-Fi: open http://<your-Mac-IP>:{server.server_port}/ on your phone (same network).', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
