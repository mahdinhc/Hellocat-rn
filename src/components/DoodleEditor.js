import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { View, Image, TouchableOpacity, Text, StyleSheet } from 'react-native';
import Svg, { Path as SvgPath, SvgXml } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';

const COLORS = ['#ffffff', '#ff4444', '#f59e0b', '#facc15', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
const SIZES = [2, 4, 8, 12, 20, 40];
const OPACITIES = [1, 0.7, 0.4];
const BRUSHES = ['Normal', 'Neon', 'Soft'];
const SVG_PREFIX = 'data:image/svg+xml';

const f1 = (n) => Math.round(n * 10) / 10;
const EMPTY_D = 'M0 0';

// Smooth path through the points (quadratic curves through midpoints) => no jagged lines
function pathD(pts) {
  if (!pts || !pts.length) return '';
  if (pts.length === 1) return `M${f1(pts[0].x)} ${f1(pts[0].y)} L${f1(pts[0].x + 0.1)} ${f1(pts[0].y)}`;
  let d = `M${f1(pts[0].x)} ${f1(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q${f1(pts[i].x)} ${f1(pts[i].y)} ${f1(mx)} ${f1(my)}`;
  }
  const l = pts[pts.length - 1];
  return d + ` L${f1(l.x)} ${f1(l.y)}`;
}

function strokeEls(s, d) {
  const p = (w, o) =>
    `<path d="${d}" stroke="${s.color}" stroke-width="${f1(w)}" stroke-opacity="${f1(o * 100) / 100}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (s.brush === 'Neon') return p(s.width * 3.2, s.opacity * 0.12) + p(s.width * 2, s.opacity * 0.22) + p(s.width, s.opacity);
  if (s.brush === 'Soft') return p(s.width * 2.4, s.opacity * 0.12) + p(s.width * 1.6, s.opacity * 0.2) + p(s.width, s.opacity * 0.5);
  return p(s.width, s.opacity);
}

let maskCounter = 0;
const maskPrefix = () => 'm' + Date.now().toString(36);

function buildSvg(w, h, baseInner, strokes) {
  let content = baseInner || '';
  const pre = maskPrefix();
  strokes.forEach((s) => {
    const d = pathD(s.pts);
    if (!d) return;
    if (s.eraser) {
      const id = `${pre}_${maskCounter++}`;
      content =
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000">` +
        `<rect x="-5000" y="-5000" width="10000" height="10000" fill="white"/>` +
        `<path d="${d}" stroke="black" stroke-width="${s.width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` +
        `</mask><g mask="url(#${id})">${content}</g>`;
    } else {
      content += strokeEls(s, d);
    }
  });
  const W = Math.max(1, Math.round(w));
  const H = Math.max(1, Math.round(h));
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${content}</svg>`;
}

function decodeSvgDataUrl(url) {
  try {
    const i = url.indexOf(',');
    const head = url.slice(0, i);
    const body = url.slice(i + 1);
    if (/;base64/i.test(head)) {
      if (typeof global.atob === 'function') return global.atob(body);
      return null;
    }
    return decodeURIComponent(body);
  } catch (e) {
    return null;
  }
}

/** Renders a message doodle (PNG from web, or SVG made by the app / web) at its stored position. */
export function DoodleView({ doodle }) {
  if (!doodle || !doodle.url) return null;
  const pos = doodle.pos || {};
  const w = Number(pos.width) || 300;
  const h = Number(pos.height) || 240;
  const isSvg = typeof doodle.url === 'string' && doodle.url.startsWith(SVG_PREFIX);
  const xml = isSvg ? decodeSvgDataUrl(doodle.url) : null;
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', top: Number(pos.top) || 0, left: Number(pos.left) || 0, width: w, height: h, zIndex: 10, elevation: 10 }}
    >
      {isSvg ? (
        xml ? <SvgXml xml={xml} width={w} height={h} /> : null
      ) : (
        <Image source={{ uri: doodle.url }} style={{ width: w, height: h }} resizeMode="stretch" />
      )}
    </View>
  );
}

function Chip({ label, active, onPress, danger, style }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: active ? (danger ? '#fc5d5d' : '#3b82f6') : '#444', marginHorizontal: 2, marginVertical: 2 },
        style,
      ]}
    >
      <Text style={{ color: '#fff', fontSize: 12 }}>{label}</Text>
    </TouchableOpacity>
  );
}

/**
 * Full-screen doodle overlay (like the web version): the chat stays visible underneath,
 * the user draws anywhere over the screen. The result is stored relative to the message.
 */
export default function DoodleEditor({ existing, msgRect, onCancel, onApply, onDelete }) {
  const rootRef = useRef(null);
  const [box, setBox] = useState({ x: 0, y: 0, w: 0, h: 0 });
  const [strokes, setStrokes] = useState([]);
  const [color, setColor] = useState(COLORS[1]);
  const [width, setWidth] = useState(8);
  const [opacity, setOpacity] = useState(1);
  const [brush, setBrush] = useState('Normal');
  const [eraser, setEraser] = useState(false);
  const liveRef = useRef(null); // live stroke is updated natively, without React re-rendering
  const live = useRef({ pts: [], active: false, raf: null });
  const cfg = useRef({});
  cfg.current = { color, width, opacity, brush, eraser };

  const onLayout = useCallback((e) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (rootRef.current && rootRef.current.measureInWindow) {
      rootRef.current.measureInWindow((x, y) => setBox({ x: x || 0, y: y || 0, w, h }));
    } else {
      setBox({ x: 0, y: 0, w, h });
    }
  }, []);

  // message position relative to this overlay
  const rel = useMemo(() => {
    if (msgRect) return { x: msgRect.x - box.x, y: msgRect.y - box.y, w: msgRect.w, h: msgRect.h };
    return { x: 20, y: box.h / 2, w: 0, h: 0 };
  }, [msgRect, box]);

  // existing doodle, converted into overlay coordinates and used as the base layer
  const baseInner = useMemo(() => {
    if (!existing || !existing.url || !box.w) return '';
    const pos = existing.pos || {};
    const dx = rel.x + (Number(pos.left) || 0);
    const dy = rel.y + (Number(pos.top) || 0);
    if (typeof existing.url === 'string' && existing.url.startsWith(SVG_PREFIX)) {
      const xml = decodeSvgDataUrl(existing.url);
      if (!xml) return '';
      const inner = xml.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
      return `<g transform="translate(${f1(dx)} ${f1(dy)})">${inner}</g>`;
    }
    const w = Number(pos.width) || box.w;
    const h = Number(pos.height) || box.h;
    return `<image href="${existing.url}" xlink:href="${existing.url}" x="${f1(dx)}" y="${f1(dy)}" width="${w}" height="${h}"/>`;
  }, [existing, rel, box.w, box.h]);

  const committedXml = useMemo(
    () => (box.w ? buildSvg(box.w, box.h, baseInner, strokes) : ''),
    [box.w, box.h, baseInner, strokes]
  );

  const schedule = () => {
    if (live.current.raf) return;
    live.current.raf = requestAnimationFrame(() => {
      live.current.raf = null;
      if (liveRef.current) liveRef.current.setNativeProps({ d: pathD(live.current.pts) });
    });
  };

  const onGrant = (e) => {
    const { locationX: x, locationY: y } = e.nativeEvent;
    live.current.pts = [{ x, y }];
    live.current.active = true;
    schedule();
  };
  const onMove = (e) => {
    if (!live.current.active) return;
    const { locationX: x, locationY: y } = e.nativeEvent;
    const pts = live.current.pts;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(x - last.x, y - last.y) < 1.5) return;
    pts.push({ x, y });
    schedule();
  };
  const onEnd = () => {
    if (!live.current.active) return;
    live.current.active = false;
    if (live.current.raf) { cancelAnimationFrame(live.current.raf); live.current.raf = null; }
    const pts = live.current.pts;
    live.current.pts = [];
    if (pts.length) {
      const c = cfg.current;
      setStrokes((prev) => [...prev, { pts, color: c.color, width: c.width, opacity: c.opacity, brush: c.brush, eraser: c.eraser }]);
    }
  };

  // clear the live stroke only after the committed layer has re-rendered (no flicker)
  useEffect(() => {
    const t = requestAnimationFrame(() => {
      if (!live.current.active && liveRef.current) liveRef.current.setNativeProps({ d: EMPTY_D });
    });
    return () => cancelAnimationFrame(t);
  }, [strokes]);

  const apply = () => {
    if (!strokes.length) { onCancel && onCancel(); return; }
    const svg = buildSvg(box.w, box.h, baseInner, strokes);
    onApply && onApply({
      url: SVG_PREFIX + ';utf8,' + encodeURIComponent(svg),
      pos: { top: Math.round(-rel.y), left: Math.round(-rel.x), width: Math.round(box.w), height: Math.round(box.h) },
    });
  };

  return (
    <View
      ref={rootRef}
      collapsable={false}
      onLayout={onLayout}
      style={[StyleSheet.absoluteFill, { zIndex: 9999, elevation: 9999, backgroundColor: 'rgba(0,0,0,0.5)' }]}
    >
      {/* drawing surface = whole screen */}
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderMove={onMove}
        onResponderRelease={onEnd}
        onResponderTerminate={onEnd}
      >
        {msgRect ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', left: rel.x - 2, top: rel.y - 2, width: rel.w + 4, height: rel.h + 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', borderRadius: 14, borderStyle: 'dashed' }}
          />
        ) : null}
        {committedXml ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <SvgXml xml={committedXml} width={box.w} height={box.h} />
          </View>
        ) : null}
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <Svg width={box.w} height={box.h}>
            <SvgPath
              ref={liveRef}
              d={EMPTY_D}
              stroke={eraser ? 'rgba(255,255,255,0.6)' : color}
              strokeWidth={width}
              strokeOpacity={eraser ? 1 : opacity}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
        </View>
      </View>

      {/* toolbar (top) */}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, padding: 8, backgroundColor: 'rgba(0,0,0,0.8)' }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' }}>
          {COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              onPress={() => { setColor(c); setEraser(false); }}
              style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, margin: 4, borderWidth: !eraser && color === c ? 3 : 1.5, borderColor: '#fff' }}
            />
          ))}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 4 }}>
          {SIZES.map((s) => <Chip key={'s' + s} label={s + 'px'} active={width === s} onPress={() => setWidth(s)} />)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', marginTop: 2 }}>
          {OPACITIES.map((o) => <Chip key={'o' + o} label={Math.round(o * 100) + '%'} active={opacity === o} onPress={() => setOpacity(o)} />)}
          <View style={{ width: 8 }} />
          {BRUSHES.map((b) => <Chip key={b} label={b} active={brush === b} onPress={() => setBrush(b)} />)}
          <View style={{ width: 8 }} />
          <Chip label="Eraser" active={eraser} danger onPress={() => setEraser((v) => !v)} />
          <TouchableOpacity onPress={() => setStrokes((p) => p.slice(0, -1))} disabled={!strokes.length} style={{ padding: 6, opacity: strokes.length ? 1 : 0.4 }}>
            <Ionicons name="arrow-undo" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setStrokes([])} disabled={!strokes.length} style={{ padding: 6, opacity: strokes.length ? 1 : 0.4 }}>
            <Ionicons name="trash-outline" size={20} color="#ff6c61" />
          </TouchableOpacity>
        </View>
      </View>

      {/* footer buttons (bottom-right) */}
      <View style={{ position: 'absolute', right: 16, bottom: 20, flexDirection: 'row', padding: 8, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.6)' }}>
        <TouchableOpacity onPress={onCancel} style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#555', marginRight: 8 }}>
          <Text style={{ color: '#fff' }}>Cancel</Text>
        </TouchableOpacity>
        {existing && existing.url ? (
          <TouchableOpacity onPress={onDelete} style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#dc3545', marginRight: 8 }}>
            <Text style={{ color: '#fff', fontWeight: 'bold' }}>Delete</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity onPress={apply} style={{ paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, backgroundColor: '#007bff' }}>
          <Text style={{ color: '#fff', fontWeight: 'bold' }}>Apply</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
