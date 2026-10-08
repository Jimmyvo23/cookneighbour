import type { Metadata } from "next";
import { SignUpForm } from "@/components/AuthForms";

export const metadata: Metadata = { title: "Sign up — CookNeighbour" };

export default function Page() {
  return <SignUpForm />;
}
