package org.nest.playtest;

import android.net.Uri;
import android.system.ErrnoException;
import android.system.Os;
import android.util.JsonReader;
import android.util.JsonToken;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Enumeration;
import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/** Files are prepared in a fresh generation. Only replacing active.json makes them live. */
final class TransferStore {
    private static final String TAG = "NestTransfer";
    private static final Pattern TOKEN = Pattern.compile("[0-9a-f]{32}");
    private static final Pattern HASH = Pattern.compile("[0-9a-f]{64}");
    private static final Pattern UNSAFE_PATH = Pattern.compile("[\\\\:\\p{Cntrl}]");
    private static final Pattern IMAGE = Pattern.compile(".+\\.(png|jpe?g|webp|gif|svg)", Pattern.CASE_INSENSITIVE);
    private static final Pattern INLINE_IMAGE = Pattern.compile("data:image/(png|jpeg|webp|gif|svg\\+xml)[;,]",
            Pattern.CASE_INSENSITIVE);
    private static final int METADATA_LIMIT = 2 * 1024 * 1024;
    private static final int CHAPTER_LIMIT = 50 * 1024 * 1024;
    private static final long ZIP_LIMIT = 128L * 1024 * 1024;
    private static final long EXPANDED_LIMIT = 256L * 1024 * 1024;
    private static final int ENTRY_LIMIT = 4096;

    static final class CachedRuntimeException extends IOException {
        CachedRuntimeException(Exception cause) {
            super("Brakuje sprawnych plików Playera na telefonie. Prześlij rozdział ponownie z runtime.", cause);
        }
    }

    static final class Installation {
        final String token;
        final String runtime;
        final String runtimeGeneration;
        final String title;
        final File snapshotDir;
        final File runtimeDir;

        Installation(String token, String runtime, String runtimeGeneration, String title,
                     File snapshotDir, File runtimeDir) {
            this.token = token;
            this.runtime = runtime;
            this.runtimeGeneration = runtimeGeneration;
            this.title = title;
            this.snapshotDir = snapshotDir;
            this.runtimeDir = runtimeDir;
        }
    }

    private final File files;
    private final File snapshots;
    private final File runtimes;
    private final File active;

    TransferStore(File files) {
        this.files = files;
        snapshots = new File(files, "snapshots");
        runtimes = new File(files, "runtimes");
        active = new File(files, "active.json");
    }

    static boolean validToken(String token) {
        return token != null && TOKEN.matcher(token).matches();
    }

    boolean hasIncoming(String token) {
        return incoming(token).isFile();
    }

    static boolean safePath(String path) {
        if (path == null || path.length() > 1024 || UNSAFE_PATH.matcher(path).find()) return false;
        for (String part : path.split("/", -1)) {
            if (part.isEmpty() || part.startsWith(".") || part.length() > 255) return false;
        }
        return true;
    }

    Installation active() throws IOException, JSONException {
        if (!active.exists()) return null;
        JSONObject pointer = object(read(active, METADATA_LIMIT));
        String token = pointer.getString("snapshot");
        String runtime = pointer.getString("runtime");
        String runtimeGeneration = pointer.getString("runtimeGeneration");
        require(validToken(token) && validToken(runtimeGeneration) && HASH.matcher(runtime).matches(),
                "Nieprawidłowy zapis poprzedniego rozdziału.");
        Installation current = installation(token, runtime, runtimeGeneration, pointer.getString("title"));
        require(new File(current.snapshotDir, "chapter.json").isFile()
                        && new File(current.runtimeDir, "player.html").isFile(),
                "Brakuje plików poprzedniego rozdziału.");
        return current;
    }

    Installation prepare(String token) throws IOException, JSONException {
        File incoming = incoming(token);
        File snapshotDir = new File(snapshots, token);
        File runtimeDir = new File(runtimes, token);
        require(incoming.isFile() && incoming.length() > 0 && incoming.length() <= ZIP_LIMIT,
                "Brakuje kompletnego pakietu USB lub pakiet jest za duży.");
        // A replayed launcher intent must never mutate or remove a published generation.
        require(!snapshotDir.exists() && !runtimeDir.exists(), "Ten pakiet został już zaimportowany.");
        boolean prepared = false;
        try (ZipFile zip = new ZipFile(incoming)) {
            Set<String> entries = inventory(zip);
            JSONObject transfer = object(read(zip, "transfer.json"));
            require(Integer.valueOf(1).equals(transfer.opt("version")) && token.equals(transfer.opt("token")),
                    "Nieobsługiwana wersja pakietu lub niezgodny identyfikator transferu.");
            String runtime = transfer.getString("runtime");
            require(HASH.matcher(runtime).matches(), "Nieprawidłowy identyfikator Playera.");
            JSONObject snapshot = transfer.getJSONObject("snapshot");
            String runtimeGeneration = token;

            extract(zip, entries, "snapshot/", snapshotDir, snapshot);
            String title = chapterTitle(new File(snapshotDir, "chapter.json"), snapshot);

            if (entries.contains("runtime.json")) {
                byte[] manifest = read(zip, "runtime.json");
                require(hash(manifest).equals(runtime), "Identyfikator plików Playera nie zgadza się z pakietem.");
                extract(zip, entries, "runtime/", runtimeDir, object(manifest));
                writeAtomic(new File(runtimeDir, "runtime.json"), manifest);
            } else {
                try {
                    Installation cached = active();
                    require(cached != null && cached.runtime.equals(runtime), "Brak żądanego Playera.");
                    validateRuntime(cached);
                    runtimeGeneration = cached.runtimeGeneration;
                } catch (IOException | JSONException e) {
                    throw new CachedRuntimeException(e);
                }
            }
            require(entries.isEmpty(), "Pakiet zawiera pliki spoza manifestu.");
            Installation candidate = installation(token, runtime, runtimeGeneration,
                    title.substring(0, Math.min(title.length(), 2000)));
            prepared = true;
            return candidate;
        } finally {
            remove(incoming);
            if (!prepared) discard(token);
        }
    }

    void commit(Installation next) throws IOException, JSONException {
        JSONObject pointer = new JSONObject().put("snapshot", next.token).put("runtime", next.runtime)
                .put("runtimeGeneration", next.runtimeGeneration).put("title", next.title);
        writeAtomic(active, pointer.toString().getBytes(StandardCharsets.UTF_8));
    }

    void acknowledge(String token, String error, boolean retryRuntime) {
        try {
            JSONObject ack = new JSONObject().put("token", token).put("ok", error == null);
            if (error != null) ack.put("error", error);
            if (retryRuntime) ack.put("retryRuntime", true);
            writeAtomic(new File(files, "ack-" + token + ".json"), ack.toString().getBytes(StandardCharsets.UTF_8));
        } catch (IOException | JSONException e) {
            Log.e(TAG, "Could not acknowledge USB import " + token, e);
        }
    }

    void discard(String token) {
        remove(new File(snapshots, token));
        remove(new File(runtimes, token));
    }

    void cleanup(Installation keep) {
        prune(snapshots, keep.token);
        prune(runtimes, keep.runtimeGeneration);
        File[] leftovers = files.listFiles();
        if (leftovers == null) return;
        long cutoff = System.currentTimeMillis() - 24L * 60 * 60 * 1000;
        for (File file : leftovers) {
            // Leave recent uploads and acknowledgements alone for the host to finish.
            if (file.getName().matches("(?:incoming|ack)-[0-9a-f]{32}\\.(?:zip(?:\\.part)?|json(?:\\.new)?)")
                    && file.lastModified() < cutoff) remove(file);
        }
    }

    private Installation installation(String token, String runtime, String runtimeGeneration, String title) {
        return new Installation(token, runtime, runtimeGeneration, title,
                new File(snapshots, token), new File(runtimes, runtimeGeneration));
    }

    private File incoming(String token) {
        return new File(files, "incoming-" + token + ".zip");
    }

    private static Set<String> inventory(ZipFile zip) throws IOException {
        require(zip.size() <= ENTRY_LIMIT, "Za dużo plików w pakiecie.");
        Set<String> entries = new HashSet<>();
        long total = 0;
        Enumeration<? extends ZipEntry> iterator = zip.entries();
        while (iterator.hasMoreElements()) {
            ZipEntry entry = iterator.nextElement();
            long size = entry.getSize();
            require(!entry.isDirectory() && safePath(entry.getName()) && entries.add(entry.getName()),
                    "Niedozwolona lub powtórzona ścieżka w pakiecie.");
            require(size >= 0 && size <= EXPANDED_LIMIT - total, "Pakiet po rozpakowaniu jest za duży.");
            total += size;
        }
        return entries;
    }

    private static byte[] read(ZipFile zip, String name) throws IOException {
        ZipEntry entry = zip.getEntry(name);
        require(entry != null && entry.getSize() <= METADATA_LIMIT, "Brakuje prawidłowego manifestu pakietu.");
        try (InputStream input = zip.getInputStream(entry)) {
            return read(input, METADATA_LIMIT);
        }
    }

    private static byte[] read(File file, int limit) throws IOException {
        require(file.isFile() && file.length() <= limit, "Brakuje wymaganego pliku lub plik jest za duży.");
        try (InputStream input = new FileInputStream(file)) {
            return read(input, limit);
        }
    }

    private static byte[] read(InputStream input, int limit) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            require(count <= limit - output.size(), "Plik w pakiecie jest za duży.");
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private static void extract(ZipFile zip, Set<String> entries, String prefix, File target,
                                JSONObject manifest) throws IOException, JSONException {
        boolean isSnapshot = prefix.equals("snapshot/");
        validateManifest(manifest, isSnapshot);
        require(target.mkdirs(), "Nie udało się przygotować miejsca na rozdział.");
        for (Iterator<String> keys = manifest.keys(); keys.hasNext(); ) {
            String path = keys.next();
            String archivePath = prefix + path;
            require(entries.remove(archivePath), "W pakiecie brakuje pliku " + path);
            ZipEntry entry = zip.getEntry(archivePath);
            if (path.equals("chapter.json")) require(entry.getSize() <= CHAPTER_LIMIT, "Rozdział jest za duży.");
            File destination = new File(target, path);
            File parent = destination.getParentFile();
            require(parent != null && (parent.isDirectory() || parent.mkdirs()), "Nie udało się utworzyć katalogu.");
            try (InputStream input = zip.getInputStream(entry); FileOutputStream output = new FileOutputStream(destination)) {
                require(digest(input, output, entry.getSize()).equals(manifest.getString(path)),
                        "Uszkodzony plik w pakiecie: " + path);
                output.getFD().sync();
            }
        }
        if (isSnapshot) entries.remove("transfer.json");
        else entries.remove("runtime.json");
    }

    private static void validateManifest(JSONObject manifest, boolean snapshot) throws IOException, JSONException {
        require(manifest.length() <= ENTRY_LIMIT && manifest.has(snapshot ? "chapter.json" : "player.html"),
                "Manifest nie zawiera wymaganych plików.");
        for (Iterator<String> keys = manifest.keys(); keys.hasNext(); ) {
            String path = keys.next();
            boolean allowed = snapshot
                    ? path.equals("chapter.json") || artworkPath(path)
                    : !path.equals("chapter.json") && !path.equals("runtime.json");
            require(safePath(path) && allowed && HASH.matcher(manifest.getString(path)).matches(),
                    "Niedozwolony plik w manifeście.");
        }
    }

    /** Check references independently of the ZIP inventory, then let the Player validate the project model. */
    private static String chapterTitle(File chapter, JSONObject files) throws IOException {
        String formatError = "Pakiet nie zawiera rozdziału Nest w wersji 3.";
        try (JsonReader reader = new JsonReader(new InputStreamReader(new FileInputStream(chapter),
                StandardCharsets.UTF_8))) {
            boolean version = false, kind = false, library = false;
            String title = null, id = null;
            reader.beginObject();
            while (reader.hasNext()) {
                String property = reader.nextName();
                switch (property) {
                    case "version":
                        version = reader.peek() == JsonToken.NUMBER && "3".equals(reader.nextString());
                        require(version, formatError);
                        break;
                    case "kind":
                        kind = "nest-chapter".equals(string(reader));
                        break;
                    case "library":
                        library = reader.peek() == JsonToken.BEGIN_ARRAY;
                        inspectArt(reader, files, 1);
                        break;
                    case "chapter":
                        reader.beginObject();
                        while (reader.hasNext()) {
                            String key = reader.nextName();
                            if (key.equals("id")) id = string(reader);
                            else if (key.equals("name")) title = string(reader);
                            else inspectField(reader, files, key, 2);
                        }
                        reader.endObject();
                        break;
                    case "cardBack":
                        inspectCardBack(reader, files);
                        break;
                    default:
                        inspectField(reader, files, property, 1);
                }
            }
            reader.endObject();
            require(version && kind && library && id != null && !id.isEmpty() && title != null
                    && reader.peek() == JsonToken.END_DOCUMENT, formatError);
            return title;
        } catch (IllegalStateException e) {
            throw new IOException(formatError, e);
        }
    }

    private static String string(JsonReader reader) throws IOException {
        if (reader.peek() == JsonToken.STRING) return reader.nextString();
        reader.skipValue();
        return null;
    }

    private static void inspectCardBack(JsonReader reader, JSONObject files) throws IOException {
        reader.beginObject();
        while (reader.hasNext()) {
            String key = reader.nextName();
            if (key.equals("background")) checkArt(string(reader), files);
            else if (key.equals("icons")) {
                reader.beginObject();
                while (reader.hasNext()) {
                    String icon = reader.nextName();
                    if (icon.equals("default")) checkArt(string(reader), files);
                    else inspectField(reader, files, icon, 3);
                }
                reader.endObject();
            } else inspectField(reader, files, key, 2);
        }
        reader.endObject();
    }

    private static void inspectField(JsonReader reader, JSONObject files, String key, int depth) throws IOException {
        if (key.equals("image")) checkArt(string(reader), files);
        else inspectArt(reader, files, depth);
    }

    private static void inspectArt(JsonReader reader, JSONObject files, int depth) throws IOException {
        require(depth <= 256, "Struktura rozdziału jest zbyt głęboka.");
        switch (reader.peek()) {
            case BEGIN_OBJECT:
                reader.beginObject();
                while (reader.hasNext()) inspectField(reader, files, reader.nextName(), depth + 1);
                reader.endObject();
                break;
            case BEGIN_ARRAY:
                reader.beginArray();
                while (reader.hasNext()) inspectArt(reader, files, depth + 1);
                reader.endArray();
                break;
            default:
                reader.skipValue();
        }
    }

    private static void checkArt(String value, JSONObject files) throws IOException {
        if (value == null || value.trim().isEmpty() || INLINE_IMAGE.matcher(value).lookingAt()) return;
        Uri url = Uri.parse(value);
        String path = url.getPath();
        require(url.getScheme() == null && url.getEncodedAuthority() == null
                        && path != null && path.startsWith("/") && artworkPath(path.substring(1))
                        && files.has(path.substring(1)),
                "Pakiet nie zawiera lokalnego obrazu: " + value.substring(0, Math.min(240, value.length())));
    }

    private static boolean artworkPath(String path) {
        return path.startsWith("assets/img/") && IMAGE.matcher(path).matches()
                || path.startsWith("assets/dice/") && path.regionMatches(true, path.length() - 4, ".png", 0, 4);
    }

    private static void validateRuntime(Installation cached) throws IOException, JSONException {
        byte[] bytes = read(new File(cached.runtimeDir, "runtime.json"), METADATA_LIMIT);
        require(hash(bytes).equals(cached.runtime), "Nieprawidłowy manifest zachowanego Playera.");
        JSONObject manifest = object(bytes);
        validateManifest(manifest, false);
        long remaining = EXPANDED_LIMIT;
        for (Iterator<String> keys = manifest.keys(); keys.hasNext(); ) {
            String path = keys.next();
            File file = new File(cached.runtimeDir, path);
            require(file.isFile() && file.length() <= remaining, "Brakuje pliku zachowanego Playera.");
            long size = file.length();
            try (InputStream input = new FileInputStream(file)) {
                require(digest(input, null, size).equals(manifest.getString(path)), "Uszkodzony plik Playera.");
            }
            remaining -= size;
        }
    }

    private static MessageDigest sha256() {
        try {
            return MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException impossible) {
            throw new AssertionError(impossible);
        }
    }

    private static String hash(byte[] bytes) {
        return hex(sha256().digest(bytes));
    }

    private static String digest(InputStream input, FileOutputStream output, long size) throws IOException {
        MessageDigest hash = sha256();
        byte[] buffer = new byte[32768];
        int count;
        while ((count = input.read(buffer)) != -1) {
            require(count <= size, "Plik jest większy niż rozmiar zapisany w pakiecie.");
            size -= count;
            hash.update(buffer, 0, count);
            if (output != null) output.write(buffer, 0, count);
        }
        require(size == 0, "Niekompletny plik w pakiecie.");
        return hex(hash.digest());
    }

    private static String hex(byte[] bytes) {
        char[] alphabet = "0123456789abcdef".toCharArray();
        char[] result = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            result[2 * i] = alphabet[(bytes[i] & 0xff) >>> 4];
            result[2 * i + 1] = alphabet[bytes[i] & 0xf];
        }
        return new String(result);
    }

    private static JSONObject object(byte[] bytes) throws JSONException {
        return new JSONObject(new String(bytes, StandardCharsets.UTF_8));
    }

    private static void require(boolean condition, String message) throws IOException {
        if (!condition) throw new IOException(message);
    }

    private static void writeAtomic(File file, byte[] bytes) throws IOException {
        File temp = new File(file.getPath() + ".new");
        try {
            try (FileOutputStream output = new FileOutputStream(temp)) {
                output.write(bytes);
                output.getFD().sync();
            }
            Os.rename(temp.getPath(), file.getPath());
        } catch (ErrnoException e) {
            throw new IOException("Nie udało się atomowo zapisać pliku " + file.getName(), e);
        } finally {
            remove(temp);
        }
    }

    private static void prune(File root, String keep) {
        File[] generations = root.listFiles();
        if (generations == null) return;
        for (File generation : generations) {
            if (validToken(generation.getName()) && !generation.getName().equals(keep)) remove(generation);
        }
    }

    private static void remove(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) remove(child);
        if (!file.delete() && file.exists()) Log.w(TAG, "Could not remove " + file.getName());
    }
}
