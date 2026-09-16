import "@copilotkit/react-ui/v2/styles.css";
import { Providers } from "@/components/Providers";
import { AppChrome } from "@/components/AppChrome";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <AppChrome>{children}</AppChrome>
    </Providers>
  );
}
