package org.nest.playtest;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.BiConsumer;
import java.util.function.Consumer;

/** Reuses the web Player on a private origin without a network permission or local file URLs. */
final class LocalPlayer extends WebView {
    private static final String HOST = "nest-playtest.invalid";
    private static final String PLAYER_URL = "https://" + HOST + "/player.html?android=1";
    private final TransferStore.Installation files;

    @SuppressLint("SetJavaScriptEnabled")
    LocalPlayer(Context context, TransferStore.Installation files, BiConsumer<LocalPlayer, String> ready,
                Consumer<LocalPlayer> rendererGone) {
        super(context);
        this.files = files;
        setBackgroundColor(Color.BLACK);
        setOverScrollMode(OVER_SCROLL_NEVER);
        WebSettings settings = getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setBlockNetworkLoads(true);
        settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
        settings.setDomStorageEnabled(true);
        setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return serve(request);
            }

            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !local(request.getUrl())
                        || request.isForMainFrame() && !"/player.html".equals(request.getUrl().getPath());
            }

            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) ready.accept(LocalPlayer.this, "Nie udało się otworzyć lokalnego Playera.");
            }

            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                rendererGone.accept(LocalPlayer.this);
                return true;
            }
        });
        addJavascriptInterface(new ReadyBridge(result -> ready.accept(this, result)), "NestAndroid");
    }

    void playFromStart() {
        loadUrl(PLAYER_URL);
    }

    public static final class ReadyBridge {
        private final Consumer<String> callback;

        ReadyBridge(Consumer<String> callback) {
            this.callback = callback;
        }

        @JavascriptInterface public void ready(String error) {
            callback.accept(error == null ? "Brak wyniku uruchomienia Playera." : error);
        }
    }

    private static boolean local(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getEncodedAuthority());
    }

    private WebResourceResponse serve(WebResourceRequest request) {
        Uri url = request.getUrl();
        // Authored inline art and the bundled dice worker can use data: URLs.
        if (!request.isForMainFrame() && "data".equals(url.getScheme())) return null;
        String method = request.getMethod();
        String path = url.getPath();
        if (!local(url) || path == null || !path.startsWith("/")
                || !("GET".equals(method) || "HEAD".equals(method))) return unavailable();
        path = path.substring(1);
        if (!TransferStore.safePath(path) || "runtime.json".equals(path)) return unavailable();

        File source = new File(files.snapshotDir, path);
        if (!source.isFile()) source = new File(files.runtimeDir, path);
        if (!source.isFile()) return unavailable();
        try {
            String mime = mimeType(path);
            Map<String, String> headers = headers();
            headers.put("Content-Length", Long.toString(source.length()));
            return new WebResourceResponse(mime, isText(mime) ? "UTF-8" : null,
                    200, "OK", headers, "HEAD".equals(method)
                    ? new ByteArrayInputStream(new byte[0]) : new FileInputStream(source));
        } catch (FileNotFoundException e) {
            return unavailable();
        }
    }

    private static Map<String, String> headers() {
        Map<String, String> headers = new HashMap<>();
        headers.put("Cache-Control", "no-store");
        headers.put("X-Content-Type-Options", "nosniff");
        return headers;
    }

    private static WebResourceResponse unavailable() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not found", headers(),
                new ByteArrayInputStream(new byte[0]));
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml");
    }

    private static String mimeType(String path) {
        switch (path.substring(path.lastIndexOf('.') + 1).toLowerCase(Locale.ROOT)) {
            case "html": return "text/html";
            case "js": return "text/javascript";
            case "css": return "text/css";
            case "json": return "application/json";
            case "wasm": return "application/wasm";
            case "png": return "image/png";
            case "jpg":
            case "jpeg": return "image/jpeg";
            case "svg": return "image/svg+xml";
            case "gif": return "image/gif";
            case "webp": return "image/webp";
            case "ttf": return "font/ttf";
            default: return "application/octet-stream";
        }
    }
}
