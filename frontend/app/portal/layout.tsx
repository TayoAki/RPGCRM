import { Fuel } from "lucide-react";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-2 px-4">
          <span className="grid h-7 w-7 place-items-center rounded-[0.5rem] bg-primary text-primary-foreground"><Fuel className="h-4 w-4" /></span>
          <span className="font-semibold">RPG Fuel</span>
          <span className="text-sm text-muted-foreground">· Customer portal</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
