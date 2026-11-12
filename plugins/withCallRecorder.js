// Expo config plugin: adds a native Android module that records BOTH sides of a WebRTC call.
// It installs a JavaAudioDeviceModule (via reflection, so it compiles regardless of react-native-webrtc
// internals) whose callbacks hand us the microphone samples and the remote-playback samples; they are
// mixed into one 16 kHz mono WAV and published to Music/Hellocat Recordings.
const { withDangerousMod, withMainApplication, withMainActivity, withAndroidManifest, withAppBuildGradle } = require('expo/config-plugins');
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

const NOTIFIER = `package __PKG__.callrec

import android.app.Activity
import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Rect
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.graphics.drawable.IconCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.net.HttpURLConnection
import java.net.URL
import __PKG__.R

// Incoming-call notification: a dark pill with avatar, name, green Answer and red Decline buttons.
// Works when the app is in the background or fully closed (shown from the FCM data message).
object CallNotifier {
    private const val TAG = "CallNotifier"
    private const val PREFS = "hellocat_call_prefs"
    private const val NTAG = "hellocat_call"
    private val live = HashSet<String>()

    fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun savePrefs(ctx: Context, enabled: Boolean, banner: Boolean, sound: Boolean, vibrate: Boolean, tone: String) {
        prefs(ctx).edit()
            .putBoolean("enabled", enabled).putBoolean("banner", banner)
            .putBoolean("sound", sound).putBoolean("vibrate", vibrate)
            .putString("tone", tone).apply()
    }

    fun isAppForeground(ctx: Context): Boolean {
        return try {
            val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
            val procs = am.runningAppProcesses ?: return false
            procs.any { it.processName == ctx.packageName && it.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND }
        } catch (t: Throwable) { false }
    }

    private fun channelFor(ctx: Context, tone: String, sound: Boolean, vibrate: Boolean): String {
        val id = "ic_" + tone + "_" + (if (sound) "1" else "0") + "_" + (if (vibrate) "1" else "0")
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (nm.getNotificationChannel(id) == null) {
                val ch = NotificationChannel(id, "Incoming calls", NotificationManager.IMPORTANCE_HIGH)
                ch.description = "Incoming voice and video calls"
                if (sound) {
                    val attrs = AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
                    val raw = ctx.resources.getIdentifier("tone_" + tone, "raw", ctx.packageName)
                    val uri = if (tone != "system" && raw != 0) Uri.parse("android.resource://" + ctx.packageName + "/" + raw)
                              else Settings.System.DEFAULT_RINGTONE_URI
                    ch.setSound(uri, attrs)
                } else {
                    ch.setSound(null, null)
                }
                ch.enableVibration(vibrate)
                if (vibrate) ch.vibrationPattern = longArrayOf(0, 700, 500, 700, 500, 700)
                ch.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
                nm.createNotificationChannel(ch)
            }
        }
        return id
    }

    private fun actionIntent(ctx: Context, act: String, callId: String, callerId: String, cid: String): PendingIntent {
        val i = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: Intent()
        i.action = Intent.ACTION_VIEW
        i.data = Uri.parse("hellocat://call/" + act + "?callId=" + Uri.encode(callId) + "&callerId=" + Uri.encode(callerId) + "&cid=" + Uri.encode(cid))
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val req = (callId + act).hashCode()
        return PendingIntent.getActivity(ctx, req, i, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun circle(src: Bitmap): Bitmap {
        val size = 128
        val scaled = Bitmap.createScaledBitmap(src, size, size, true)
        val out = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val p = Paint(Paint.ANTI_ALIAS_FLAG)
        c.drawCircle(size / 2f, size / 2f, size / 2f, p)
        p.xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_IN)
        c.drawBitmap(scaled, Rect(0, 0, size, size), Rect(0, 0, size, size), p)
        return out
    }

    private fun loadAvatar(url: String): Bitmap? {
        return try {
            val con = URL(url).openConnection() as HttpURLConnection
            con.connectTimeout = 3500
            con.readTimeout = 3500
            val bmp = BitmapFactory.decodeStream(con.inputStream)
            if (bmp == null) null else circle(bmp)
        } catch (t: Throwable) { null }
    }

    fun show(ctx: Context, callId: String, callerId: String, name: String, type: String, cid: String, picUrl: String) {
        if (callId.isEmpty()) return
        val p = prefs(ctx)
        if (!p.getBoolean("enabled", true)) return
        val dup = live.contains(callId)
        live.add(callId)
        post(ctx, callId, callerId, name, type, cid, null, dup)
        if (picUrl.isNotEmpty()) {
            Thread {
                val bmp = loadAvatar(picUrl)
                if (bmp != null && live.contains(callId)) {
                    Handler(Looper.getMainLooper()).post { if (live.contains(callId)) post(ctx, callId, callerId, name, type, cid, bmp, true) }
                }
            }.start()
        }
    }

    private fun post(ctx: Context, callId: String, callerId: String, name: String, type: String, cid: String, avatar: Bitmap?, quiet: Boolean) {
        try {
            val p = prefs(ctx)
            val banner = p.getBoolean("banner", true)
            val sound = p.getBoolean("sound", true)
            val vibrate = p.getBoolean("vibrate", true)
            val tone = p.getString("tone", "hellocat") ?: "hellocat"
            val ch = channelFor(ctx, tone, sound, vibrate)
            val isVideo = type == "video"
            val title = if (name.isEmpty()) "Friend" else name
            val sub = "Incoming " + (if (isVideo) "video" else "voice") + " call"
            val answer = actionIntent(ctx, "answer", callId, callerId, cid)
            val decline = actionIntent(ctx, "decline", callId, callerId, cid)
            val open = actionIntent(ctx, "open", callId, callerId, cid)

            var icon = ctx.resources.getIdentifier("notification_icon", "drawable", ctx.packageName)
            if (icon == 0) icon = android.R.drawable.sym_call_incoming

            val b = NotificationCompat.Builder(ctx, ch)
                .setSmallIcon(icon)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setOngoing(true)
                .setAutoCancel(false)
                .setOnlyAlertOnce(quiet)
                .setTimeoutAfter(40000)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setColor(0xFF5CC43C.toInt())
                .setContentIntent(open)
                .setFullScreenIntent(open, true)

            val callerPerson = Person.Builder()
                .setName(title)
                .setImportant(true)
                .also { if (avatar != null) it.setIcon(IconCompat.createWithBitmap(avatar)) }
                .build()

            val callStyle = NotificationCompat.CallStyle.forIncomingCall(callerPerson, decline, answer)
                .setIsVideo(isVideo)

            b.setStyle(callStyle)
            b.setContentTitle(title)
            b.setContentText(sub)
            if (avatar != null) b.setLargeIcon(avatar)

            val n = b.build()
            if (sound) n.flags = n.flags or Notification.FLAG_INSISTENT
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NTAG, callId.hashCode(), n)
        } catch (t: Throwable) {
            Log.w(TAG, "show failed: " + t)
        }
    }

    fun cancel(ctx: Context, callId: String?) {
        try {
            val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (callId != null && callId.isNotEmpty()) {
                live.remove(callId)
                nm.cancel(NTAG, callId.hashCode())
            } else {
                for (id in live.toList()) nm.cancel(NTAG, id.hashCode())
                live.clear()
            }
        } catch (t: Throwable) {}
    }
}

// Receives the push for an incoming call (data message) even when the app is closed.
class CallFcmService : FirebaseMessagingService() {
    override fun onMessageReceived(msg: RemoteMessage) {
        try {
            val d = msg.data
            val type = d["type"]
            if (type == "incoming_call") {
                if (!CallNotifier.isAppForeground(this)) {
                    CallNotifier.show(this, d["callId"] ?: "", d["callerId"] ?: "", d["callerName"] ?: "", d["callType"] ?: "audio", d["cid"] ?: "", d["callerPic"] ?: "")
                }
            } else if (type == "cancel_call") {
                CallNotifier.cancel(this, d["callId"])
            }
        } catch (t: Throwable) {}
    }
}

object CallWindow {
    // When MainActivity is opened from a call notification, show it over the lock screen and wake the screen.
    fun apply(a: Activity) {
        try {
            val d = a.intent?.data
            if (d != null && d.scheme == "hellocat" && d.host == "call" && Build.VERSION.SDK_INT >= 27) {
                a.setShowWhenLocked(true)
                a.setTurnScreenOn(true)
            }
        } catch (t: Throwable) {}
    }
}
`;

const RES = {
  'layout/nc_incoming_call.xml': `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/nc_root"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:background="@drawable/nc_pill_bg"
    android:padding="10dp">
    <ImageView
        android:id="@+id/nc_avatar"
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:scaleType="centerCrop"
        android:src="@drawable/nc_avatar_default" />
    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical"
        android:layout_marginStart="12dp"
        android:layout_marginEnd="8dp">
        <TextView
            android:id="@+id/nc_title"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:textColor="#FFFFFF"
            android:textSize="17sp"
            android:textStyle="bold"
            android:singleLine="true"
            android:ellipsize="end" />
        <TextView
            android:id="@+id/nc_sub"
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:textColor="#A1A6AD"
            android:textSize="13sp"
            android:singleLine="true"
            android:ellipsize="end" />
    </LinearLayout>
    <ImageView
        android:id="@+id/nc_accept"
        android:layout_width="46dp"
        android:layout_height="46dp"
        android:padding="11dp"
        android:background="@drawable/nc_btn_green"
        android:src="@drawable/nc_ic_call" />
    <ImageView
        android:id="@+id/nc_decline"
        android:layout_width="46dp"
        android:layout_height="46dp"
        android:layout_marginStart="10dp"
        android:padding="11dp"
        android:background="@drawable/nc_btn_red"
        android:src="@drawable/nc_ic_call_end" />
</LinearLayout>
`,
  'drawable/nc_pill_bg.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#2F3032" />
    <corners android:radius="40dp" />
</shape>
`,
  'drawable/nc_btn_green.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#5CC43C" />
</shape>
`,
  'drawable/nc_btn_red.xml': `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="oval">
    <solid android:color="#E0141C" />
</shape>
`,
  'drawable/nc_avatar_default.xml': `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp" android:viewportWidth="48" android:viewportHeight="48">
    <path android:fillColor="#4B5058" android:pathData="M24,24m-24,0a24,24 0 1,1 48,0a24,24 0 1,1 -48,0" />
    <path android:fillColor="#F1F3F5" android:pathData="M24,13a6,6 0 1,1 0,12a6,6 0 1,1 0,-12M12,36c0,-6 8,-8 12,-8s12,2 12,8z" />
</vector>
`,
  'drawable/nc_ic_call.xml': `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFF" android:pathData="M6.62,10.79c1.44,2.83 3.76,5.14 6.59,6.59l2.2,-2.2c0.27,-0.27 0.67,-0.36 1.02,-0.24 1.12,0.37 2.33,0.57 3.57,0.57 0.55,0 1,0.45 1,1V20c0,0.55 -0.45,1 -1,1 -9.39,0 -17,-7.61 -17,-17 0,-0.55 0.45,-1 1,-1h3.5c0.55,0 1,0.45 1,1 0,1.25 0.2,2.45 0.57,3.57 0.11,0.35 0.03,0.74 -0.25,1.02l-2.2,2.2z" />
</vector>
`,
  'drawable/nc_ic_call_end.xml': `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24">
    <path android:fillColor="#FFFFFF" android:pathData="M12,9c-1.6,0 -3.15,0.25 -4.6,0.72v3.1c0,0.39 -0.23,0.74 -0.56,0.9 -0.98,0.49 -1.87,1.12 -2.66,1.85 -0.18,0.18 -0.43,0.28 -0.7,0.28 -0.28,0 -0.53,-0.11 -0.71,-0.29L0.29,13.08c-0.18,-0.17 -0.29,-0.42 -0.29,-0.7 0,-0.28 0.11,-0.53 0.29,-0.71C3.34,8.78 7.46,7 12,7s8.66,1.78 11.71,4.67c0.18,0.18 0.29,0.43 0.29,0.71 0,0.28 -0.11,0.53 -0.29,0.71l-2.48,2.48c-0.18,0.18 -0.43,0.29 -0.71,0.29 -0.27,0 -0.52,-0.11 -0.7,-0.28 -0.79,-0.74 -1.69,-1.36 -2.67,-1.85 -0.33,-0.16 -0.56,-0.5 -0.56,-0.9v-3.1C15.15,9.25 13.6,9 12,9z" />
</vector>
`,
};

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
import com.facebook.react.bridge.ReadableMap
import android.app.NotificationManager
import android.media.AudioManager
import android.content.Context
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

    private fun str(m: ReadableMap, k: String): String = if (m.hasKey(k) && !m.isNull(k)) (m.getString(k) ?: "") else ""
    private fun bool(m: ReadableMap, k: String, d: Boolean): Boolean = if (m.hasKey(k) && !m.isNull(k)) m.getBoolean(k) else d

    @ReactMethod
    fun setCallPrefs(m: ReadableMap) {
        try {
            CallNotifier.savePrefs(reactApplicationContext, bool(m, "enabled", true), bool(m, "banner", true), bool(m, "sound", true), bool(m, "vibrate", true), str(m, "tone").ifEmpty { "hellocat" })
        } catch (t: Throwable) {}
    }

    @ReactMethod
    fun showIncomingCall(m: ReadableMap, p: Promise) {
        try {
            CallNotifier.show(reactApplicationContext, str(m, "callId"), str(m, "callerId"), str(m, "callerName"), str(m, "type").ifEmpty { "audio" }, str(m, "cid"), str(m, "callerPic"))
            p.resolve(true)
        } catch (t: Throwable) { p.resolve(false) }
    }

    @ReactMethod
    fun cancelIncomingCall(callId: String) {
        try { CallNotifier.cancel(reactApplicationContext, if (callId.isEmpty()) null else callId) } catch (t: Throwable) {}
    }

    @ReactMethod
    fun showOverLockScreen(on: Boolean) {
        try {
            val a = currentActivity ?: return
            if (Build.VERSION.SDK_INT >= 27) a.runOnUiThread { try { a.setShowWhenLocked(on); a.setTurnScreenOn(on) } catch (t: Throwable) {} }
        } catch (t: Throwable) {}
    }

    @ReactMethod
    fun moveToBack() {
        try { currentActivity?.runOnUiThread { try { currentActivity?.moveTaskToBack(true) } catch (t: Throwable) {} } } catch (t: Throwable) {}
    }

    // "normal" | "vibrate" | "silent" - what the phone's ringer / Do Not Disturb currently allows
    @ReactMethod
    fun getRingerMode(p: Promise) {
        try {
            val ctx = reactApplicationContext
            val am = ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            var mode = when (am.ringerMode) {
                AudioManager.RINGER_MODE_SILENT -> "silent"
                AudioManager.RINGER_MODE_VIBRATE -> "vibrate"
                else -> "normal"
            }
            if (Build.VERSION.SDK_INT >= 23) {
                val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                val f = nm.currentInterruptionFilter
                if (f == NotificationManager.INTERRUPTION_FILTER_NONE || f == NotificationManager.INTERRUPTION_FILTER_ALARMS) mode = "silent"
            }
            if (mode == "normal" && am.getStreamVolume(AudioManager.STREAM_RING) == 0) mode = "silent"
            p.resolve(mode)
        } catch (t: Throwable) { p.resolve("normal") }
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
    fs.writeFileSync(path.join(dir, 'CallNotifier.kt'), NOTIFIER.replace(/__PKG__/g, pkg));
    const resRoot = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res');
    Object.keys(RES).forEach((rel) => {
      const f = path.join(resRoot, rel);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, RES[rel]);
    });
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

  // our own FCM service handles incoming-call pushes (so the pill notification shows even when the app is closed)
  config = withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$ = manifest.$ || {};
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    const app = manifest.application[0];
    app.service = app.service || [];
    const has = (n) => app.service.some((x) => x.$ && x.$['android:name'] === n);
    const expoSvc = 'expo.modules.notifications.service.ExpoFirebaseMessagingService';
    if (!has(expoSvc)) app.service.push({ $: { 'android:name': expoSvc, 'tools:node': 'remove' } });
    const mine = pkg + '.callrec.CallFcmService';
    if (!has(mine)) {
      app.service.push({
        $: { 'android:name': mine, 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }],
      });
    }
    return cfg;
  });

  config = withAppBuildGradle(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (!c.includes('firebase-messaging:24.0.1')) {
      c = c.replace(/dependencies\s*\{/, "dependencies {\n    implementation 'com.google.firebase:firebase-messaging:24.0.1'\n    implementation 'androidx.core:core:1.13.1'");
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  config = withMainActivity(config, (cfg) => {
    let c = cfg.modResults.contents;
    if (cfg.modResults.language === 'kt' && !c.includes('CallWindow.apply')) {
      c = c.replace(/super\.onCreate\([^)]*\)/, (m) => m + '\n    ' + pkg + '.callrec.CallWindow.apply(this)');
    }
    cfg.modResults.contents = c;
    return cfg;
  });

  return config;
};
