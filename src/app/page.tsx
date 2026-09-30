import { redirect } from "next/navigation";
import { isLoggedIn } from "@/lib/auth";

export default async function Home() {
  if (await isLoggedIn()) redirect("/agency");
  redirect("/login");
}
