// Expo config plugin: adds a native Android module that records BOTH sides of a WebRTC call.
// It installs a JavaAudioDeviceModule (via reflection, so it compiles regardless of react-native-webrtc
// internals) whose callbacks hand us the microphone samples and the remote-playback samples; they are
// mixed into one 16 kHz mono WAV and published to Music/Hellocat Recordings.
const { withDangerousMod, withMainApplication } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const ENGINE = `package __PKG__.callrec

import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.MediaScannerConnection
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.atomic.AtomicLong

object CallRecEngine {
    private const val TAG = "CallRec"
    private const val OUT_RATE = 16000

    @Volatile var installed = false
    @Volatile private var active = false
    private val micQ = ConcurrentLinkedQueue<ShortArray>()
    private val spkQ = ConcurrentLinkedQueue<ShortArray>()
    val micCount = AtomicLong(0)
    val spkCount = AtomicLong(0)
    private var writer: Thread? = null
    private var outFile: File? = null
    @Volatile private var framesWritten = 0L

    // Called from MainApplication.onCreate, before react-native-webrtc creates its PeerConnectionFactory.
    fun installAdm(app: Context) {
        try {
            val jadm = Class.forName("org.webrtc.audio.JavaAudioDeviceModule")
            val builderCls = Class.forName("org.webrtc.audio.JavaAudioDeviceModule\\$Builder")
            val micCb = Class.forName("org.webrtc.audio.JavaAudioDeviceModule\\$SamplesReadyCallback")
            val spkCb = Class.forName("org.webrtc.audio.JavaAudioDeviceModule\\$PlaybackSamplesReadyCallback")

            fun proxyFor(cb: Class<*>, mic: Boolean): Any =
                Proxy.newProxyInstance(cb.classLoader, arrayOf(cb), InvocationHandler { p, m, args ->
                    when {
                        m.declaringClass == Any::class.java -> when (m.name) {
                            "equals" -> p === args?.get(0)
                            "hashCode" -> System.identityHashCode(p)
                            else -> "CallRecProxy"
                        }
                        args != null && args.isNotEmpty() -> { onSamples(args[0], mic); null }
                        else -> null
                    }
                })

            val builder = jadm.getMethod("builder", Context::class.java).invoke(null, app)!!
            builderCls.getMethod("setSamplesReadyCallback", micCb).invoke(builder, proxyFor(micCb, true))
            builderCls.getMethod("setPlaybackSamplesReadyCallback", spkCb).invoke(builder, proxyFor(spkCb, false))
            val adm = builderCls.getMethod("createAudioDeviceModule").invoke(builder)!!

            val optCls = Class.forName("com.oney.rnwebrtc.WebRTCModuleOptions")
            val inst = optCls.getMethod("getInstance").invoke(null)
            optCls.getField("audioDeviceModule").set(inst, adm)
            installed = true
            Log.i(TAG, "audio device module installed")
        } catch (t: Throwable) {
            installed = false
            Log.w(TAG, "could not install audio device module: " + t)
        }
    }

    private fun onSamples(s: Any, mic: Boolean) {
        if (!active) return
        try {
            val c = s.javaClass
            val fmt = c.getMethod("getAudioFormat").invoke(s) as Int
            if (fmt != AudioFormat.ENCODING_PCM_16BIT) return
            val rate = c.getMethod("getSampleRate").invoke(s) as Int
            val ch = c.getMethod("getChannelCount").invoke(s) as Int
            val data = c.getMethod("getData").invoke(s) as ByteArray
            val out = toMono16k(data, rate, ch)
            if (mic) { micQ.add(out); micCount.addAndGet(out.size.toLong()) }
            else { spkQ.add(out); spkCount.addAndGet(out.size.toLong()) }
        } catch (t: Throwable) { /* never break call audio */ }
    }

    private fun toMono16k(data: ByteArray, rate: Int, ch: Int): ShortArray {
        val channels = if (ch < 1) 1 else ch
        val frames = data.size / (2 * channels)
        val mono = ShortArray(frames)
        for (f in 0 until frames) {
            var sum = 0
            for (c in 0 until channels) {
                val i = (f * channels + c) * 2
                sum += ((data[i + 1].toInt() shl 8) or (data[i].toInt() and 0xff))
            }
            mono[f] = (sum / channels).toShort()
        }
        if (rate == OUT_RATE || rate <= 0) return mono
        val outLen = (frames.toLong() * OUT_RATE / rate).toInt()
        val out = ShortArray(outLen)
        val ratio = rate.toDouble() / OUT_RATE
        for (i in 0 until outLen) {
            val s0 = (i * ratio).toInt()
            val e = minOf(frames, maxOf(s0 + 1, ((i + 1) * ratio).toInt()))
            var sum = 0L
            var n = 0
            for (k in s0 until e) { sum += mono[k]; n++ }
            out[i] = if (n > 0) (sum / n).toShort() else 0
        }
        return out
    }

    private fun drain(q: ConcurrentLinkedQueue<ShortArray>): ShortArray {
        val parts = ArrayList<ShortArray>()
        var total = 0
        while (true) { val a = q.poll() ?: break; parts.add(a); total += a.size }
        val out = ShortArray(total)
        var p = 0
        for (a in parts) { System.arraycopy(a, 0, out, p, a.size); p += a.size }
        return out
    }

    @Synchronized
    fun start(f: File): Boolean {
        if (!installed || active) return false
        f.parentFile?.mkdirs()
        micQ.clear(); spkQ.clear(); micCount.set(0); spkCount.set(0)
        val fos = FileOutputStream(f)
        fos.write(ByteArray(44))
        outFile = f
        framesWritten = 0
        active = true
        val t = Thread { runWriter(fos) }
        t.name = "CallRecWriter"
        writer = t
        t.start()
        return true
    }

    private fun runWriter(fos: FileOutputStream) {
        val bos = BufferedOutputStream(fos, 65536)
        try {
            while (true) {
                val stopping = !active
                val a = drain(micQ)
                val b = drain(spkQ)
                val n = maxOf(a.size, b.size)
                if (n > 0) {
                    val buf = ByteArray(n * 2)
                    for (i in 0 until n) {
                        val v = (if (i < a.size) a[i].toInt() else 0) + (if (i < b.size) b[i].toInt() else 0)
                        val c = if (v > 32767) 32767 else if (v < -32768) -32768 else v
                        buf[i * 2] = (c and 0xff).toByte()
                        buf[i * 2 + 1] = ((c shr 8) and 0xff).toByte()
                    }
                    bos.write(buf)
                    framesWritten += n
                }
                if (stopping) break
                Thread.sleep(40)
            }
        } catch (t: Throwable) {
            Log.w(TAG, "writer error: " + t)
        } finally {
            try { bos.flush(); bos.close() } catch (t: Throwable) {}
        }
    }

    private fun patchHeader(f: File, frames: Long) {
        val dataLen = (frames * 2).toInt()
        val h = ByteArray(44)
        fun w32(o: Int, v: Int) { h[o] = v.toByte(); h[o + 1] = (v shr 8).toByte(); h[o + 2] = (v shr 16).toByte(); h[o + 3] = (v shr 24).toByte() }
        fun w16(o: Int, v: Int) { h[o] = v.toByte(); h[o + 1] = (v shr 8).toByte() }
        "RIFF".toByteArray().copyInto(h, 0); w32(4, 36 + dataLen)
        "WAVE".toByteArray().copyInto(h, 8); "fmt ".toByteArray().copyInto(h, 12)
        w32(16, 16); w16(20, 1); w16(22, 1); w32(24, OUT_RATE); w32(28, OUT_RATE * 2); w16(32, 2); w16(34, 16)
        "data".toByteArray().copyInto(h, 36); w32(40, dataLen)
        RandomAccessFile(f, "rw").use { it.seek(0); it.write(h) }
    }

    @Synchronized
    fun stop(ctx: Context): String? {
        if (!active) return null
        active = false
        try { writer?.join(4000) } catch (t: Throwable) {}
        writer = null
        val f = outFile ?: return null
        if (framesWritten < OUT_RATE / 2) { f.delete(); return null }
        patchHeader(f, framesWritten)
        publish(ctx, f)
        return f.absolutePath
    }

    fun canWriteDirect(ctx: Context): Boolean {
        return if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
        else if (Build.VERSION.SDK_INT <= 28) ctx.checkSelfPermission(android.Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED
        else false
    }

    fun publicDir(): File = File(Environment.getExternalStorageDirectory(), "Hellocat/Racordig")

    private fun mimeFor(name: String) = if (name.endsWith(".m4a")) "audio/mp4" else "audio/x-wav"

    // Copies a recording into /Hellocat/Racordig (needs All-files access on Android 11+).
    // Without that permission it falls back to Documents/Hellocat/Racordig, the closest place Android allows.
    fun publish(ctx: Context, f: File): String? {
        try {
            if (canWriteDirect(ctx)) {
                val dir = publicDir()
                dir.mkdirs()
                val dest = File(dir, f.name)
                f.copyTo(dest, true)
                MediaScannerConnection.scanFile(ctx, arrayOf(dest.absolutePath), null, null)
                return dest.absolutePath
            }
            if (Build.VERSION.SDK_INT >= 29) {
                val v = ContentValues()
                v.put(MediaStore.MediaColumns.DISPLAY_NAME, f.name)
                v.put(MediaStore.MediaColumns.MIME_TYPE, mimeFor(f.name))
                v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Documents/Hellocat/Racordig")
                v.put(MediaStore.MediaColumns.IS_PENDING, 1)
                val uri = ctx.contentResolver.insert(MediaStore.Files.getContentUri("external"), v) ?: return null
                ctx.contentResolver.openOutputStream(uri)?.use { o -> f.inputStream().use { it.copyTo(o) } }
                val v2 = ContentValues()
                v2.put(MediaStore.MediaColumns.IS_PENDING, 0)
                ctx.contentResolver.update(uri, v2, null, null)
                return "Documents/Hellocat/Racordig/" + f.name
            }
        } catch (t: Throwable) {
            Log.w(TAG, "could not publish recording: " + t)
        }
        return null
    }

    fun deletePublic(ctx: Context, name: String) {
        try {
            if (canWriteDirect(ctx)) {
                val d = File(publicDir(), name)
                if (d.exists()) d.delete()
            }
        } catch (t: Throwable) {}
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ctx.contentResolver.delete(MediaStore.Files.getContentUri("external"), "_display_name=? AND relative_path LIKE ?", arrayOf(name, "Documents/Hellocat/Racordig%"))
            }
        } catch (t: Throwable) {}
    }
}
`;

const RINGER = `package __PKG__.callrec

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.os.Build
import android.provider.Settings
import android.util.Log

// Plays the incoming-call ringtone on the RING stream (ring volume / silent mode), like a real phone call.
object RingtonePlayer {
    private var mp: MediaPlayer? = null
    private var focusReq: AudioFocusRequest? = null

    private fun attrs(): AudioAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()

    @Synchronized
    fun play(ctx: Context, kind: String, value: String, loop: Boolean): Boolean {
        stop(ctx)
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(attrs())
            if (kind == "raw") {
                val id = ctx.resources.getIdentifier(value, "raw", ctx.packageName)
                if (id == 0) { player.release(); return false }
                val afd = ctx.resources.openRawResourceFd(id)
                player.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
                afd.close()
            } else if (kind == "file") {
                player.setDataSource(value.removePrefix("file://"))
            } else {
                player.setDataSource(ctx, Settings.System.DEFAULT_RINGTONE_URI)
            }
            player.isLooping = loop
            player.setOnCompletionListener { stop(ctx) }
            player.prepare()
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= 26) {
                val r = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs()).build()
                focusReq = r
                am.requestAudioFocus(r)
            } else {
                @Suppress("DEPRECATION")
                am.requestAudioFocus(null, AudioManager.STREAM_RING, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
            }
            player.start()
            mp = player
            return true
        } catch (t: Throwable) {
            Log.w("CallRec", "ringtone failed: " + t)
            try { player.release() } catch (e: Throwable) {}
            return false
        }
    }

    @Synchronized
    fun stop(ctx: Context) {
        val p = mp
        mp = null
        if (p != null) {
            try { if (p.isPlaying) p.stop() } catch (t: Throwable) {}
            try { p.release() } catch (t: Throwable) {}
        }
        try {
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            if (Build.VERSION.SDK_INT >= 26) {
                focusReq?.let { am.abandonAudioFocusRequest(it) }
                focusReq = null
            }
        } catch (t: Throwable) {}
    }
}
`;

const MODULE = `package __PKG__.callrec

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import java.io.File

class CallRecorderModule(ctx: ReactApplicationContext) : ReactContextBaseJavaModule(ctx) {
    override fun getName() = "CallRecorderNative"

    @ReactMethod
    fun isAvailable(p: Promise) { p.resolve(CallRecEngine.installed) }

    @ReactMethod
    fun start(path: String, p: Promise) {
        try { p.resolve(CallRecEngine.start(File(path.removePrefix("file://")))) } catch (t: Throwable) { p.resolve(false) }
    }

    @ReactMethod
    fun stats(p: Promise) {
        val m = Arguments.createMap()
        m.putDouble("mic", CallRecEngine.micCount.get().toDouble())
        m.putDouble("spk", CallRecEngine.spkCount.get().toDouble())
        p.resolve(m)
    }

    @ReactMethod
    fun playRingtone(kind: String, value: String, loop: Boolean, p: Promise) {
        p.resolve(RingtonePlayer.play(reactApplicationContext, kind, value, loop))
    }

    @ReactMethod
    fun stopRingtone(p: Promise) {
        RingtonePlayer.stop(reactApplicationContext)
        p.resolve(true)
    }

    @ReactMethod
    fun storageStatus(p: Promise) {
        val m = Arguments.createMap()
        m.putBoolean("direct", CallRecEngine.canWriteDirect(reactApplicationContext))
        m.putBoolean("needsAllFiles", Build.VERSION.SDK_INT >= 30 && !Environment.isExternalStorageManager())
        m.putString("path", CallRecEngine.publicDir().absolutePath)
        p.resolve(m)
    }

    @ReactMethod
    fun requestAllFilesAccess(p: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= 30) {
                val ctx = reactApplicationContext
                var i = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + ctx.packageName))
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                try { ctx.startActivity(i) } catch (e: Throwable) {
                    i = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    ctx.startActivity(i)
                }
            }
            p.resolve(true)
        } catch (t: Throwable) { p.resolve(false) }
    }

    @ReactMethod
    fun publishFile(path: String, p: Promise) {
        Thread {
            try { p.resolve(CallRecEngine.publish(reactApplicationContext, File(path.removePrefix("file://")))) } catch (t: Throwable) { p.resolve(null) }
        }.start()
    }

    @ReactMethod
    fun deletePublic(name: String, p: Promise) {
        Thread {
            try { CallRecEngine.deletePublic(reactApplicationContext, name) } catch (t: Throwable) {}
            p.resolve(true)
        }.start()
    }

    @ReactMethod
    fun stop(p: Promise) {
        Thread {
            try { p.resolve(CallRecEngine.stop(reactApplicationContext)) } catch (t: Throwable) { p.resolve(null) }
        }.start()
    }
}

class CallRecorderPackage : ReactPackage {
    override fun createNativeModules(ctx: ReactApplicationContext): List<NativeModule> = listOf(CallRecorderModule(ctx))
    override fun createViewManagers(ctx: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
`;

module.exports = function withCallRecorder(config) {
  const pkg = (config.android && config.android.package) || 'com.hellocat.app';

  config = withDangerousMod(config, ['android', async (cfg) => {
    const dir = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/java', ...pkg.split('.'), 'callrec');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'CallRecEngine.kt'), ENGINE.replace(/__PKG__/g, pkg));
    fs.writeFileSync(path.join(dir, 'CallRecorderModule.kt'), MODULE.replace(/__PKG__/g, pkg));
    fs.writeFileSync(path.join(dir, 'RingtonePlayer.kt'), RINGER.replace(/__PKG__/g, pkg));
    // bundle the built-in ringtones as native raw resources (played on the ring stream)
    const raw = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res/raw');
    fs.mkdirSync(raw, { recursive: true });
    ['hellocat', 'marimba', 'classic', 'pulse'].forEach((n) => {
      const src = path.join(cfg.modRequest.projectRoot, 'assets/ringtones', n + '.wav');
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(raw, 'tone_' + n + '.wav'));
    });
    return cfg;
  }]);

  config = withMainApplication(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (cfg.modResults.language !== 'kt') return cfg;
    if (!c.includes('CallRecorderPackage')) {
      c = c.replace(/PackageList\(this\)\.packages\.apply \{/, `PackageList(this).packages.apply {\n              add(${pkg}.callrec.CallRecorderPackage())`);
    }
    if (!c.includes('CallRecEngine.installAdm')) {
      c = c.replace(/super\.onCreate\(\)/, `super.onCreate()\n    ${pkg}.callrec.CallRecEngine.installAdm(this)`);
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  return config;
};
