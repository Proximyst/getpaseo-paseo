import { useHostRouteServerId } from "@/navigation/host-route-context";
import { PullRequestInboxScreen } from "@/screens/pull-request-inbox-screen";
import { StartupSplashScreen } from "@/screens/startup-splash-screen";

export default function HostPullRequestsRoute() {
  const hostId = useHostRouteServerId();
  if (!hostId) return <StartupSplashScreen />;
  return <PullRequestInboxScreen key={hostId} hostId={hostId} />;
}
