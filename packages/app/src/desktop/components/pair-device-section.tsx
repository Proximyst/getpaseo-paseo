import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { ExternalLink } from "@/components/ui/external-link";

export const CONNECTIVITY_DOCS_URL = "https://paseo.sh/docs/connectivity";
export const TAILSCALE_DOCS_URL = `${CONNECTIVITY_DOCS_URL}#tailscale`;

export interface PairDeviceSectionProps {
  serverId: string;
  onClose: () => void;
}

export function PairDeviceSection(_props: PairDeviceSectionProps) {
  const { t } = useTranslation();
  return (
    <View testID="pair-device-content" style={styles.content}>
      <Text style={styles.hint}>{t("pairing.device.directConnectionHint")}</Text>
      <ExternalLink
        href={TAILSCALE_DOCS_URL}
        label={t("pairing.device.tailscaleDocs")}
        accessibilityLabel={t("pairing.device.tailscaleDocsAccessibility")}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    alignItems: "flex-start",
    gap: theme.spacing[3],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.5,
  },
}));
