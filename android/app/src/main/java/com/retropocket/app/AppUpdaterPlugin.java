package com.retropocket.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * In-app updates for the APK (www/js/updates.js).
 *  download({url})       -> downloads into cache/updates/ (follows redirects), emits "progress" {received, total, percent},
 *                           then VERIFIES the file: valid APK, same package name, same signing certificate as the running app,
 *                           higher versionCode. Rejects (and deletes the file) with code BAD_APK / WRONG_PACKAGE / WRONG_SIGNER / NOT_NEWER.
 *                           Resolves {path, versionCode, versionName, packageName, certSha256, size}.
 *  cancel()              -> aborts a running download (the download call rejects with code CANCELLED)
 *  canInstall()          -> {allowed}  (Android 8+: "Install unknown apps" for this app)
 *  openInstallSettings() -> opens Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES for this package, resolves {allowed} when the user comes back
 *  install({path})       -> re-verifies the file, then opens the system package installer via FileProvider (ACTION_VIEW / ACTION_INSTALL_PACKAGE)
 *  pending()             -> deletes stale downloads (partial, broken, or not newer than the installed app) and returns the newest
 *                           verified download still waiting to be installed: {path?, versionCode?, versionName?}
 *  info()                -> {versionCode, versionName, packageName, certSha256} of the running app
 */
@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String DIR = "updates";
    private static final int MAX_REDIRECTS = 8;
    private final AtomicBoolean cancelled = new AtomicBoolean(false);
    private volatile Thread worker = null;
    private volatile HttpURLConnection conn = null;

    private File dir() {
        File d = new File(getContext().getCacheDir(), DIR);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    // ---------- package / signer helpers ----------
    private static long code(PackageInfo p) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? p.getLongVersionCode() : p.versionCode;
    }

    @SuppressWarnings("deprecation")
    private static Signature[] signers(PackageInfo p) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && p.signingInfo != null) {
            return p.signingInfo.hasMultipleSigners() ? p.signingInfo.getApkContentsSigners() : p.signingInfo.getSigningCertificateHistory();
        }
        return p.signatures;
    }

    @SuppressWarnings("deprecation")
    private static int sigFlag() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
    }

    private static String sha256(byte[] b) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(b);
            StringBuilder s = new StringBuilder();
            for (byte x : d) s.append(String.format("%02x", x));
            return s.toString();
        } catch (Exception e) { return ""; }
    }

    private static Set<String> certs(PackageInfo p) {
        Set<String> out = new HashSet<>();
        Signature[] s = signers(p);
        if (s != null) for (Signature x : s) out.add(sha256(x.toByteArray()));
        return out;
    }

    private PackageInfo self() throws PackageManager.NameNotFoundException {
        Context c = getContext();
        return c.getPackageManager().getPackageInfo(c.getPackageName(), sigFlag());
    }

    private PackageInfo archive(File f) {
        PackageManager pm = getContext().getPackageManager();
        PackageInfo p = pm.getPackageArchiveInfo(f.getAbsolutePath(), sigFlag());
        if (p != null && p.applicationInfo != null) {
            p.applicationInfo.sourceDir = f.getAbsolutePath();
            p.applicationInfo.publicSourceDir = f.getAbsolutePath();
        }
        return p;
    }

    /** Throws VerifyError(code, message) when the file must not be installed. */
    private static class Bad extends Exception {
        final String code;
        Bad(String code, String msg) { super(msg); this.code = code; }
    }

    private JSObject verify(File f) throws Bad {
        if (f == null || !f.isFile() || f.length() < 1024) throw new Bad("BAD_APK", "The download is empty or incomplete.");
        PackageInfo p = archive(f);
        if (p == null) throw new Bad("BAD_APK", "The downloaded file is not a valid Android app.");
        PackageInfo me;
        try { me = self(); } catch (Exception e) { throw new Bad("BAD_APK", "Cannot read the installed app: " + e.getMessage()); }
        if (!me.packageName.equals(p.packageName)) throw new Bad("WRONG_PACKAGE", "The download is a different app (" + p.packageName + ").");
        Set<String> mine = certs(me), theirs = certs(p);
        String theirCert = theirs.isEmpty() ? "" : theirs.iterator().next();
        if (theirs.isEmpty() || mine.isEmpty() || !theirs.containsAll(mine) && !mine.containsAll(theirs)) {
            throw new Bad("WRONG_SIGNER", "The download is signed with a different key (" + (theirCert.length() > 12 ? theirCert.substring(0, 12) : theirCert) + "…), so Android would refuse to update. Uninstall and reinstall from the release page instead.");
        }
        if (code(p) <= code(me)) throw new Bad("NOT_NEWER", "The download (version " + p.versionName + ") is not newer than the installed app (" + me.versionName + ").");
        JSObject r = new JSObject();
        r.put("path", f.getAbsolutePath());
        r.put("packageName", p.packageName);
        r.put("versionCode", code(p));
        r.put("versionName", p.versionName);
        r.put("certSha256", theirCert);
        r.put("size", f.length());
        return r;
    }

    // ---------- plugin methods ----------
    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo me = self();
            Set<String> c = certs(me);
            JSObject r = new JSObject();
            r.put("packageName", me.packageName);
            r.put("versionCode", code(me));
            r.put("versionName", me.versionName);
            r.put("certSha256", c.isEmpty() ? "" : c.iterator().next());
            call.resolve(r);
        } catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject r = new JSObject();
        r.put("allowed", allowed());
        call.resolve(r);
    }

    private boolean allowed() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) { canInstall(call); return; }
        Intent i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        try { startActivityForResult(call, i, "settingsResult"); }
        catch (Exception e) { call.reject("Cannot open the settings screen: " + e.getMessage(), "NO_SETTINGS"); }
    }

    @ActivityCallback
    private void settingsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        r.put("allowed", allowed());
        call.resolve(r);
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        cancelled.set(true);
        HttpURLConnection c = conn;
        if (c != null) try { c.disconnect(); } catch (Exception ignored) {}
        call.resolve();
    }

    @PluginMethod
    public void download(final PluginCall call) {
        final String url = call.getString("url");
        if (url == null || !url.startsWith("https://")) { call.reject("An https URL is required", "BAD_URL"); return; }
        if (worker != null && worker.isAlive()) { call.reject("A download is already running", "BUSY"); return; }
        cancelled.set(false);
        worker = new Thread(() -> runDownload(call, url), "AppUpdater-download");
        worker.start();
    }

    private void runDownload(PluginCall call, String url) {
        File d = dir();
        for (File old : listOrEmpty(d)) old.delete();       // only one update at a time: drop older / partial downloads
        File part = new File(d, "RetroPocket-update.apk.part");
        File done = new File(d, "RetroPocket-update-" + System.currentTimeMillis() + ".apk");
        try {
            HttpURLConnection c = open(url);
            long total = c.getContentLengthLong(), received = 0, lastEmit = 0;
            int lastPct = -1;
            try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(part)) {
                byte[] buf = new byte[64 * 1024];
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancelled.get()) throw new IOException("cancelled");
                    out.write(buf, 0, n);
                    received += n;
                    int pct = total > 0 ? (int) (received * 100 / total) : -1;
                    long now = System.currentTimeMillis();
                    if (pct != lastPct && now - lastEmit > 120 || pct == 100) {
                        lastPct = pct; lastEmit = now;
                        JSObject ev = new JSObject();
                        ev.put("received", received); ev.put("total", total); ev.put("percent", pct);
                        notifyListeners("progress", ev);
                    }
                }
            } finally { c.disconnect(); conn = null; }
            if (cancelled.get()) throw new IOException("cancelled");
            if (total > 0 && received != total) throw new IOException("Download interrupted (" + received + " of " + total + " bytes)");
            if (!part.renameTo(done)) throw new IOException("Cannot save the download");
            try { call.resolve(verify(done)); }
            catch (Bad b) { done.delete(); call.reject(b.getMessage(), b.code); }
        } catch (Exception e) {
            part.delete(); done.delete();
            if (cancelled.get()) call.reject("Download cancelled", "CANCELLED");
            else call.reject("Download failed: " + e.getMessage(), "NETWORK");
        } finally {
            worker = null;
        }
    }

    /** GET with manual redirect handling (GitHub release assets redirect to another host). */
    private HttpURLConnection open(String url) throws IOException {
        String u = url;
        for (int i = 0; i <= MAX_REDIRECTS; i++) {
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(20000);
            c.setReadTimeout(30000);
            c.setRequestProperty("User-Agent", "RetroPocket-AppUpdater");
            c.setRequestProperty("Accept", "application/octet-stream");
            conn = c;
            if (cancelled.get()) throw new IOException("cancelled");
            int s = c.getResponseCode();
            if (s >= 300 && s < 400) {
                String loc = c.getHeaderField("Location");
                c.disconnect();
                if (loc == null) throw new IOException("Redirect without a location");
                URL next = new URL(new URL(u), loc);
                if (!"https".equals(next.getProtocol())) throw new IOException("Refusing a non-https redirect");
                u = next.toString();
                continue;
            }
            if (s != 200) { c.disconnect(); throw new IOException("HTTP " + s); }
            return c;
        }
        throw new IOException("Too many redirects");
    }

    private static File[] listOrEmpty(File d) {
        File[] f = d.listFiles();
        return f == null ? new File[0] : f;
    }

    private File inUpdates(String path) {
        if (path == null) return null;
        try {
            File f = new File(path).getCanonicalFile();
            return f.getParentFile() != null && f.getParentFile().equals(dir().getCanonicalFile()) ? f : null;
        } catch (IOException e) { return null; }
    }

    @PluginMethod
    public void install(PluginCall call) {
        File f = inUpdates(call.getString("path"));
        if (f == null || !f.isFile()) { call.reject("The downloaded update is missing; download it again.", "MISSING"); return; }
        try { verify(f); } catch (Bad b) { f.delete(); call.reject(b.getMessage(), b.code); return; }
        if (!allowed()) { call.reject("Allow Retro Pocket to install unknown apps first.", "NEEDS_PERMISSION"); return; }
        Context c = getContext();
        Uri uri = FileProvider.getUriForFile(c, c.getPackageName() + ".fileprovider", f);
        @SuppressWarnings("deprecation")
        Intent i = new Intent(Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? Intent.ACTION_VIEW : Intent.ACTION_INSTALL_PACKAGE);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        i.putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true);
        i.putExtra(Intent.EXTRA_INSTALLER_PACKAGE_NAME, c.getPackageName());
        try {
            c.startActivity(i);
            JSObject r = new JSObject();
            r.put("started", true);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("Cannot open the package installer: " + e.getMessage(), "NO_INSTALLER");
        }
    }

    @PluginMethod
    public void pending(PluginCall call) {
        JSObject best = new JSObject();
        long bestCode = -1;
        File keep = null;
        if (worker == null || !worker.isAlive()) {
            for (File f : listOrEmpty(dir())) {
                if (!f.getName().endsWith(".apk")) { f.delete(); continue; }
                try {
                    JSObject r = verify(f);
                    long vc = r.getLong("versionCode");
                    if (vc > bestCode) {
                        if (keep != null) keep.delete();
                        keep = f; bestCode = vc; best = r;
                    } else f.delete();
                } catch (Exception e) { f.delete(); }       // broken, foreign or already installed -> clean up
            }
        }
        call.resolve(best);
    }

    @Override
    protected void handleOnDestroy() {
        cancelled.set(true);
        super.handleOnDestroy();
    }
}
