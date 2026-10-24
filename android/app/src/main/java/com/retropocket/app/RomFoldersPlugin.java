package com.retropocket.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.provider.DocumentsContract;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileInputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayDeque;

/**
 * ROM folders for the APK via the Android Storage Access Framework.
 *  pick({initial})      -> ACTION_OPEN_DOCUMENT_TREE (starts in Download/), persists the read permission -> {uri, name}
 *  list({uri})          -> recursive listing -> {files:[{id, path, name, size, mtime}]}
 *  read({id, offset, length}) -> {data: base64, eof}  (chunked so big disc images do not have to cross the bridge at once)
 *  check({uri})         -> {ok} is the persisted permission still held?
 *  release({uri})       -> drops the persisted permission
 * No storage permission is needed: access is limited to the folders the user picks.
 */
@CapacitorPlugin(name = "RomFolders")
public class RomFoldersPlugin extends Plugin {
    private static final int MAX_FILES = 20000;
    private static final int MAX_DEPTH = 8;

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        String initial = call.getString("initial", "Download");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && initial != null && !initial.isEmpty()) {
            intent.putExtra(DocumentsContract.EXTRA_INITIAL_URI,
                Uri.parse("content://com.android.externalstorage.documents/document/primary%3A" + Uri.encode(initial)));
        }
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.resolve(new JSObject());        // cancelled -> {} (JS treats a missing uri as "cancelled")
            return;
        }
        Uri tree = result.getData().getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException e) {
            call.reject("Could not keep access to that folder: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", displayName(tree));
        call.resolve(ret);
    }

    private String displayName(Uri tree) {
        String docId = DocumentsContract.getTreeDocumentId(tree);
        Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, docId);
        try (Cursor c = getContext().getContentResolver().query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst()) return c.getString(0);
        } catch (Exception ignored) { }
        int i = docId.lastIndexOf(':');
        return i >= 0 ? docId.substring(i + 1) : docId;
    }

    @PluginMethod
    public void list(PluginCall call) {
        String uriStr = call.getString("uri");
        if (uriStr == null) { call.reject("uri missing"); return; }
        Uri tree = Uri.parse(uriStr);
        ContentResolver cr = getContext().getContentResolver();
        JSArray files = new JSArray();
        ArrayDeque<String[]> queue = new ArrayDeque<>();      // {documentId, relative path prefix, depth}
        queue.add(new String[]{DocumentsContract.getTreeDocumentId(tree), "", "0"});
        String[] cols = {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE, DocumentsContract.Document.COLUMN_SIZE, DocumentsContract.Document.COLUMN_LAST_MODIFIED
        };
        int count = 0;
        try {
            while (!queue.isEmpty() && count < MAX_FILES) {
                String[] cur = queue.poll();
                int depth = Integer.parseInt(cur[2]);
                Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, cur[0]);
                try (Cursor c = cr.query(children, cols, null, null, null)) {
                    if (c == null) continue;
                    while (c.moveToNext() && count < MAX_FILES) {
                        String id = c.getString(0), name = c.getString(1), mime = c.getString(2);
                        if (name == null || name.startsWith(".")) continue;
                        if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                            if (depth < MAX_DEPTH) queue.add(new String[]{id, cur[1] + name + "/", String.valueOf(depth + 1)});
                            continue;
                        }
                        JSObject f = new JSObject();
                        f.put("id", DocumentsContract.buildDocumentUriUsingTree(tree, id).toString());
                        f.put("path", cur[1] + name);
                        f.put("name", name);
                        f.put("size", c.isNull(3) ? 0 : c.getLong(3));
                        f.put("mtime", c.isNull(4) ? 0 : c.getLong(4));
                        files.put(f);
                        count++;
                    }
                }
            }
        } catch (SecurityException e) {
            call.reject("Access to this folder was lost — add it again", "PERMISSION");
            return;
        } catch (Exception e) {
            call.reject("Could not list folder: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("files", files);
        ret.put("truncated", count >= MAX_FILES);
        call.resolve(ret);
    }

    @PluginMethod
    public void read(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("id missing"); return; }
        long offset = call.getLong("offset", 0L);
        int length = call.getInt("length", 3 * 1024 * 1024);
        if (length <= 0 || length > 16 * 1024 * 1024) length = 3 * 1024 * 1024;
        try (ParcelFileDescriptor pfd = getContext().getContentResolver().openFileDescriptor(Uri.parse(id), "r")) {
            if (pfd == null) { call.reject("Could not open file"); return; }
            try (FileInputStream in = new FileInputStream(pfd.getFileDescriptor())) {
                FileChannel ch = in.getChannel();
                long size = ch.size();
                ch.position(offset);
                ByteBuffer buf = ByteBuffer.allocate((int) Math.max(0, Math.min(length, size - offset)));
                while (buf.hasRemaining()) { if (ch.read(buf) < 0) break; }
                JSObject ret = new JSObject();
                ret.put("data", Base64.encodeToString(buf.array(), 0, buf.position(), Base64.NO_WRAP));
                ret.put("eof", offset + buf.position() >= size);
                ret.put("size", size);
                call.resolve(ret);
            }
        } catch (SecurityException e) {
            call.reject("Access to this folder was lost — add it again", "PERMISSION");
        } catch (Exception e) {
            call.reject("Could not read file: " + e.getMessage());
        }
    }

    @PluginMethod
    public void check(PluginCall call) {
        String uriStr = call.getString("uri", "");
        boolean ok = false;
        for (UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.isReadPermission() && p.getUri().toString().equals(uriStr)) { ok = true; break; }
        }
        JSObject ret = new JSObject();
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void release(PluginCall call) {
        try {
            getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(call.getString("uri", "")), Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) { }
        call.resolve();
    }
}
