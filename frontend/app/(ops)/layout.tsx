import "@copilotkit/react-ui/v2/styles.css";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Providers } from "@/components/Providers";
import { AppChrome } from "@/components/AppChrome";
import { AgentUnreachable } from "@/components/AgentUnreachable";
import { STAFF_COOKIE, verifyStaffSession } from "@/lib/staff-session";

// The workspace renders only for a verified staff session: the token in the
// httpOnly cookie is checked against the agent on every page load, and the
// signed-in user it returns is what the chrome and the approval cards show.
export default async function OpsLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(STAFF_COOKIE)?.value;
  const session = await verifyStaffSession(token);
  if (session.status === "unauthenticated") redirect("/login");
  if (session.status === "unreachable") return <AgentUnreachable message={session.message} />;
  return (
    <Providers user={session.user}>
      <AppChrome>{children}</AppChrome>
    </Providers>
  );
}
