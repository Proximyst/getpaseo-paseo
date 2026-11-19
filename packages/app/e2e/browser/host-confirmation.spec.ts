import { test, expect } from "../support/fixtures";
import { expectAppRoute } from "../support/helpers/route-assertions";
import {
  buildPairingLink,
  expectHostInHostPicker,
  openPairingLink,
  type LinkedHost,
} from "../support/helpers/host-confirmation";

const linkedHost: LinkedHost = {
  serverId: "srv_link_confirmation",
  relayEndpoint: "127.0.0.1:59998",
  daemonPublicKeyB64: "bGlua0NvbmZpcm1hdGlvbktleQ",
};

test("a legacy relay pairing link does not prompt, register a host, or navigate", async ({
  page,
}) => {
  await openPairingLink(page, buildPairingLink(linkedHost));
  await expectAppRoute(page, "/settings/general");
  await expect(page.getByTestId("host-confirmation")).toHaveCount(0);
  await expectHostInHostPicker(page, linkedHost.serverId, "not listed");
});
