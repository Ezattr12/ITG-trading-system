import { useCallback, useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { cancelTrade, deleteScreenshot, uploadScreenshot } from "../../../src/api";
import { useAuth } from "../../../src/auth";
import { supabase } from "../../../src/supabase";
import {
  EmptyState,
  ErrorState,
  GhostButton,
  GlassCard,
  LoadingState,
  PrimaryButton,
  Screen,
} from "../../../src/components";
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPct,
  titleCase,
} from "../../../src/format";
import { FormError, FormSuccess } from "../../../src/forms";
import { shared, tokens } from "../../../src/theme";
import type {
  LessonRow,
  PsychologyRow,
  ScreenshotRow,
  TradeRow,
} from "../../../src/types";

/**
 * Trade detail — direct RLS reads: the trade row (all stored
 * fields and stored metrics), its psychology record and its
 * lessons, plus strategy/setup names. Phase 25 adds the
 * write entry points (review / close / correct / cancel) and
 * the screenshots manager; every write goes through the
 * /api/mobile endpoints, and screenshots display via signed
 * URLs from the user's own client — the same way web does.
 */
export default function TradeDetailScreen() {
  // `shot=failed` arrives from Add Trade when the trade saved
  // but its screenshot upload did not — surfaced honestly below.
  const { id, shot } = useLocalSearchParams<{ id: string; shot?: string }>();
  const router = useRouter();
  const { session } = useAuth();
  const [trade, setTrade] = useState<TradeRow | null>(null);
  const [psychology, setPsychology] = useState<PsychologyRow | null>(null);
  const [lessons, setLessons] = useState<LessonRow[]>([]);
  const [strategyName, setStrategyName] = useState<string | null>(null);
  const [setupName, setSetupName] = useState<string | null>(null);
  const [screenshots, setScreenshots] = useState<ScreenshotRow[]>([]);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [shotBusy, setShotBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [deleteArmedId, setDeleteArmedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session || !id) return;
    setLoading(true);
    setError(null);
    const { data, error: tradeError } = await supabase
      .from("trades")
      .select("*")
      .eq("id", id)
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (tradeError) {
      setError(tradeError.message);
      setLoading(false);
      return;
    }
    const row = (data as TradeRow | null) ?? null;
    setTrade(row);
    if (row) {
      const [psychRes, lessonsRes, shotsRes, strategyRes, setupRes] = await Promise.all([
        supabase.from("psychology_records").select("*").eq("trade_id", id).maybeSingle(),
        supabase
          .from("lessons")
          .select("*")
          .eq("trade_id", id)
          .order("created_at", { ascending: true }),
        supabase
          .from("trade_screenshots")
          .select("*")
          .eq("trade_id", id)
          .order("created_at", { ascending: false }),
        row.strategy_id
          ? supabase.from("strategies").select("id, name").eq("id", row.strategy_id).maybeSingle()
          : Promise.resolve({ data: null }),
        row.setup_id
          ? supabase.from("setups").select("id, name").eq("id", row.setup_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
      setPsychology((psychRes.data as PsychologyRow | null) ?? null);
      setLessons((lessonsRes.data ?? []) as LessonRow[]);
      const shots = (shotsRes.data ?? []) as ScreenshotRow[];
      setScreenshots(shots);
      // Signed URLs from the user's own RLS client, exactly
      // like the web trade page (createSignedUrl, 3600s): the
      // bucket is private and never publicly linked.
      const urls: Record<string, string> = {};
      for (const shot of shots) {
        const { data } = await supabase.storage
          .from("trade-screenshots")
          .createSignedUrl(shot.storage_path, 3600);
        if (data?.signedUrl) urls[shot.id] = data.signedUrl;
      }
      setSignedUrls(urls);
      setStrategyName((strategyRes.data as { name?: string } | null)?.name ?? null);
      setSetupName((setupRes.data as { name?: string } | null)?.name ?? null);
    }
    setLoading(false);
  }, [session, id]);

  useEffect(() => {
    void load();
  }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function handleCancel() {
    if (!trade || actionBusy) return;
    if (!cancelArmed) {
      setCancelArmed(true);
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      await cancelTrade(trade.id);
      router.replace("/(app)/trades");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setCancelArmed(false);
      setActionBusy(false);
    }
  }

  async function handleAddScreenshot() {
    if (!trade || shotBusy) return;
    setActionError(null);
    setActionSuccess(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setActionError("Photo library access is needed to attach a screenshot.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    setShotBusy(true);
    try {
      await uploadScreenshot(trade.id, {
        uri: asset.uri,
        name: asset.fileName ?? `screenshot-${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
      setActionSuccess("Screenshot uploaded.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setShotBusy(false);
    }
  }

  async function handleDeleteScreenshot(shot: ScreenshotRow) {
    if (!trade || shotBusy) return;
    if (deleteArmedId !== shot.id) {
      setDeleteArmedId(shot.id);
      return;
    }
    setShotBusy(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      await deleteScreenshot(trade.id, shot.id);
      setDeleteArmedId(null);
      setActionSuccess("Screenshot removed.");
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setDeleteArmedId(null);
    } finally {
      setShotBusy(false);
    }
  }

  if (loading) return <LoadingState label="Loading trade…" />;

  if (error) {
    return (
      <Screen>
        <ErrorState message={error} />
      </Screen>
    );
  }

  if (!trade) {
    return (
      <Screen>
        <EmptyState
          title="Trade not found"
          body="This trade doesn't exist, or it doesn't belong to your account."
        />
      </Screen>
    );
  }

  const fields: { label: string; value: string }[] = [
    { label: "Direction", value: titleCase(trade.direction) },
    { label: "Status", value: titleCase(trade.status) },
    { label: "Entry", value: formatNumber(trade.entry_price, 4) },
    { label: "Exit", value: formatNumber(trade.exit_price, 4) },
    { label: "Take profit", value: formatNumber(trade.tp, 4) },
    { label: "Stop loss", value: formatNumber(trade.sl, 4) },
    { label: "Position size", value: formatNumber(trade.position_size, 4) },
    { label: "Leverage", value: `${formatNumber(trade.leverage, 0)}x` },
    { label: "Fees", value: formatNumber(trade.fees) },
    { label: "Opened", value: formatDateTime(trade.opened_at) },
    { label: "Closed", value: formatDateTime(trade.closed_at) },
    { label: "Session", value: titleCase(trade.session) },
    { label: "Market", value: titleCase(trade.market_condition) },
    { label: "Reason", value: titleCase(trade.trade_reason) },
    { label: "Strategy", value: strategyName ?? "—" },
    { label: "Setup", value: setupName ?? "—" },
    { label: "Screenshots", value: String(screenshots.length) },
  ];

  const metrics: { label: string; value: string; tone?: "profit" | "loss" }[] = [
    {
      label: "P&L",
      value: formatMoney(trade.pnl),
      tone: trade.pnl === null ? undefined : trade.pnl >= 0 ? "profit" : "loss",
    },
    { label: "ROI", value: formatPct(trade.roi_pct) },
    { label: "R multiple", value: formatNumber(trade.r_multiple) },
    { label: "Risk / reward", value: formatNumber(trade.risk_reward) },
    {
      label: "Outcome",
      value: trade.is_win === null ? "—" : trade.is_win ? "Win" : "Loss / breakeven",
    },
  ];

  return (
    <Screen>
      <Text style={shared.title}>{trade.pair}</Text>
      {shot === "failed" ? (
        <FormError message="Trade saved — the screenshot upload failed. You can add it from the Screenshots section below." />
      ) : null}
      <GlassCard hero>
        <Text style={shared.label}>Result</Text>
        {metrics.map((m) => (
          <View key={m.label} style={shared.rowBetween}>
            <Text style={shared.muted}>{m.label}</Text>
            <Text
              style={{
                color:
                  m.tone === "profit"
                    ? tokens.profit
                    : m.tone === "loss"
                      ? tokens.loss
                      : tokens.textPrimary,
                fontSize: 15,
                fontWeight: "600",
                fontVariant: ["tabular-nums"],
              }}
            >
              {m.value}
            </Text>
          </View>
        ))}
      </GlassCard>

      <GlassCard>
        <Text style={shared.heading}>Trade details</Text>
        {fields.map((f) => (
          <View key={f.label} style={shared.rowBetween}>
            <Text style={shared.muted}>{f.label}</Text>
            <Text style={{ color: tokens.textSecondary, fontSize: 14 }}>{f.value}</Text>
          </View>
        ))}
        {trade.notes ? <Text style={shared.body}>{trade.notes}</Text> : null}
      </GlassCard>

      {psychology ? (
        <GlassCard>
          <Text style={shared.heading}>Psychology</Text>
          <View style={shared.rowBetween}>
            <Text style={shared.muted}>Emotion</Text>
            <Text style={{ color: tokens.textSecondary }}>{titleCase(psychology.emotion)}</Text>
          </View>
          <View style={shared.rowBetween}>
            <Text style={shared.muted}>Confidence</Text>
            <Text style={{ color: tokens.textSecondary }}>
              {psychology.confidence === null ? "—" : `${psychology.confidence} / 5`}
            </Text>
          </View>
          <View style={shared.rowBetween}>
            <Text style={shared.muted}>Discipline</Text>
            <Text style={{ color: tokens.textSecondary }}>{titleCase(psychology.discipline)}</Text>
          </View>
        </GlassCard>
      ) : null}

      {lessons.length > 0 ? (
        <GlassCard>
          <Text style={shared.heading}>Lessons</Text>
          {lessons.map((lesson) => (
            <Text key={lesson.id} style={shared.body}>
              • {lesson.text}
              {lesson.is_repeated_mistake ? " (repeated mistake)" : ""}
            </Text>
          ))}
        </GlassCard>
      ) : null}

      <FormError message={actionError} />
      <FormSuccess message={actionSuccess} />

      {trade.status === "open" || trade.status === "closed" ? (
        <GlassCard>
          <Text style={shared.heading}>Actions</Text>
          <PrimaryButton
            label="Review trade"
            onPress={() => router.push(`/(app)/trade/${trade.id}/review`)}
          />
          {trade.status === "open" ? (
            <GhostButton
              label="Close trade"
              onPress={() => router.push(`/(app)/trade/${trade.id}/close`)}
            />
          ) : null}
          <GhostButton
            label="Correct trade (creates a reversal)"
            onPress={() => router.push(`/(app)/trade/${trade.id}/correct`)}
          />
          {trade.status === "open" ? (
            <GhostButton
              label={
                actionBusy
                  ? "Cancelling…"
                  : cancelArmed
                    ? "Tap again to cancel this trade"
                    : "Cancel trade"
              }
              onPress={handleCancel}
            />
          ) : null}
        </GlassCard>
      ) : null}

      <GlassCard>
        <Text style={shared.heading}>Screenshots</Text>
        <Text style={shared.muted}>
          Stored privately — only you can view these. Removing a screenshot
          deletes the stored file as well as its record.
        </Text>
        {screenshots.length === 0 ? (
          <Text style={shared.muted}>
            No screenshots yet. Attach a chart screenshot to this trade's journal.
          </Text>
        ) : (
          screenshots.map((shot) => (
            <View key={shot.id} style={{ gap: 6 }}>
              {signedUrls[shot.id] ? (
                <Image
                  source={{ uri: signedUrls[shot.id] }}
                  style={{
                    width: "100%",
                    height: 220,
                    borderRadius: tokens.radiusSm,
                    backgroundColor: tokens.glass,
                  }}
                  resizeMode="contain"
                />
              ) : (
                <Text style={shared.muted}>Image unavailable.</Text>
              )}
              <View style={shared.rowBetween}>
                <Text style={shared.muted}>
                  {formatDateTime(shot.created_at)}
                  {shot.ocr_status && shot.ocr_status !== "not_requested"
                    ? ` · OCR ${titleCase(shot.ocr_status)}`
                    : ""}
                </Text>
                <GhostButton
                  label={
                    deleteArmedId === shot.id ? "Tap again to remove" : "Remove"
                  }
                  onPress={() => void handleDeleteScreenshot(shot)}
                />
              </View>
            </View>
          ))
        )}
        <PrimaryButton
          label={shotBusy ? "Working…" : "Add screenshot"}
          onPress={() => void handleAddScreenshot()}
          loading={shotBusy}
        />
      </GlassCard>
    </Screen>
  );
}
