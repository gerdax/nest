import http.client
from io import BytesIO
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch
import zipfile
from http.server import ThreadingHTTPServer

import android_transfer as android
from serve import PlaygroundHandler

ROOT = Path(__file__).resolve().parents[1]
TOKEN = '1' * 32


def chapter(**extra):
    return {'version': 3, 'kind': 'nest-chapter',
            'chapter': {'id': 'test', 'name': 'Test'}, 'library': [], **extra}


class AndroidPackageTests(unittest.TestCase):
    def test_portable_art_and_legacy_alias(self):
        draft = chapter(cardBack={'background': 'http://localhost:8937/assets/img/rat.png?rev=2',
                                  'icons': {'default': './assets/img/ui/default.png'}},
                        cardStyles={'big': 20})
        files = android.chapter_files(ROOT, draft, 'localhost:8937')
        self.assertEqual(files['assets/img/rat.png'].name, 'rat.png')
        self.assertTrue(files['assets/img/ui/default.png'].is_file())
        self.assertEqual(draft['cardBack']['background'], '/assets/img/rat.png?rev=2')
        self.assertEqual(draft['cardStyles'], {'big': 20})

    def test_reports_missing_remote_and_unsafe_images_together(self):
        draft = chapter()
        draft['library'] = [{'image': src} for src in (
            './assets/img/definitely-absent.png', 'https://example.org/remote.png',
            './assets/img/%2e%2e/secret.png')]
        with self.assertRaisesRegex(android.TransferError, 'brak pliku.*zdalny obraz.*nieobsługiwana'):
            android.chapter_files(ROOT, draft, 'localhost:8937')

    def test_player_runtime_has_no_editor_and_includes_dice_and_fonts(self):
        files = android.runtime_files(ROOT)
        self.assertIn('player.html', files)
        self.assertNotIn('editor.html', files)
        self.assertNotIn('studio/editor.js', files)
        self.assertIn('assets/dice/vendor/dice-box/assets/ammo/ammo.wasm.wasm', files)
        self.assertIn('assets/img/player-ui/fonts/trotont.ttf', files)
        self.assertFalse(any(name.startswith('assets/img/card-art/') for name in files))

    def test_complete_snapshot_and_optional_runtime(self):
        runtime = {'player.html': b'player'}
        manifest = android.json_bytes({name: android.digest(data) for name, data in runtime.items()})
        for include in (False, True):
            buffer = BytesIO()
            snapshot = {'chapter.json': b'chapter', 'assets/img/a.png': b'a'}
            android.write_archive(buffer, TOKEN, snapshot, runtime, manifest, include)
            with zipfile.ZipFile(buffer) as archive:
                transfer = json.loads(archive.read('transfer.json'))
                self.assertEqual(transfer['token'], TOKEN)
                self.assertEqual(transfer['runtime'], android.digest(manifest))
                for name, data in snapshot.items():
                    self.assertEqual(archive.read('snapshot/' + name), data)
                    self.assertEqual(transfer['snapshot'][name], android.digest(data))
                self.assertEqual('runtime/player.html' in archive.namelist(), include)

    def test_usb_transport_selection_ignores_network_and_rejects_ambiguous_usb(self):
        lines = b'List of devices attached\nnetwork:5555 device transport_id:1\n'
        usb = b'physical device usb:1-1 transport_id:2\n'
        with patch.object(android, 'adb_call') as adb:
            adb.return_value = subprocess.CompletedProcess([], 0, lines + usb, b'')
            self.assertEqual(android.adb_usb('/adb'), ('/adb', '-t', '2'))
            adb.return_value.stdout += b'another unauthorized usb:1-2 transport_id:3\n'
            with self.assertRaisesRegex(android.TransferError, 'kilka urządzeń'):
                android.adb_usb('/adb')
            adb.return_value.stdout = lines + usb.replace(b' device ', b' unauthorized ')
            with self.assertRaisesRegex(android.TransferError, 'zaakceptuj'):
                android.adb_usb('/adb')

    def test_device_ack_must_match_transfer(self):
        ok = subprocess.CompletedProcess([], 0, b'', b'')
        stale = subprocess.CompletedProcess([], 0, b'{"token":"stale","ok":true}', b'')
        with patch.object(android, 'device_file', side_effect=[ok, stale, ok]), patch.object(android, 'adb_call', return_value=ok):
            with self.assertRaisesRegex(android.TransferError, 'innego transferu'):
                android.send_archive(('/adb', '-t', '2'), BytesIO(), TOKEN)


class AndroidEndpointTests(unittest.TestCase):
    def test_transfer_requires_matching_local_host_and_origin_and_serializes(self):
        with tempfile.TemporaryDirectory() as directory:
            def handler(*args):
                return PlaygroundHandler(*args, directory=str(ROOT), project_dir=directory)

            with ThreadingHTTPServer(('127.0.0.1', 0), handler) as server:
                worker = threading.Thread(target=server.serve_forever, daemon=True)
                worker.start()
                try:
                    host = f'127.0.0.1:{server.server_port}'
                    headers = {'Content-Type': 'application/json', 'Host': host, 'Origin': 'http://' + host}

                    def post(changes):
                        conn = http.client.HTTPConnection(host, timeout=3)
                        try:
                            conn.request('POST', '/api/android-transfer', json.dumps(chapter()),
                                         {key: value for key, value in (headers | changes).items() if value is not None})
                            response = conn.getresponse()
                            response.read()
                            return response.status
                        finally:
                            conn.close()

                    with patch('serve.transfer_chapter', return_value={'ok': True}) as transfer:
                        self.assertEqual(post({'Origin': None}), 403)
                        self.assertEqual(post({'Origin': 'http://example.org'}), 403)
                        self.assertEqual(post({'Host': 'example.org', 'Origin': 'http://example.org'}), 403)
                        with android.TRANSFER_LOCK:
                            self.assertEqual(post({}), 409)
                        transfer.assert_not_called()
                        self.assertEqual(post({}), 200)
                        transfer.assert_called_once()
                finally:
                    server.shutdown()
                    worker.join()
