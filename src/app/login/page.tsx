import type { Metadata } from "next";
import { LoginForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Log in — CookNeighbour" };

export default function Page() {
  return <LoginForm />;
}
