package io.github.owenyu9292.deliverymaster;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "DocumentFile")
public class DocumentFilePlugin extends Plugin {
    private static final String JSON_MIME_TYPE = "application/json";

    @PluginMethod
    public void saveJson(PluginCall call) {
        String filename = call.getString("filename");
        String text = call.getString("text");
        if (filename == null || text == null) {
            call.reject("filename and text are required");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(JSON_MIME_TYPE);
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "handleSaveResult");
    }

    @PluginMethod
    public void openJson(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
            JSON_MIME_TYPE, "text/json", "text/plain", "application/octet-stream"
        });
        startActivityForResult(call, intent, "handleOpenResult");
    }

    @ActivityCallback
    private void handleSaveResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            resolveCanceled(call);
            return;
        }

        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) {
            call.reject("No document was selected");
            return;
        }

        String text = call.getString("text");
        if (text == null) {
            call.reject("text is required");
            return;
        }

        try (OutputStream output = getContext().getContentResolver().openOutputStream(uri)) {
            if (output == null) {
                call.reject("Unable to open the selected document");
                return;
            }
            output.write(text.getBytes(StandardCharsets.UTF_8));
            output.flush();
            JSObject response = new JSObject();
            response.put("canceled", false);
            response.put("uri", uri.toString());
            call.resolve(response);
        } catch (IOException | SecurityException error) {
            call.reject("Unable to save the JSON document", error);
        }
    }

    @ActivityCallback
    private void handleOpenResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_CANCELED) {
            resolveCanceled(call);
            return;
        }

        Intent data = result.getData();
        Uri uri = data == null ? null : data.getData();
        if (uri == null) {
            call.reject("No document was selected");
            return;
        }

        try (InputStream input = getContext().getContentResolver().openInputStream(uri)) {
            if (input == null) {
                call.reject("Unable to open the selected document");
                return;
            }
            String text = new String(readAllBytes(input), StandardCharsets.UTF_8);
            JSObject response = new JSObject();
            response.put("canceled", false);
            response.put("name", getDisplayName(uri));
            response.put("uri", uri.toString());
            response.put("text", text);
            call.resolve(response);
        } catch (IOException | SecurityException error) {
            call.reject("Unable to open the JSON document", error);
        }
    }

    private void resolveCanceled(PluginCall call) {
        JSObject response = new JSObject();
        response.put("canceled", true);
        call.resolve(response);
    }

    private byte[] readAllBytes(InputStream input) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int count;
        while ((count = input.read(buffer)) != -1) {
            output.write(buffer, 0, count);
        }
        return output.toByteArray();
    }

    private String getDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(
            uri,
            new String[]{OpenableColumns.DISPLAY_NAME},
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameIndex >= 0) {
                    String displayName = cursor.getString(nameIndex);
                    if (displayName != null && !displayName.isEmpty()) {
                        return displayName;
                    }
                }
            }
        } catch (RuntimeException ignored) {
            // Fall back to the URI when a document provider has no metadata.
        }
        String fallback = uri.getLastPathSegment();
        return fallback == null ? "document.json" : fallback;
    }
}
