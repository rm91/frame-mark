import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from "expo-status-bar";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
// Keep splash visible until app is ready
SplashScreen.preventAutoHideAsync().catch(()=>{});

type Marker = {
  id: number;
  frames: number;
  comment: string;
};

const GEMINI_KEY = process.env.EXPO_PUBLIC_GEMINI_KEY;
const SCREEN_W = Dimensions.get("window").width;

/* ---------- Timecode helpers ---------- */

const framesToTimecode = (frames: number, fps: number) => {
  const f = Math.max(0, frames);
  const ff = f % fps;
  const totalSeconds = Math.floor(f / fps);
  const ss = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mm = totalMinutes % 60;
  const hh = Math.floor(totalMinutes / 60);

  return `${hh.toString().padStart(2, "0")}:${mm
    .toString()
    .padStart(2, "0")}:${ss.toString().padStart(2, "0")}:${ff
    .toString()
    .padStart(2, "0")}`;
};

const timecodeToFrames = (tc: string, fps: number) => {
  const p = tc.split(":").map(Number);
  if (p.length !== 4 || p.some(isNaN)) return 0;
  const [h, m, s, f] = p;
  return (h * 3600 + m * 60 + s) * fps + f;
};

const framesToSeconds = (frames: number, fps: number) => frames / fps;
const secondsToFrames = (seconds: number, fps: number) =>
  Math.round(seconds * fps);


/* ---------- Light UI helpers ---------- */

type ThemeName = "light" | "dark";

const PALETTE = {
  light: {
    bg: "#FFFFFF",
    card: "#FFFFFF",
    text: "#0B1220",
    subtext: "#667085",
    border: "rgba(15, 23, 42, 0.10)",
    divider: "rgba(15, 23, 42, 0.08)",
    surface: "#F6F7FB",
    primary: "#2563EB",
    danger: "#EF4444",
    modal: "#FFFFFF",
    inputBg: "#FFFFFF",
    summaryBg: "rgba(37, 99, 235, 0.06)",
    summaryBorder: "rgba(37, 99, 235, 0.12)",
    overlay: "rgba(0,0,0,0.28)",
    placeholder: "rgba(15, 23, 42, 0.35)",
  },
  dark: {
    bg: "#000000",
    card: "#0A0A0A",
    text: "#FFFFFF",
    subtext: "#B3B3B3",
    border: "rgba(255,255,255,0.12)",
    divider: "rgba(255,255,255,0.08)",
    surface: "#121212",
    primary: "#3B82F6",
    danger: "#EF4444",
    modal: "#0A0A0A",
    inputBg: "#0E0E0E",
    summaryBg: "rgba(37, 99, 235, 0.18)",
    summaryBorder: "rgba(37, 99, 235, 0.35)",
    overlay: "rgba(0,0,0,0.7)",
    placeholder: "rgba(255,255,255,0.35)",
  },
} as const;

const getUi = (theme: ThemeName) => PALETTE[theme];


function Card({
  children,
  style,
  styles,
}: {
  children: React.ReactNode;
  style?: any;
  styles: any;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function PillButton({
  label,
  onPress,
  variant = "secondary",
  disabled,
  style,
  styles,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: any;
  styles: any;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled}
      style={[
        styles.pillBtn,
        variant === "primary" && styles.pillPrimary,
        variant === "danger" && styles.pillDanger,
        disabled && { opacity: 0.55 },
        style,
      ]}
    >
      <Text
        style={[
          styles.pillText,
          variant !== "secondary" && { color: "white", fontWeight: "800" },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function Divider({ style, styles }: { style?: any; styles: any }) {
  return <View style={[styles.divider, style]} />;
}

/* ---------- Wheel (custom, no native popups) ---------- */

function Wheel({
  value,
  onChange,
  count,
  itemHeight = 46,
  visibleItems = 5,
  textStyle,
  containerStyle,
  inactiveOpacity = 0.35,
  highlightBg = "rgba(59, 130, 246, 0.12)",
  highlightBorder = "rgba(59, 130, 246, 0.22)",
}: {
  value: number;
  onChange: (v: number) => void;
  count: number;
  itemHeight?: number;
  visibleItems?: number;
  textStyle?: any;
  containerStyle?: any;
  inactiveOpacity?: number;
  highlightBg?: string;
  highlightBorder?: string;
}) {
  const data = useMemo(
    () => Array.from({ length: count }, (_, i) => i),
    [count]
  );

  const pad = Math.floor(visibleItems / 2);
  const height = itemHeight * visibleItems;
  const listRef = useRef<FlatList<number>>(null);

  // Keep list aligned when value changes programmatically (e.g., open modal)
  useEffect(() => {
    try {
      listRef.current?.scrollToOffset({
        offset: Math.max(0, Math.min(count - 1, value)) * itemHeight,
        animated: false,
      });
    } catch {
      // ignore
    }
  }, [value, count, itemHeight]);

  return (
    <View
      style={[
        {
          height,
          width: "100%",
          borderRadius: 14,
          overflow: "hidden",
        },
        containerStyle,
      ]}
    >
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(x) => String(x)}
        showsVerticalScrollIndicator={false}
        snapToInterval={itemHeight}
        decelerationRate="fast"
        bounces={false}
        getItemLayout={(_, index) => ({
          length: itemHeight,
          offset: itemHeight * index,
          index,
        })}
        initialScrollIndex={Math.max(0, Math.min(count - 1, value))}
        contentContainerStyle={{
          paddingVertical: pad * itemHeight,
        }}
        onMomentumScrollEnd={(e) => {
          const raw = e.nativeEvent.contentOffset.y;
          const idx = Math.round(raw / itemHeight);
          const v = Math.max(0, Math.min(count - 1, idx));
          onChange(v);
        }}
        onScrollEndDrag={(e) => {
          const raw = e.nativeEvent.contentOffset.y;
          const idx = Math.round(raw / itemHeight);
          const v = Math.max(0, Math.min(count - 1, idx));
          onChange(v);
        }}
        renderItem={({ item }) => {
          const isSelected = item === value;
          return (
            <View
              style={{
                height: itemHeight,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <View
                style={[
                  {
                    width: "88%",
                    height: itemHeight - 10,
                    borderRadius: 12,
                    alignItems: "center",
                    justifyContent: "center",
                  },
                  isSelected && {
                    backgroundColor: highlightBg,
                    borderWidth: 1,
                    borderColor: highlightBorder,
                  },
                ]}
              >
                <Text
                  style={[
                    textStyle,
                    {
                      opacity: isSelected ? 1 : inactiveOpacity,
                      fontWeight: isSelected ? "900" : "800",
                      fontSize: isSelected ? 22 : 18,
                    },
                  ]}
                >
                  {String(item).padStart(2, "0")}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

/* ---------- App ---------- */

export default function App() {
  // Splash screen handling - keep splash until app is ready
  useEffect(() => {
    let mounted = true;
    async function prepare() {
      try {
        // preload assets/fonts here if needed
        await new Promise((res) => setTimeout(res, 400));
      } catch (e) {
        console.warn('Splash prepare error', e);
      } finally {
        if (mounted) {
          await SplashScreen.hideAsync().catch(()=>{});
        }
      }
    }
    prepare();
    return () => { mounted = false; };
  }, []);

  const [fps, setFps] = useState(24);
  const [startTC, setStartTC] = useState("01:00:00:00");
  const [frames, setFrames] = useState(timecodeToFrames("01:00:00:00", 24));
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [editing, setEditing] = useState<Marker | null>(null);
  const [comment, setComment] = useState("");

  const [theme, setTheme] = useState<ThemeName>("dark");
  const [sortMode, setSortMode] = useState<"created" | "timecode">("timecode");

  // Start Timecode picker modal (HH:MM:SS:FF) - evita tastiera
  const [tcModalOpen, setTcModalOpen] = useState(false);
  const [tcH, setTcH] = useState(1);
  const [tcM, setTcM] = useState(0);
  const [tcS, setTcS] = useState(0);
  const [tcF, setTcF] = useState(0);

  const range = (n: number) => Array.from({ length: n }, (_, i) => i);

  const openTcModal = () => {
    const p = startTC.split(":").map((n) => Number(n));
    if (p.length === 4 && p.every((x) => !Number.isNaN(x))) {
      setTcH(p[0]);
      setTcM(p[1]);
      setTcS(p[2]);
      setTcF(p[3]);
    }
    setTcModalOpen(true);
  };

  const confirmTcModal = () => {
    const tc = `${String(tcH).padStart(2, "0")}:${String(tcM).padStart(
      2,
      "0"
    )}:${String(tcS).padStart(2, "0")}:${String(tcF).padStart(2, "0")}`;
    setStartTC(tc);
    setFrames(timecodeToFrames(tc, fps));
    setTcModalOpen(false);
  };

  const ui = useMemo(() => getUi(theme), [theme]);
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [summary, setSummary] = useState("");
  const [loadingSummary, setLoadingSummary] = useState(false);

  const raf = useRef<number | null>(null);
  const startMs = useRef(0);
  const baseFrames = useRef(0);

  // Keep an always-up-to-date reference (avoids state update timing issues)
  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  /* ---------- TIMER PRECISO ---------- */
  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
      return;
    }

    startMs.current = Date.now();
    baseFrames.current = frames;

    const loop = () => {
      const elapsed = Date.now() - startMs.current;
      const add = Math.floor((elapsed / 1000) * fps);
      setFrames(baseFrames.current + add);
      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = null;
    };
  }, [playing, fps]);

  /* ---------- Controls ---------- */

  const play = () => {
    baseFrames.current = frames;
    startMs.current = Date.now();
    setPlaying(true);
  };

  const stop = () => {
    setPlaying(false);
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };

  const reset = () => {
    stop();
    const f = timecodeToFrames(startTC, fps);
    setFrames(f);
    setMarkers([]);
    setSummary("");
  };

  const adjust = (deltaSeconds: number) => {
    setFrames((f) => Math.max(0, f + deltaSeconds * fps));
  };

  const changeFps = (newFps: number) => {
    setFrames((currentFrames) => {
      const seconds = framesToSeconds(currentFrames, fps);
      return secondsToFrames(seconds, newFps);
    });

    setFps(newFps);
  };


  /* ---------- Markers ---------- */

  const nextMarkerId = useRef(1);

const capture = () => {
  const m: Marker = {
      id: nextMarkerId.current++,
      frames,
      comment: "",
    };
    setMarkers((prev) => [...prev, m]);
    setEditing(m);
    setComment("");
  };

  const saveComment = () => {
    if (!editing) return;
    setMarkers((prev) =>
      prev.map((m) => (m.id === editing.id ? { ...m, comment } : m))
    );
    setEditing(null);
    setComment("");
  };

  const buildMarkersText = () => {
    const ordered =
      sortMode === "timecode"
        ? [...markers].sort((a, b) => a.frames - b.frames)
        : markers;

    return ordered
      .map((m, index) => {
        const num = String(index + 1).padStart(2, "0"); // 01, 02, 03...
        const tc = framesToTimecode(m.frames, fps);
        const c = (m.comment || "").trim();
        return `#${num} [${tc}] ${c}`.trimEnd();
      })
      .join("\n");
  };

  // File name picker (iOS prompt, Android custom modal)
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nameDefault, setNameDefault] = useState("");
  const [nameExt, setNameExt] = useState<"txt" | "pdf">("txt");
  const nameResolveRef = useRef<((fileName: string) => void) | null>(null);

  const askFileName = (
    defaultName: string,
    extension: "txt" | "pdf"
  ): Promise<string> => {
    return new Promise((resolve) => {
      if (Platform.OS === "ios") {
        Alert.prompt(
          "Nome file",
          "Inserisci il nome del file (senza estensione)",
          [
            {
              text: "Annulla",
              style: "cancel",
              onPress: () => resolve(`${defaultName}.${extension}`),
            },
            {
              text: "OK",
              onPress: (value?: string) => {
                const name = value?.trim();
                resolve(
                  name && name.length > 0
                    ? `${name}.${extension}`
                    : `${defaultName}.${extension}`
                );
              },
            },
          ],
          "plain-text",
          ""
        );
        return;
      }

      // Android (e altri): modal custom
      nameResolveRef.current = resolve;
      setNameDefault(defaultName);
      setNameExt(extension);
      setNameDraft("");
      setNameModalVisible(true);
    });
  };

  const confirmNameModal = () => {
    const n = nameDraft.trim();
    const finalName = `${n.length > 0 ? n : nameDefault}.${nameExt}`;
    setNameModalVisible(false);
    nameResolveRef.current?.(finalName);
    nameResolveRef.current = null;
  };

  const cancelNameModal = () => {
    const finalName = `${nameDefault}.${nameExt}`;
    setNameModalVisible(false);
    nameResolveRef.current?.(finalName);
    nameResolveRef.current = null;
  };

  const exportMarkers = async () => {
    if (markers.length === 0) {
      Alert.alert("Export", "Nessun marker da esportare.");
      return;
    }

    const content = buildMarkersText();

    const defaultName = `markers_${fps}fps`;
    const fileName = await askFileName(defaultName, "txt");
    const uri = FileSystem.documentDirectory + fileName;

    await FileSystem.writeAsStringAsync(uri, content);
    await Sharing.shareAsync(uri);
  };

  const exportMarkersPdf = async () => {
    if (markers.length === 0) {
      Alert.alert("Export", "Nessun marker da esportare.");
      return;
    }

    if (Platform.OS === "web") {
      Alert.alert("Export PDF", "Export PDF non supportato su web.");
      return;
    }

    const ordered =
      sortMode === "timecode"
        ? [...markers].sort((a, b) => a.frames - b.frames)
        : markers;

    const now = new Date();
    const exportedAt = new Intl.DateTimeFormat("it-IT", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(now);

    const esc = (s: string) =>
      s
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const rows = ordered
      .map((m, index) => {
        const num = String(index + 1).padStart(2, "0");
        const tc = framesToTimecode(m.frames, fps);
        const c = (m.comment || "").trim();

        return `
          <tr>
            <td class="num">#${num}</td>
            <td class="tc">${esc(tc)}</td>
            <td class="cmt">${esc(c)}</td>
          </tr>`;
      })
      .join("");

    const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        <style>
          @page { size: A4; margin: 22mm 14mm 18mm 14mm; }

          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            color: #111;
            font-size: 12px;
          }

          .header {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 10px;
          }
          .title {
            font-size: 16px;
            font-weight: 800;
            letter-spacing: .2px;
            margin: 0;
          }
          .subtitle {
            font-size: 11px;
            color: #555;
            margin-top: 4px;
          }
          .meta {
            text-align: right;
            font-size: 10.5px;
            color: #555;
            line-height: 1.25;
          }

          table { width: 100%; border-collapse: collapse; table-layout: fixed; }
          thead th {
            background: #f2f2f2;
            border-bottom: 1px solid #d8d8d8;
            padding: 8px 8px;
            font-weight: 800;
            text-align: left;
          }
          tbody td {
            border-bottom: 1px solid #e6e6e6;
            padding: 8px 8px;
            vertical-align: top;
          }
          tbody tr:nth-child(even) td { background: #fafafa; }

          .num { width: 52px; white-space: nowrap; font-weight: 800; }
          .tc  { width: 105px; white-space: nowrap; font-weight: 800; }
          .cmt { width: auto; white-space: pre-wrap; word-break: break-word; }

          tr { page-break-inside: avoid; }

          .footer {
            position: fixed;
            bottom: -10mm;
            left: 0;
            right: 0;
            font-size: 10px;
            color: #666;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
          .pagecount::after { content: "Pagina " counter(page) " / " counter(pages); }
        </style>
      </head>

      <body>
        <div class="header">
          <div>
            <h1 class="title">Markers Export</h1>
            <div class="subtitle">Ordinamento: ${esc(sortMode)} • Totale: ${ordered.length}</div>
          </div>
          <div class="meta">
            <div><b>FPS:</b> ${esc(String(fps))}</div>
            <div><b>Export:</b> ${esc(exportedAt)}</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th style="width:52px;">#</th>
              <th style="width:105px;">Timecode</th>
              <th>Commento</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>

        <div class="footer">
          <div>Markers Export</div>
          <div class="pagecount"></div>
        </div>
      </body>
    </html>`;

    const result = await Print.printToFileAsync({ html });

    const safeSort = sortMode === "timecode" ? "timecode" : "ordine";
    const defaultName = `markers_${fps}fps_${safeSort}`;
    const fileName = await askFileName(defaultName, "pdf");
    const targetUri = FileSystem.documentDirectory + fileName;

    await FileSystem.copyAsync({ from: result.uri, to: targetUri });

    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      Alert.alert("Export", "Sharing non disponibile su questo dispositivo.");
      return;
    }

    await Sharing.shareAsync(targetUri, {
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
    });
  };

  const copyMarkersToClipboard = async () => {
    if (markers.length === 0) {
      Alert.alert("Export", "Nessun marker da copiare.");
      return;
    }
    const text = buildMarkersText();
    await Clipboard.setStringAsync(text);
    Alert.alert("Copiato", "Markers copiati negli appunti.");
  };

  const onPressExport = () => {
    if (markers.length === 0) {
      Alert.alert("Export", "Nessun marker da esportare.");
      return;
    }

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: "Esporta markers",
          options: ["Annulla", "TXT", "PDF", "Copia negli appunti"],
          cancelButtonIndex: 0,
        },
        (buttonIndex) => {
          if (buttonIndex === 1) exportMarkers();
          if (buttonIndex === 2) exportMarkersPdf();
          if (buttonIndex === 3) copyMarkersToClipboard();
        }
      );
    } else {
      Alert.alert("Esporta markers", "Scegli l’azione:", [
        { text: "TXT", onPress: exportMarkers },
        { text: "PDF", onPress: exportMarkersPdf },
        { text: "Copia negli appunti", onPress: copyMarkersToClipboard },
        { text: "Annulla", style: "cancel" },
      ]);
    }
  };

  /* ---------- GEMINI SUMMARY ---------- */

  const generateSummary = async () => {
    if (markers.length === 0) {
      Alert.alert("Riepilogo", "Nessun marker disponibile.");
      return;
    }

    if (!GEMINI_KEY) {
      Alert.alert(
        "Gemini API key mancante",
        "Aggiungi EXPO_PUBLIC_GEMINI_KEY nel file .env e riavvia l'app."
      );
      return;
    }

    setLoadingSummary(true);
    setSummary("");

    const ordered =
      sortMode === "timecode"
        ? [...markers].sort((a, b) => a.frames - b.frames)
        : markers;

    const text = ordered
      .map((m) => `[${framesToTimecode(m.frames, fps)}] ${m.comment || ""}`)
      .join("\n");

    const prompt = `Riassumi i seguenti commenti di una sessione di screening video:\n${text}`;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(
          GEMINI_KEY
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
          }),
        }
      );

      const data = await res.json();

      const out =
        data?.candidates?.[0]?.content?.parts?.[0]?.text ||
        data?.error?.message ||
        "Errore durante la generazione.";

      setSummary(out);
    } catch {
      setSummary("Errore di rete durante la chiamata a Gemini.");
    } finally {
      setLoadingSummary(false);
    }
  };

  /* ---------- Markers ordinati per UI ---------- */

  const sortedMarkers = useMemo(() => {
    if (sortMode === "timecode") {
      // ordine decrescente di TC
      return [...markers].sort((a, b) => a.frames - b.frames);
    }
    return markers;
  }, [markers, sortMode]);

  /* ---------- UI ---------- */

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />

      {/* TOP BAR (logo left, FPS right) */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <Image
            source={require("../../assets/images/header-dark.png")}
            resizeMode="contain"
            style={styles.topBarLogo}
          />
        </View>

        <View style={styles.topBarRight}>
          <Text style={styles.fpsBadgeText}>{fps} fps</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        

        {/* TIMECODE */}
        <Card styles={styles}>
          <Text style={styles.tc}>{framesToTimecode(frames, fps)}</Text>
          <Text style={styles.tcHint}>
            Start: <Text style={{ fontWeight: "800" }}>{startTC}</Text>
          </Text>

          <View style={styles.row}>
            <PillButton styles={styles}
              label="Play"
              onPress={play}
              variant="primary"
              style={{ flex: 1 }}
            />
            <PillButton styles={styles}
              label="Stop"
              onPress={stop}
              variant="secondary"
              style={{ flex: 1 }}
            />
            <PillButton styles={styles}
              label="Reset"
              onPress={reset}
              variant="danger"
              style={{ flex: 1 }}
            />
          </View>

          <View style={styles.row}>
            <PillButton styles={styles} label="-1s" onPress={() => adjust(-1)} style={{ flex: 1 }} />
            <PillButton styles={styles} label="+1s" onPress={() => adjust(1)} style={{ flex: 1 }} />
            <PillButton styles={styles} label="-5s" onPress={() => adjust(-5)} style={{ flex: 1 }} />
            <PillButton styles={styles} label="+5s" onPress={() => adjust(5)} style={{ flex: 1 }} />
          </View>

          <PillButton styles={styles}
            label="Cattura marker"
            onPress={capture}
            variant="primary"
            style={{ marginTop: 12 }}
          />
        </Card>

        {/* SETTINGS */}
        <Card styles={styles}>
          <Text style={styles.sectionTitle}>Impostazioni</Text>

          <View style={styles.toggleRow}>
            <Text style={styles.toggleText}>Tema scuro</Text>
            <Switch
              value={theme === "dark"}
              onValueChange={(v) => setTheme(v ? "dark" : "light")}
            />
          </View>
          <Divider styles={styles} />

          <View style={styles.field}>
            <Text style={styles.label}>FPS</Text>

            <View
              style={{ flexDirection: "row", gap: 8, marginTop: 4 }}
              pointerEvents={playing ? "none" : "auto"}
            >
              {[24, 25, 30].map((v) => {
                const active = fps === v;

                return (
                  <Pressable
                    key={v}
                    onPress={() => changeFps(v)}
                    disabled={playing}
                    style={[
                      styles.fpsRadio,
                      active && styles.fpsRadioActive,
                      playing && { opacity: 0.55 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.fpsRadioText,
                        active && styles.fpsRadioTextActive,
                      ]}
                    >
                      {v}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>


          <View style={styles.field}>
            <Text style={styles.label}>Start Timecode</Text>
            <Pressable onPress={openTcModal} style={styles.input}>
              <Text style={{ color: ui.text, fontWeight: "900" }}>{startTC}</Text>
              <Text style={{ color: ui.subtext, marginTop: 4, fontSize: 12 }}>
                Tocca per impostare (HH:MM:SS:FF)
              </Text>
            </Pressable>
          </View>
        </Card>

        {/* MARKERS */}
        <Card styles={styles}>
          <View style={styles.markerHeader}>
            <Text style={styles.sectionTitle}>Markers</Text>
            <Text style={styles.count}>{markers.length}</Text>
          </View>

          <Divider styles={styles} />

          {/* TOGGLE ORDINAMENTO */}
          <View style={styles.sortRow}>
            <Text style={styles.sortLabel}>Ordina per</Text>
            <View style={styles.sortPills}>
              <Pressable
                onPress={() => setSortMode("created")}
                style={[
                  styles.sortPill,
                  sortMode === "created" && styles.sortPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.sortPillText,
                    sortMode === "created" && styles.sortPillTextActive,
                  ]}
                >
                  Creazione
                </Text>
              </Pressable>

              <Pressable
                onPress={() => setSortMode("timecode")}
                style={[
                  styles.sortPill,
                  sortMode === "timecode" && styles.sortPillActive,
                ]}
              >
                <Text
                  style={[
                    styles.sortPillText,
                    sortMode === "timecode" && styles.sortPillTextActive,
                  ]}
                >
                  Timecode
                </Text>
              </Pressable>
            </View>
          </View>

          {sortedMarkers.length === 0 && (
            <Text style={styles.empty}>Nessun marker</Text>
          )}

          {sortedMarkers.map((m, index) => (
            <TouchableOpacity
              key={m.id}
              activeOpacity={0.85}
              style={styles.markerRow}
              onPress={() => {
                setEditing(m);
                setComment(m.comment);
              }}
            >
              {/* NUMERINO A SINISTRA */}
              <View style={styles.markerIndex}>
                <Text style={styles.markerIndexText}>{index + 1}</Text>
              </View>

              {/* TC + COMMENTO */}
              <View style={{ flex: 1 }}>
                <Text style={styles.markerTc}>{framesToTimecode(m.frames, fps)}</Text>
                <Text style={styles.markerComment} numberOfLines={1}>
                  {m.comment?.trim() ? m.comment : "Aggiungi un commento…"}
                </Text>
              </View>

              <Text style={styles.editLink}>Modifica</Text>
            </TouchableOpacity>
          ))}

          {markers.length > 0 && (
            <>
              <Divider styles={styles} style={{ marginTop: 6 }} />
              <PillButton
                styles={styles}
                label="Esporta"
                onPress={onPressExport}
                variant="primary"
                style={{ marginTop: 12 }}
              />
              <PillButton styles={styles}
                label={loadingSummary ? "Generazione…" : "Genera riepilogo"}
                onPress={generateSummary}
                variant="primary"
                disabled={loadingSummary}
                style={{ marginTop: 10 }}
              />
            </>
          )}

          {loadingSummary && (
            <Text style={{ marginTop: 10, color: ui.subtext }}>
              Generazione in corso…
            </Text>
          )}

          {!!summary && (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryTitle}>Riepilogo</Text>
              <Text style={styles.summaryText}>{summary}</Text>
            </View>
          )}
        </Card>
      </ScrollView>


      {/* MODAL NOME FILE (Android e fallback) */}
      <Modal
        visible={nameModalVisible}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
        onRequestClose={cancelNameModal}
      >
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nome file</Text>
              <TouchableOpacity onPress={cancelNameModal} hitSlop={10}>
                <Text style={styles.close}>Annulla</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              Inserisci il nome (senza estensione).
            </Text>

            <TextInput
              value={nameDraft}
              onChangeText={setNameDraft}
              placeholder={nameDefault}
              placeholderTextColor={ui.placeholder}
              autoFocus
              style={styles.input}
              returnKeyType="done"
              onSubmitEditing={confirmNameModal}
            />

            <PillButton
              styles={styles}
              label="OK"
              onPress={confirmNameModal}
              variant="primary"
              style={{ marginTop: 10 }}
            />
          </View>
        </View>
      </Modal>

      {/* MODAL START TIMECODE */}
      <Modal
        visible={tcModalOpen}
        transparent
        animationType="fade"
        presentationStyle="overFullScreen"
        statusBarTranslucent
      >
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Imposta Start TC</Text>
              <TouchableOpacity onPress={() => setTcModalOpen(false)} hitSlop={10}>
                <Text style={styles.close}>Annulla</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>HH : MM : SS : FF</Text>

            <Text style={styles.tcPreview}>
              {String(tcH).padStart(2, "0")}:{String(tcM).padStart(2, "0")}:
              {String(tcS).padStart(2, "0")}:{String(tcF).padStart(2, "0")}
            </Text>

            <View style={styles.tcRow}>
              <View style={styles.tcCol}>
                <Text style={styles.wheelLabel}>HH</Text>
                <View style={[styles.wheelBox, styles.wheelBoxTight]}>
                  <Wheel
                    value={tcH}
                    onChange={setTcH}
                    count={24}
                    textStyle={{ fontWeight: "900", color: ui.text }}
                    highlightBg={ui.summaryBg}
                    highlightBorder={ui.summaryBorder}
                  />
                </View>
              </View>

              <View style={styles.tcCol}>
                <Text style={styles.wheelLabel}>MM</Text>
                <View style={[styles.wheelBox, styles.wheelBoxTight]}>
                  <Wheel
                    value={tcM}
                    onChange={setTcM}
                    count={60}
                    textStyle={{ fontWeight: "900", color: ui.text }}
                    highlightBg={ui.summaryBg}
                    highlightBorder={ui.summaryBorder}
                  />
                </View>
              </View>

              <View style={styles.tcCol}>
                <Text style={styles.wheelLabel}>SS</Text>
                <View style={[styles.wheelBox, styles.wheelBoxTight]}>
                  <Wheel
                    value={tcS}
                    onChange={setTcS}
                    count={60}
                    textStyle={{ fontWeight: "900", color: ui.text }}
                    highlightBg={ui.summaryBg}
                    highlightBorder={ui.summaryBorder}
                  />
                </View>
              </View>

              <View style={styles.tcCol}>
                <Text style={styles.wheelLabel}>FF</Text>
                <View style={[styles.wheelBox, styles.wheelBoxTight]}>
                  <Wheel
                    key={`ff-${fps}`}
                    value={Math.min(tcF, Math.max(0, fps - 1))}
                    onChange={setTcF}
                    count={Math.max(1, fps)}
                    textStyle={{ fontWeight: "900", color: ui.text }}
                    highlightBg={ui.summaryBg}
                    highlightBorder={ui.summaryBorder}
                  />
                </View>
              </View>

              {/* Separators as overlay so they don't take layout space */}
              <Text style={[styles.tcSep, { left: "25%" }]}>:</Text>
              <Text style={[styles.tcSep, { left: "50%" }]}>:</Text>
              <Text style={[styles.tcSep, { left: "75%" }]}>:</Text>
            </View>

            <PillButton
              styles={styles}
              label="Conferma"
              onPress={confirmTcModal}
              variant="primary"
              style={{ marginTop: 12 }}
            />
          </View>
        </View>
      </Modal>

      {/* MODAL COMMENTO */}
      <Modal visible={!!editing} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Commento</Text>
              <TouchableOpacity onPress={() => setEditing(null)} hitSlop={10}>
                <Text style={styles.close}>Chiudi</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtitle}>
              {editing ? framesToTimecode(editing.frames, fps) : ""}
            </Text>

            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Scrivi una nota…"
              placeholderTextColor={ui.placeholder}
              multiline
              style={[styles.input, { minHeight: 96 }]}
            />

            <PillButton styles={styles}
              label="Salva"
              onPress={saveComment}
              variant="primary"
              style={{ marginTop: 10 }}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* ---------- Styles ---------- */

const createStyles = (UI: ReturnType<typeof getUi>) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: UI.bg },
    content: { padding: 16, paddingTop: 12, paddingBottom: 28 },

    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      marginBottom: 14,
    },
    title: { fontSize: 28, fontWeight: "900", color: UI.text, letterSpacing: 0.2 },
    subtitle: { marginTop: 2, color: UI.subtext, fontSize: 13 },

    badge: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: UI.surface,
      borderWidth: 1,
      borderColor: UI.border,
    },
    badgeText: { color: UI.text, fontWeight: "800", fontSize: 12 },

    card: {
      backgroundColor: UI.card,
      borderRadius: 18,
      padding: 14,
      marginBottom: 14,
      borderWidth: 1,
      borderColor: UI.border,
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 10 },
      elevation: 2,
    },

    tc: {
      fontSize: 38,
      fontWeight: "900",
      textAlign: "center",
      color: UI.text,
      letterSpacing: 1,
    },
    tcHint: { textAlign: "center", marginTop: 6, color: UI.subtext, fontSize: 12 },

    row: { flexDirection: "row", gap: 10, marginTop: 12 },

    pillBtn: {
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: UI.border,
      backgroundColor: UI.surface,
      alignItems: "center",
      justifyContent: "center",
    },
    pillPrimary: {
      backgroundColor: UI.primary,
      borderColor: "rgba(37, 99, 235, 0.25)",
    },
    pillDanger: {
      backgroundColor: UI.danger,
      borderColor: "rgba(239, 68, 68, 0.25)",
    },
    pillText: { color: UI.text, fontWeight: "800", fontSize: 13 },

    sectionTitle: { fontWeight: "900", color: UI.text, fontSize: 16 },
    divider: { height: 1, backgroundColor: UI.divider, marginTop: 10 },

    field: { marginTop: 12 },
    label: { color: UI.subtext, marginBottom: 6, fontWeight: "800", fontSize: 12 },
    help: { marginTop: 6, color: UI.subtext, fontSize: 12 },

    input: {
      borderWidth: 1,
      borderColor: UI.border,
      borderRadius: 14,
      padding: 12,
      color: UI.text,
      backgroundColor: UI.inputBg,
    },

    pickerWrap: {
      borderWidth: 1,
      borderColor: UI.border,
      borderRadius: 14,
      overflow: "hidden",
      backgroundColor: UI.inputBg,
    },
    picker: { color: UI.text },
    pickerSelected: {
      marginTop: 6,
      color: UI.subtext,
      fontSize: 12,
      fontWeight: "800",
    },

    markerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
    count: { color: UI.subtext, fontWeight: "900" },
    empty: { marginTop: 10, color: UI.subtext },

    markerRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 12,
    },
    markerTc: { fontWeight: "900", color: UI.text },
    markerComment: { marginTop: 2, color: UI.subtext, fontSize: 13 },
    editLink: { color: UI.primary, fontWeight: "800", fontSize: 13 },

    summaryBox: {
      marginTop: 12,
      padding: 12,
      borderRadius: 14,
      backgroundColor: UI.summaryBg,
      borderWidth: 1,
      borderColor: UI.summaryBorder,
    },
    summaryTitle: { fontWeight: "900", marginBottom: 6, color: UI.text },
    summaryText: { color: UI.subtext, lineHeight: 20 },

    modalBg: {
      flex: 1,
      backgroundColor: UI.overlay,
      justifyContent: "center",
      padding: 20,
    },
    modal: {
      backgroundColor: UI.modal,
      borderRadius: 18,
      padding: 14,
      borderWidth: 1,
      borderColor: UI.border,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 14 },
      elevation: 3,
    },
    modalHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    modalTitle: { color: UI.text, fontWeight: "900", fontSize: 16 },
    modalSubtitle: { marginTop: 6, color: UI.subtext, fontSize: 12 },
    tcPreview: {
      marginTop: 10,
      color: UI.text,
      fontWeight: "900",
      fontSize: 18,
      letterSpacing: 0.6,
    },
    close: { color: UI.subtext, fontWeight: "800" },

    tcRow: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: 8,
      position: "relative",
      width: "100%",
    },
    tcCol: {
      flex: 1,
      minWidth: 64,
      maxWidth: 110,
    },
    tcSep: {
      position: "absolute",
      top: 120,
      transform: [{ translateX: -6 }],
      color: UI.subtext,
      fontWeight: "900",
      fontSize: 22,
      opacity: 0.55,
    },

    wheelLabel: {
      color: UI.subtext,
      marginBottom: 6,
      paddingLeft: 6,
      fontWeight: "800",
      fontSize: 12,
    },
    wheelBox: {
      borderWidth: 1,
      borderColor: UI.border,
      borderRadius: 18,
      overflow: "hidden",
      backgroundColor: UI.inputBg,
      paddingVertical: 10,
      paddingHorizontal: 6,
    },
    wheelBoxTight: {
      paddingVertical: 8,
      paddingHorizontal: 4,
    },

    toggleRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 8,
    },
    toggleText: { color: UI.text, fontWeight: "800" },

    // toggle ordinamento markers
    sortRow: {
      marginTop: 8,
      marginBottom: 4,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    sortLabel: {
      color: UI.subtext,
      fontSize: 12,
      fontWeight: "800",
    },
    sortPills: {
      flexDirection: "row",
      gap: 6,
    },
    sortPill: {
      borderRadius: 999,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderColor: UI.border,
      backgroundColor: UI.surface,
    },
    sortPillActive: {
      borderColor: UI.primary,
      backgroundColor: UI.summaryBg,
    },
    sortPillText: {
      fontSize: 11,
      fontWeight: "800",
      color: UI.subtext,
    },
    sortPillTextActive: {
      color: UI.primary,
    },

    markerIndex: {
      width: 26,
      height: 26,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: UI.border,
      backgroundColor: UI.surface,
      alignItems: "center",
      justifyContent: "center",
      marginRight: 8,
    },
    markerIndexText: {
      color: UI.text,
      fontWeight: "900",
      fontSize: 12,
    },
    fpsRadio: {
  flex: 1,
  paddingVertical: 10,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: UI.border,
  backgroundColor: UI.surface,
  alignItems: "center",
},

fpsRadioActive: {
  backgroundColor: UI.summaryBg,
  borderColor: UI.primary,
},

fpsRadioText: {
  fontWeight: "800",
  color: UI.subtext,
  fontSize: 13,
},

fpsRadioTextActive: {
  color: UI.primary,
},
topBar: {
  height: 52,
  paddingHorizontal: 16,
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  backgroundColor: UI.bg,
},

topBarLeft: {
  flexDirection: "row",
  alignItems: "center",
},

topBarLogo: {
  width: 120,
  height: 100,
},

topBarRight: {
  paddingHorizontal: 10,
  paddingVertical: 4,
  borderRadius: 999,
  backgroundColor: UI.surface,
  borderWidth: 1,
  borderColor: UI.border,
},

fpsBadgeText: {
  color: UI.text,
  fontWeight: "800",
  fontSize: 12,
},
});
