import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection } from "@/components/settings";
import { TailscaleRow } from "./tailscale-row";

const TAILSCALE_DOCS_URL = "https://paseo.sh/docs/connectivity#tailscale";

/** Shared host connectivity controls for Settings and onboarding. */
export function WaysToConnect({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const docsLink = useMemo(
    () => ({
      href: TAILSCALE_DOCS_URL,
      label: t("devices.docs"),
      accessibilityLabel: t("devices.docsAccessibility"),
    }),
    [t],
  );

  return (
    <SettingsSection title={t("devices.waysToConnect")} link={docsLink}>
      <SettingsCard>
        <TailscaleRow serverId={serverId} />
      </SettingsCard>
    </SettingsSection>
  );
}
