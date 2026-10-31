import { useState } from "react";
import { Image, Text, View } from "react-native";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { createTrade, uploadScreenshot } from "../../../src/api";
import { GhostButton, GlassCard, Screen } from "../../../src/components";
import { FormError } from "../../../src/forms";
import { QuickTradeForm } from "../../../src/trade-form";
import { shared, tokens } from "../../../src/theme";

interface PendingScreenshot {
  uri: string;
  name: string;
  type: string;
}

/**
 * Add Trade (Phase 25) — POST /api/mobile/trades.
 * Raw inputs only: P&L, R and ROI come back computed by the
 * server core. On success the app navigates to the created
 * trade (the id is the server's response, not a local guess).
 *
 * M2 correction pass: an optional screenshot can be attached
 * BEFORE saving. It uploads through the existing M2
 * screenshot endpoint to the trade the create just returned —
 * the same private-storage pipeline Trade Detail uses; no
 * second screenshot system. If the create fails, the form
 * AND the attachment stay exactly as they were. If the trade
 * saves but the upload fails, we still go to the trade and
 * say so there, where the screenshot can be added from the
 * detail screen instead.
 */
export default function AddTradeScreen() {
  const router = useRouter();
  const [screenshot, setScreenshot] = useState<PendingScreenshot | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  async function handlePickScreenshot() {
    if (picking) return;
    setPickError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPickError("Photo library access is needed to attach a screenshot.");
      return;
    }
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      const asset = result.assets[0];
      setScreenshot({
        uri: asset.uri,
        name: asset.fileName ?? `screenshot-${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      });
    } finally {
      setPicking(false);
    }
  }

  return (
    <Screen>
      <Text style={shared.title}>Add trade</Text>
      <GlassCard>
        <Text style={shared.heading}>Trade Screenshot (optional)</Text>
        <Text style={shared.muted}>
          Attach a screenshot of your chart for this trade — it is stored
          privately in this trade's journal. You can also add or change it
          later from the trade's detail screen.
        </Text>
        {screenshot ? (
          <>
            <Image
              source={{ uri: screenshot.uri }}
              style={{
                width: "100%",
                height: 200,
                borderRadius: tokens.radiusSm,
                backgroundColor: tokens.glass,
              }}
              resizeMode="contain"
            />
            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <GhostButton
                  label="Replace"
                  onPress={() => void handlePickScreenshot()}
                />
              </View>
              <View style={{ flex: 1 }}>
                <GhostButton label="Remove" onPress={() => setScreenshot(null)} />
              </View>
            </View>
          </>
        ) : (
          <GhostButton
            label={picking ? "Opening photos…" : "Upload screenshot"}
            onPress={() => void handlePickScreenshot()}
          />
        )}
        <FormError message={pickError} />
      </GlassCard>
      <GlassCard>
        <QuickTradeForm
          submitLabel="Save trade"
          onSubmit={async (payload) => {
            const result = await createTrade(payload);
            let screenshotFailed = false;
            if (screenshot) {
              try {
                await uploadScreenshot(result.trade.id, screenshot);
              } catch {
                screenshotFailed = true;
              }
            }
            router.replace(
              screenshotFailed
                ? `/(app)/trade/${result.trade.id}?shot=failed`
                : `/(app)/trade/${result.trade.id}`,
            );
          }}
        />
      </GlassCard>
    </Screen>
  );
}
