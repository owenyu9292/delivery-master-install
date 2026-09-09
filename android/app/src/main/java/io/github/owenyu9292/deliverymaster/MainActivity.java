package io.github.owenyu9292.deliverymaster;

import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebSettings;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocumentFilePlugin.class);
        super.onCreate(savedInstanceState);

        WebSettings settings = getBridge().getWebView().getSettings();
        settings.setStandardFontFamily("sans-serif");
        settings.setSansSerifFontFamily("sans-serif");
        settings.setTextZoom(Math.round(getResources().getConfiguration().fontScale * 100));
        getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE);

        // Android 15+ renders edge-to-edge. Keep controls clear of system bars.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        View content = findViewById(android.R.id.content);
        ViewCompat.setOnApplyWindowInsetsListener(content, (view, insets) -> {
            int handledTypes = WindowInsetsCompat.Type.systemBars()
                | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime();
            Insets safe = insets.getInsets(handledTypes);
            view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            // The root has applied these insets. Passing them on pads the WebView twice.
            // Explicit zeroes also let Chromium recalculate safe areas when IME closes.
            return new WindowInsetsCompat.Builder(insets)
                .setInsets(handledTypes, Insets.NONE)
                .setInsetsIgnoringVisibility(
                    WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout(), Insets.NONE
                )
                .setVisible(handledTypes, false)
                .build();
        });
        ViewCompat.requestApplyInsets(content);
    }
}
