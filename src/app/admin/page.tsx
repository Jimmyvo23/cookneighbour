import { redirect } from "next/navigation";

// /admin has nothing of its own; the layout guard has already run by the time this renders.
export default function Page() {
  redirect("/admin/chefs");
}
