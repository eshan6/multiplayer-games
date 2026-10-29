package com.multiplayergames.containment;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * A full-screen WebView around the game's single HTML file, bundled in assets.
 * The game itself is unchanged; this shell only adds what a browser tab lacks:
 * immersive full screen, the back button, and pausing with the app lifecycle.
 */
public class MainActivity extends Activity {
    private static final String GAME = "file:///android_asset/index.html";
    private static final int CHROME = Color.rgb(11, 16, 20);
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        Window w = getWindow();
        w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        w.setStatusBarColor(CHROME);
        w.setNavigationBarColor(CHROME);

        web = createWebView();
        setContentView(web);
        hideSystemBars();
        if (state != null) web.restoreState(state);
        if (web.getUrl() == null) web.loadUrl(GAME);
    }

    private WebView createWebView() {
        WebView v = new WebView(this);
        v.setBackgroundColor(CHROME);
        v.setOverScrollMode(View.OVER_SCROLL_NEVER);
        v.setVerticalScrollBarEnabled(false);
        v.setHorizontalScrollBarEnabled(false);

        WebSettings s = v.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);                 // saves, settings and stars live in localStorage
        s.setMediaPlaybackRequiresUserGesture(false); // music starts on the first tap, as in a browser
        s.setTextZoom(100);                           // the layout is designed at 100%; system font scaling would break it
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);

        v.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("file".equals(u.getScheme())) return false;
                // Anything outside the game opens in the browser instead of replacing it.
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
                return true;
            }

            // Android can kill the WebView's renderer under memory pressure. Without this the
            // whole app crashes; with it the game reloads and offers Continue from its last save.
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (view == web) {
                    web = createWebView();
                    setContentView(web);
                    web.loadUrl(GAME);
                }
                view.destroy();
                return true;
            }
        });
        return v;
    }

    /** Immersive full screen: bars hidden, a swipe from the edge shows them briefly. */
    @SuppressWarnings("deprecation")
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(true);
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    /** Back closes the open panel, then opens the pause menu, and only quits from the title screen. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript(
            "(function(){var a=window.__containmentApp;return a?a.back():'exit';})()",
            result -> { if (result != null && result.contains("exit")) finish(); });
    }

    @Override
    protected void onPause() {
        web.evaluateJavascript("window.__containmentApp&&window.__containmentApp.pause()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        web.evaluateJavascript("window.__containmentApp&&window.__containmentApp.resume()", null);
        hideSystemBars();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }
}
