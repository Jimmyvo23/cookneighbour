import type { Metadata } from "next";
import { PhoneVerifyForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Verify phone — CookNeighbour" };

export default function Page() {
  return <PhoneVerifyForm />;
}
