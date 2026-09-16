import { redirect } from "next/navigation";

/** Portal links used to carry a per-customer token. Accounts replaced them; send old links to sign-in. */
export default function LegacyPortalLink() {
  redirect("/portal/login");
}
