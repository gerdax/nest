package org.nest.playtest;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.util.Log;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONException;

import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native chrome and a two-phase install: validate in a candidate Player, then publish and swap. */
public final class MainActivity extends Activity {
    private static final String TAG = "NestPlaytest";
    private static final String IMPORT = "org.nest.playtest.IMPORT";
    private static final long TRANSFER_BUDGET_MS = 60_000;
    private static final long PLAYER_BUDGET_MS = 40_000;
    private static final ExecutorService DISK = Executors.newSingleThreadExecutor();

    private final Handler main = new Handler(Looper.getMainLooper());
    private TransferStore store;
    private TextView status;
    private TextView title;
    private Button restart;
    private FrameLayout playfield;
    private LocalPlayer player;
    private TransferStore.Installation current;
    private Job pending;
    private boolean destroyed;

    private static final class Job {
        final String token;
        final long deadline = SystemClock.elapsedRealtime() + TRANSFER_BUDGET_MS;
        TransferStore.Installation prepared;
        LocalPlayer candidate;
        Runnable timeout;

        Job(String token) {
            this.token = token;
        }
    }

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = new TransferStore(getFilesDir());
        buildLayout();
        immersive();
        try {
            current = store.active();
            if (current != null) {
                TransferStore.Installation restored = current;
                DISK.execute(() -> store.cleanup(restored));
                showCurrent();
            }
        } catch (IOException | JSONException e) {
            status.setText("Nie udało się otworzyć poprzedniego rozdziału. Prześlij go ponownie ze Studio.");
            Log.w(TAG, "Cannot restore installation", e);
        }
        receive(getIntent());
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        receive(intent);
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) immersive();
    }

    @Override protected void onDestroy() {
        destroyed = true;
        if (pending != null) fail(pending, "Otwarcie rozdziału zostało przerwane. Spróbuj ponownie.", false);
        destroyPlayer(player);
        super.onDestroy();
    }

    private void receive(Intent intent) {
        if (intent == null || !IMPORT.equals(intent.getAction())) return;
        String token = intent.getStringExtra("token");
        // The launcher should not repeat a transfer on activity recreation.
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN));
        // An exported launcher intent can request import only for an actual private upload.
        if (!TransferStore.validToken(token) || !store.hasIncoming(token)) return;
        if (pending != null) {
            if (!pending.token.equals(token)) {
                DISK.execute(() -> store.acknowledge(token, "Trwa inny transfer. Spróbuj ponownie.", false));
            }
            return;
        }
        Job job = new Job(token);
        pending = job;
        if (player == null) {
            status.setVisibility(View.VISIBLE);
            status.setText("Otwieranie rozdziału…");
        }
        DISK.execute(() -> {
            try {
                TransferStore.Installation prepared = store.prepare(token);
                main.post(() -> validate(job, prepared));
            } catch (IOException | JSONException | RuntimeException e) {
                Log.w(TAG, "Rejected import " + token, e);
                main.post(() -> fail(job, message(e), e instanceof TransferStore.CachedRuntimeException));
            }
        });
    }

    private void validate(Job job, TransferStore.Installation prepared) {
        if (pending != job || destroyed) {
            DISK.execute(() -> store.discard(prepared.token));
            return;
        }
        job.prepared = prepared;
        long timeLeft = job.deadline - SystemClock.elapsedRealtime();
        if (timeLeft <= 0) {
            fail(job, "Upłynął czas przygotowania rozdziału. Spróbuj ponownie.", false);
            return;
        }
        try {
            job.candidate = createPlayer(prepared);
            // Keep the candidate laid out so the deck can measure its viewport before it goes live.
            job.candidate.setAlpha(0f);
            job.candidate.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
            playfield.addView(job.candidate, 0);
            job.timeout = () -> fail(job, "Player nie otworzył rozdziału w wyznaczonym czasie. Sprawdź Android System WebView.", false);
            main.postDelayed(job.timeout, Math.min(timeLeft, PLAYER_BUDGET_MS));
            job.candidate.playFromStart();
        } catch (RuntimeException e) {
            Log.w(TAG, "Cannot launch WebView", e);
            fail(job, "Nie można uruchomić Android System WebView.", false);
        }
    }

    private LocalPlayer createPlayer(TransferStore.Installation installation) {
        return new LocalPlayer(this, installation, (view, error) -> main.post(() -> ready(view, error)),
                this::playerGone);
    }

    private void ready(LocalPlayer view, String error) {
        if (destroyed) return;
        if (view == player) {
            status.setVisibility(error.isEmpty() ? View.GONE : View.VISIBLE);
            if (!error.isEmpty()) {
                status.setText(shorten(error));
                status.bringToFront();
            }
            return;
        }
        Job job = pending;
        if (job == null || view != job.candidate) return;
        if (!error.isEmpty()) {
            fail(job, error, false);
            return;
        }
        if (SystemClock.elapsedRealtime() > job.deadline) {
            fail(job, "Upłynął czas uruchomienia rozdziału. Spróbuj ponownie.", false);
            return;
        }
        try {
            // Keep the small pointer write and UI swap in one main-thread callback.
            // A candidate render failure or activity teardown cannot intervene between them.
            store.commit(job.prepared);
        } catch (IOException | JSONException e) {
            Log.w(TAG, "Cannot commit import " + job.token, e);
            fail(job, message(e), false);
            return;
        }
        publish(job);
    }

    private void publish(Job job) {
        pending = null;
        main.removeCallbacks(job.timeout);
        destroyPlayer(player);
        current = job.prepared;
        player = job.candidate;
        player.setAlpha(1f);
        player.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
        player.bringToFront();
        showTitle();
        status.setVisibility(View.GONE);
        restart.setEnabled(true);
        DISK.execute(() -> {
            // Release the previous view before deleting its runtime or chapter files.
            store.cleanup(job.prepared);
            store.acknowledge(job.token, null, false);
        });
    }

    private void fail(Job job, String error, boolean retryRuntime) {
        if (pending != job) return;
        pending = null;
        if (job.timeout != null) main.removeCallbacks(job.timeout);
        destroyPlayer(job.candidate);
        if (!destroyed && player == null) {
            status.setText(error);
            status.setVisibility(View.VISIBLE);
        }
        DISK.execute(() -> {
            if (job.prepared != null) store.discard(job.token);
            store.acknowledge(job.token, shorten(error), retryRuntime);
        });
    }

    private void showCurrent() {
        showTitle();
        restart.setEnabled(true);
        status.setText("Otwieranie rozdziału…");
        status.bringToFront();
        status.setVisibility(View.VISIBLE);
        try {
            player = createPlayer(current);
            playfield.addView(player, 0);
            player.playFromStart();
        } catch (RuntimeException e) {
            Log.w(TAG, "Cannot restore WebView", e);
            destroyPlayer(player);
            player = null;
            status.setText("Nie można uruchomić Android System WebView.");
        }
    }

    private void showTitle() {
        title.setText(current.title);
        restart.setVisibility(View.VISIBLE);
    }

    private void playerGone(LocalPlayer view) {
        if (view == player) {
            destroyPlayer(view);
            player = null;
            status.setText("WebView zamknął się. Naciśnij Restart, aby ponownie otworzyć rozdział.");
            status.setVisibility(View.VISIBLE);
            restart.setEnabled(current != null);
        } else if (pending != null && view == pending.candidate) {
            fail(pending, "WebView zamknął się podczas otwierania rozdziału.", false);
        }
    }

    private void destroyPlayer(LocalPlayer view) {
        if (view == null) return;
        playfield.removeView(view);
        view.destroy();
    }

    private static String message(Exception e) {
        return e.getMessage() == null ? "Nie udało się zainstalować pakietu na telefonie." : e.getMessage();
    }

    private static String shorten(String text) {
        return text.length() <= 2000 ? text : text.substring(0, 2000) + "…";
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private void buildLayout() {
        FrameLayout layout = new FrameLayout(this);
        layout.setBackgroundColor(Color.BLACK);
        layout.setOnApplyWindowInsetsListener((view, insets) -> {
            DisplayCutout cutout = insets.getDisplayCutout();
            if (cutout != null) {
                view.setPadding(cutout.getSafeInsetLeft(), cutout.getSafeInsetTop(),
                        cutout.getSafeInsetRight(), cutout.getSafeInsetBottom());
            } else {
                view.setPadding(0, 0, 0, 0);
            }
            return insets;
        });

        playfield = new FrameLayout(this);
        status = new TextView(this);
        status.setGravity(Gravity.CENTER);
        status.setTextColor(Color.rgb(220, 229, 206));
        status.setText("Połącz telefon przez USB i wybierz „Transfer na Androida” w Nest Studio.");
        status.setPadding(dp(24), dp(24), dp(24), dp(24));
        status.setBackgroundColor(Color.BLACK);
        playfield.addView(status, new FrameLayout.LayoutParams(-1, -1));
        layout.addView(playfield, new FrameLayout.LayoutParams(-1, -1));

        // This transparent sibling reserves no playfield space. Only Restart handles touches.
        LinearLayout overlay = new LinearLayout(this);
        overlay.setGravity(Gravity.CENTER_VERTICAL);
        overlay.setPadding(dp(12), 0, 0, 0);
        title = new TextView(this);
        title.setTextSize(10);
        title.setSingleLine();
        title.setEllipsize(TextUtils.TruncateAt.END);
        title.setTextColor(Color.rgb(29, 33, 27));
        title.setShadowLayer(dp(2), 0, 0, Color.BLACK);
        overlay.addView(title, new LinearLayout.LayoutParams(0, -2, 1));
        restart = new Button(this);
        restart.setText("Restart");
        restart.setAllCaps(false);
        restart.setTextSize(11);
        restart.setLetterSpacing(0);
        restart.setTextColor(Color.rgb(38, 43, 35));
        restart.setShadowLayer(dp(2), 0, 0, Color.BLACK);
        restart.setBackground(null);
        restart.setStateListAnimator(null);
        restart.setMinimumWidth(dp(48));
        restart.setMinWidth(dp(48));
        restart.setPadding(dp(12), 0, dp(12), 0);
        restart.setVisibility(View.INVISIBLE);
        restart.setEnabled(false);
        restart.setOnClickListener(view -> {
            if (player != null) player.reload();
            else if (current != null) showCurrent();
        });
        overlay.addView(restart, new LinearLayout.LayoutParams(-2, dp(48)));
        layout.addView(overlay, new FrameLayout.LayoutParams(-1, dp(48), Gravity.BOTTOM));
        setContentView(layout);
        layout.requestApplyInsets();
    }

    @SuppressWarnings("deprecation")
    private void immersive() {
        Window window = getWindow();
        WindowManager.LayoutParams attributes = window.getAttributes();
        attributes.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        window.setAttributes(attributes);
        if (Build.VERSION.SDK_INT >= 30) {
            window.setDecorFitsSystemWindows(false);
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsets.Type.systemBars());
            }
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }
}
