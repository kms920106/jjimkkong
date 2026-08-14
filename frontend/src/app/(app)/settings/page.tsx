import { requireUser } from "@/lib/auth";
import SettingsClient from "@/components/SettingsClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "설정 · 찜꽁",
};

export default async function SettingsPage() {
  const user = await requireUser();
  return <SettingsClient initialProvider={user.mapProvider} />;
}
