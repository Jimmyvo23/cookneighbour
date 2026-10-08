import type { Metadata } from "next";
import { AddressForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Home address — CookNeighbour" };

export default function Page() {
  return <AddressForm />;
}
